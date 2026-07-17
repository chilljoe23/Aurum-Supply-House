-- ============================================================================
-- Aurum Supply House · M7 · v_orders masking DIAGNOSTIC (SQL EDITOR EDITION)
-- ----------------------------------------------------------------------------
-- PURPOSE
-- The structural assertion `v_orders must mask net_profit / gross_profit /
-- total_true_cost for non-admins` is a TEXT scrape of pg_get_viewdef(); it proves
-- the CASE guards are written in the definition, not that the live rows are
-- actually masked. This diagnostic proves the *behavior* directly: it impersonates
-- an Owner and a Sales Rep using the SAME identity mechanism as the failing
-- suite (`set local role authenticated` + `set_config('request.jwt.claims', ...)`,
-- which is what Supabase `auth.uid()` reads), reads `public.v_orders` through RLS
-- as each, and shows exactly which internal-economics fields each identity gets.
--
-- EXPECTED RESULT (the guarantee):
--   * owner      → real total_true_cost / gross_profit / gross_margin /
--                  total_commission / total_expenses / net_profit; can_see_internal = true
--   * sales_rep  → NULL for ALL SIX internal fields; can_see_internal = false;
--                  sees ONLY their own book (1 row), never the other rep's order
--
-- The final SELECT prints a side-by-side proof table AND a single PASS/FAIL verdict.
-- Every DO-block `assert` also raises (aborting) if a guarantee is violated, so a
-- clean run with verdict = 'PASS' == masking + row isolation are live and correct.
--
-- SAFETY: wrapped in BEGIN … ROLLBACK — it inserts fixtures, reads them, and
-- mutates NOTHING. Paste the whole file into the Supabase SQL Editor and Run.
-- If a future GoTrue version changes required columns, adjust ONLY the three
-- auth.users inserts below.
-- ============================================================================

begin;

create temp table _diag (
  actor            text,
  rows_visible     int,
  sees_other_book  boolean,
  can_see_internal boolean,
  total_true_cost  numeric,
  gross_profit     numeric,
  gross_margin     numeric,
  total_commission numeric,
  total_expenses   numeric,
  net_profit       numeric
) on commit drop;

