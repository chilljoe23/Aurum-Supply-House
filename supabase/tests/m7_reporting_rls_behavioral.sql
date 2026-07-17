-- ============================================================================
-- Aurum Supply House · M7 · Adversarial RLS — BEHAVIORAL (fixtures + impersonation)
-- ----------------------------------------------------------------------------
-- Creates two sales reps with separate books, an admin, and issued orders, then
-- switches identity (Supabase `auth.uid()` reads request.jwt.claims) to PROVE at
-- runtime that a rep sees only their book, that profit/cost is NULL for reps on
-- every surface, and that the cost-bearing base tables return zero rows to reps.
-- The whole run is wrapped in a transaction and ROLLED BACK — it mutates nothing.
--
--   supabase db reset
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m7_reporting_rls_behavioral.sql
--
-- NOTE: the auth.users fixture below uses the common Supabase auth schema. If a
-- future GoTrue version changes required columns, adjust ONLY the three
-- auth.users inserts; every assertion afterward is schema-stable.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

-- Fixed fixture UUIDs (readable suffixes).
-- owner a1 · rep1 b1 · rep2 b2 · client1 c1 · client2 c2 · inv1 d1 · inv2 d2
--   · mfr e1 · po f1 · quote a9
-- ---- identities (as postgres; the profile auto-trigger then fires) ----------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@test.local','{}','{"full_name":"Test Owner"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rep1@test.local','{}','{"full_name":"Rep One"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rep2@test.local','{}','{"full_name":"Rep Two"}', now(), now());

-- Force deterministic roles (auto-trigger only makes the very first user owner).
update public.profiles set role='owner',     status='active', full_name='Test Owner' where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='sales_rep', status='active', full_name='Rep One'    where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set role='sales_rep', status='active', full_name='Rep Two'    where id='00000000-0000-0000-0000-0000000000b2';

-- Reference + clients (assigned to distinct reps).
insert into public.manufacturers (id, name, status)
values ('00000000-0000-0000-0000-0000000000e1','Test Manufacturer','active');
insert into public.clients (id, company_name, status, assigned_rep_id)
values
  ('00000000-0000-0000-0000-0000000000c1','Client One','active','00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2','Client Two','active','00000000-0000-0000-0000-0000000000b2');

-- ---- become the ADMIN to create issued orders (triggers run with is_admin) --
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

insert into public.invoices (id, invoice_number, client_id, sales_rep_id, sales_rep_name, status, currency, issue_date, due_date, client_snapshot)
values
  ('00000000-0000-0000-0000-0000000000d1','AUR-T0001','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','Rep One','sent','USD', current_date, current_date + 30, '{"company_name":"Client One"}'),
  ('00000000-0000-0000-0000-0000000000d2','AUR-T0002','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2','Rep Two','sent','USD', current_date, current_date + 30, '{"company_name":"Client Two"}');

-- Lines drive the trigger-computed cost/GP (200 revenue, 120 cost, 80 GP each).
insert into public.invoice_items (invoice_id, sku, product_name, manufacturer_name, quantity, unit_price, unit_true_cost)
values
  ('00000000-0000-0000-0000-0000000000d1','SKU-1','Widget','Test Manufacturer',2,100,60),
  ('00000000-0000-0000-0000-0000000000d2','SKU-1','Widget','Test Manufacturer',2,100,60);

-- Commission to rep1 on inv1 (so rep1 can read their OWN commission, GP masked).
insert into public.commissions (invoice_id, recipient_id, recipient_type, recipient_name, commission_type, rate, status)
values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','internal_user','Rep One','flat',25,'earned');

-- Internal expense on inv1 (reps must never read order_expenses).
insert into public.order_expenses (invoice_id, type, amount, note)
values ('00000000-0000-0000-0000-0000000000d1','outbound_shipping',10,'freight');

-- A quote for rep1's client, and a PO (admin-only subsystem).
insert into public.quotes (id, quote_number, client_id, sales_rep_id, sales_rep_name, status, currency, quote_date, client_snapshot)
values ('00000000-0000-0000-0000-0000000000a9','QTE-T0001','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','Rep One','sent','USD', current_date, '{"company_name":"Client One"}');

insert into public.purchase_orders (id, po_number, manufacturer_id, status, currency)
values ('00000000-0000-0000-0000-0000000000f1','PO-T0001','00000000-0000-0000-0000-0000000000e1','sent','USD');

reset role;

-- ===========================================================================
-- ASSERT AS REP ONE — sees only their book; profit/cost NULL; base tables empty
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

do $$
begin
  -- dashboard/orders view: exactly rep1's one order, profit masked
  assert (select count(*) from public.v_orders) = 1, 'rep1 must see exactly 1 order (their book)';
  assert (select invoice_number from public.v_orders) = 'AUR-T0001', 'rep1 must see only inv1';
  assert (select gross_profit from public.v_orders) is null, 'rep1 gross_profit must be NULL (masked)';
  assert (select net_profit  from public.v_orders) is null, 'rep1 net_profit must be NULL (masked)';
  assert (select can_see_internal from public.v_orders) = false, 'rep1 can_see_internal must be false';
  assert (select total from public.v_orders) = 200, 'rep1 must still see revenue (200)';

  -- insights line surface: only inv1 lines, line cost/GP masked
  assert (select count(*) from public.v_report_order_lines) = 1, 'rep1 line surface = own lines only';
  assert (select line_gross_profit from public.v_report_order_lines) is null, 'rep1 line_gross_profit NULL';
  assert (select line_true_cost   from public.v_report_order_lines) is null, 'rep1 line_true_cost NULL';
  assert (select line_revenue from public.v_report_order_lines) = 200, 'rep1 sees line revenue';

  -- direct base-table access (and joins through it) return ZERO rows
  assert (select count(*) from public.invoices)       = 0, 'rep1 base invoices must be empty (admin-only)';
  assert (select count(*) from public.invoice_items)  = 0, 'rep1 base invoice_items must be empty';
  assert (select count(*) from public.commissions)    = 0, 'rep1 base commissions must be empty';
  assert (select count(*) from public.order_expenses) = 0, 'rep1 base order_expenses must be empty';
  assert (select count(*) from public.purchase_orders)= 0, 'rep1 base purchase_orders must be empty';

  -- commission surface: own commission visible, invoice GP masked
  assert (select count(*) from public.v_commissions) = 1, 'rep1 sees only their own commission';
  assert (select invoice_gross_profit from public.v_commissions) is null, 'rep1 commission invoice_gross_profit NULL';

  -- PO / manufacturer surfaces: zero rows for reps
  assert (select count(*) from public.v_purchase_orders) = 0, 'rep1 must get 0 rows from v_purchase_orders';
  assert (select count(*) from public.v_manufacturer_payments) = 0, 'rep1 must get 0 rows from v_manufacturer_payments';

  -- hardened legacy insights view: no company-wide profit leaks to rep1
  assert (select coalesce(bool_or(gross_profit is not null), false)
          from public.v_profit_by_client) = false,
    'rep1 must not read any non-null gross_profit from v_profit_by_client';

  -- rep-safe activity feed excludes the other rep's client/invoice
  assert not exists (select 1 from public.report_recent_activity(200)
                     where entity_id = '00000000-0000-0000-0000-0000000000c2'),
    'rep1 activity feed must not include rep2''s client events';

  raise notice 'OK  rep1: book-scoped, profit/cost masked, base tables empty';
end $$;
reset role;

-- ===========================================================================
-- ASSERT AS REP TWO — sees only inv2, never rep1's order
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.v_orders) = 1, 'rep2 must see exactly 1 order';
  assert (select invoice_number from public.v_orders) = 'AUR-T0002', 'rep2 must see only inv2';
  assert not exists (select 1 from public.v_orders where invoice_number = 'AUR-T0001'),
    'rep2 must NOT see rep1 order (book isolation)';
  assert (select gross_profit from public.v_orders) is null, 'rep2 gross_profit masked';
  raise notice 'OK  rep2: isolated to own book';
end $$;
reset role;

-- ===========================================================================
-- ASSERT AS ADMIN — company-wide, profit populated, PO visible
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.v_orders) = 2, 'admin sees both orders';
  assert (select gross_profit from public.v_orders where invoice_number='AUR-T0001') = 80,
    'admin sees real gross_profit (80)';
  assert (select can_see_internal from public.v_orders where invoice_number='AUR-T0001') = true,
    'admin can_see_internal true';
  assert (select line_gross_profit from public.v_report_order_lines where invoice_number='AUR-T0001') = 80,
    'admin sees line gross profit';
  assert (select count(*) from public.v_purchase_orders) = 1, 'admin sees the PO';
  assert (select coalesce(bool_or(gross_profit is not null), false)
          from public.v_profit_by_client) = true,
    'admin reads company-wide profit by client';
  raise notice 'OK  admin: company-wide profit + PO visibility';
end $$;
reset role;

select 'M7 behavioral RLS suite: ALL PASSED (rolled back)' as result;
rollback;