-- ---- identities (as postgres; the profile auto-trigger then fires) ----------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','diag-owner@test.local','{}','{"full_name":"Diag Owner"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','diag-rep1@test.local','{}','{"full_name":"Diag Rep One"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','diag-rep2@test.local','{}','{"full_name":"Diag Rep Two"}', now(), now());

-- Force deterministic roles (auto-trigger only makes the very first user owner).
update public.profiles set role='owner',     status='active', full_name='Diag Owner'   where id='00000000-0000-0000-0000-0000000000a1';
update public.profiles set role='sales_rep', status='active', full_name='Diag Rep One' where id='00000000-0000-0000-0000-0000000000b1';
update public.profiles set role='sales_rep', status='active', full_name='Diag Rep Two' where id='00000000-0000-0000-0000-0000000000b2';

-- Clients assigned to distinct reps (book boundaries).
insert into public.clients (id, company_name, status, assigned_rep_id)
values
  ('00000000-0000-0000-0000-0000000000c1','Diag Client One','active','00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2','Diag Client Two','active','00000000-0000-0000-0000-0000000000b2');

-- ---- become the ADMIN/OWNER to create issued orders (triggers compute cost/GP) --
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

insert into public.invoices (id, invoice_number, client_id, sales_rep_id, sales_rep_name, status, currency, issue_date, due_date, client_snapshot)
values
  ('00000000-0000-0000-0000-0000000000d1','AUR-DIAG1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','Diag Rep One','sent','USD', current_date, current_date + 30, '{"company_name":"Diag Client One"}'),
  ('00000000-0000-0000-0000-0000000000d2','AUR-DIAG2','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2','Diag Rep Two','sent','USD', current_date, current_date + 30, '{"company_name":"Diag Client Two"}');

-- Lines drive trigger-computed economics (rev 200, cost 120, gross profit 80 each).
insert into public.invoice_items (invoice_id, sku, product_name, manufacturer_name, quantity, unit_price, unit_true_cost)
values
  ('00000000-0000-0000-0000-0000000000d1','SKU-1','Widget','Diag Manufacturer',2,100,60),
  ('00000000-0000-0000-0000-0000000000d2','SKU-1','Widget','Diag Manufacturer',2,100,60);

-- Commission + expense on inv1 so total_commission / total_expenses / net_profit are non-null for the owner.
insert into public.commissions (invoice_id, recipient_id, recipient_type, recipient_name, commission_type, rate, status)
values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','internal_user','Diag Rep One','flat',25,'earned');
insert into public.order_expenses (invoice_id, type, amount, note)
values ('00000000-0000-0000-0000-0000000000d1','outbound_shipping',10,'freight');

-- Capture what the OWNER sees for inv1 (should be fully populated) + row count.
insert into _diag
select 'owner',
       (select count(*)::int from public.v_orders),
       exists (select 1 from public.v_orders where invoice_number='AUR-DIAG2'),
       o.can_see_internal, o.total_true_cost, o.gross_profit, o.gross_margin,
       o.total_commission, o.total_expenses, o.net_profit
from public.v_orders o
where o.invoice_number = 'AUR-DIAG1';
reset role;

-- ---- become SALES REP ONE and read the SAME order through RLS ----------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

-- Capture what REP ONE sees for inv1 (their own book row: visible, economics NULL).
insert into _diag
select 'sales_rep',
       (select count(*)::int from public.v_orders),
       exists (select 1 from public.v_orders where invoice_number='AUR-DIAG2'),
       o.can_see_internal, o.total_true_cost, o.gross_profit, o.gross_margin,
       o.total_commission, o.total_expenses, o.net_profit
from public.v_orders o
where o.invoice_number = 'AUR-DIAG1';
reset role;

-- ---- hard assertions (abort on any violation) --------------------------------
do $$
declare ow _diag%rowtype; rp _diag%rowtype;
begin
  select * into ow from _diag where actor='owner';
  select * into rp from _diag where actor='sales_rep';

  -- Owner: every internal-economics field is real; sees both books.
  assert ow.rows_visible = 2,               'owner must see both orders (company-wide)';
  assert ow.can_see_internal is true,       'owner can_see_internal must be true';
  assert ow.total_true_cost = 120,          'owner must see real total_true_cost (120)';
  assert ow.gross_profit    = 80,           'owner must see real gross_profit (80)';
  assert ow.gross_margin is not null,       'owner must see real gross_margin';
  assert ow.total_commission is not null,   'owner must see real total_commission';
  assert ow.total_expenses  is not null,    'owner must see real total_expenses';
  assert ow.net_profit      is not null,    'owner must see real net_profit';

  -- Sales rep: sees ONLY their own book, and EVERY internal field is NULL.
  assert rp.rows_visible = 1,               'rep must see exactly their own 1 order';
  assert rp.sees_other_book is false,       'rep must NOT see the other rep''s order (row isolation)';
  assert rp.can_see_internal is false,      'rep can_see_internal must be false';
  assert rp.total_true_cost  is null,       'rep total_true_cost must be NULL (masked)';
  assert rp.gross_profit     is null,       'rep gross_profit must be NULL (masked)';
  assert rp.gross_margin     is null,       'rep gross_margin must be NULL (masked)';
  assert rp.total_commission is null,       'rep total_commission must be NULL (masked)';
  assert rp.total_expenses   is null,       'rep total_expenses must be NULL (masked)';
  assert rp.net_profit       is null,       'rep net_profit must be NULL (masked)';

  raise notice 'OK  v_orders masking + row isolation verified behaviorally (owner real, rep NULL)';
end $$;

-- ---- human-readable proof table + single verdict -----------------------------
select
  actor,
  rows_visible,
  sees_other_book,
  can_see_internal,
  total_true_cost,
  gross_profit,
  gross_margin,
  total_commission,
  total_expenses,
  net_profit,
  case
    when actor='owner' and can_see_internal and net_profit is not null and gross_profit = 80 then 'PASS'
    when actor='sales_rep' and not can_see_internal and rows_visible = 1 and not sees_other_book
         and total_true_cost is null and gross_profit is null and gross_margin is null
         and total_commission is null and total_expenses is null and net_profit is null then 'PASS'
    else 'FAIL'
  end as verdict
from _diag
order by actor desc;   -- owner first, then sales_rep

rollback;
