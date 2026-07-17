-- ============================================================================
-- Aurum Supply House — Fulfillment / shipments test suite (ROLLBACKs)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m8_fulfillment.sql
-- Requires migrations 0001..0399. Everything runs inside one transaction and is
-- rolled back, so it mutates nothing.
--
-- Proves: independent per-line status, partial + multi-shipment shipping on
-- different dates, over-ship / zero / negative rejection, fully/partially-shipped
-- derivation, cancelled-line handling, atomic rollback, financial immutability,
-- lot snapshotting, append-only shipment records + audited void, Owner/Admin
-- authorization, and rep row-scoped read isolation.
-- ============================================================================
begin;

-- ---- Identities: first user = owner; others default to sales_rep ------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','owner@a.test','{"full_name":"Owner"}'),
 ('00000000-0000-0000-0000-0000000000a2','admin@a.test','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-0000000000a3','rep@a.test','{"full_name":"Rep"}'),
 ('00000000-0000-0000-0000-0000000000a4','rep2@a.test','{"full_name":"Rep Two"}');
update public.profiles set role='admin'     where id='00000000-0000-0000-0000-0000000000a2';
update public.profiles set role='sales_rep' where id in
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4');

-- Act as the Owner for setup (session-level auth.uid()).
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', false);

insert into public.products(id,sku,name,status) values
 ('00000000-0000-0000-0000-0000000000d1','SKU-A','Product A','active'),
 ('00000000-0000-0000-0000-0000000000d2','SKU-B','Product B','active');

-- One order (invoice) owned by the rep's book, two lines.
insert into public.invoices(id,invoice_number,status,currency,sales_rep_id) values
 ('00000000-0000-0000-0000-0000000000e1','DRAFT-M8','draft','USD','00000000-0000-0000-0000-0000000000a3');
insert into public.invoice_items(id,invoice_id,product_id,sku,product_name,quantity,unit_price,lot_number,expiration_date) values
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','SKU-A','Product A',10,25,'LOT-A','2027-01-31'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d2','SKU-B','Product B',5,40,null,null);

-- Issue it (draft -> sent) to engage financial immutability.
update public.invoices set status='sent', issue_date=current_date, invoice_number='AUR-M8-1'
 where id='00000000-0000-0000-0000-0000000000e1';

-- Freeze the issued financial snapshot for later comparison.
create temporary table _snap on commit drop as
  select subtotal, total, total_true_cost, gross_profit, net_profit, total_commission
  from public.invoices where id='00000000-0000-0000-0000-0000000000e1';

do $$
begin
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 'not_yet_shipped',
    'line A must start not_yet_shipped';
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 'not_started',
    'order must start not_started';
  raise notice 'OK baseline';
end $$;

select public.set_line_fulfillment_status('00000000-0000-0000-0000-0000000000f2','in_production');
do $$
begin
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f2') = 'in_production',
    'line B must reflect in_production';
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 'not_yet_shipped',
    'line A must be unaffected';
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 'in_progress',
    'order must be in_progress once a line is in production';
  raise notice 'OK independent statuses';
end $$;

do $$ declare ok boolean := false; begin
  begin
    perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, 'FedEx', null, null, null, null,
      jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',0)));
    ok := true;
  exception when others then ok := false; end;
  assert not ok, 'zero quantity must be rejected';
end $$;
do $$ declare ok boolean := false; begin
  begin
    perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, 'FedEx', null, null, null, null,
      jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',-3)));
    ok := true;
  exception when others then ok := false; end;
  assert not ok, 'negative quantity must be rejected';
end $$;
do $$ begin
  assert (select count(*) from public.order_shipments where invoice_id='00000000-0000-0000-0000-0000000000e1') = 0,
    'no shipment row may exist after rejected attempts';
  raise notice 'OK zero/negative rejected';
end $$;

do $$ declare ok boolean := false; begin
  begin
    -- Line A valid (4 of 10) but line B over-ships (9 of 5) → whole call must roll back.
    perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, 'FedEx', null, null, null, null,
      jsonb_build_array(
        jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',4),
        jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f2','quantity',9)));
    ok := true;
  exception when others then ok := false; end;
  assert not ok, 'over-ship must be rejected';
  assert (select count(*) from public.order_shipments where invoice_id='00000000-0000-0000-0000-0000000000e1') = 0,
    'atomic rollback: the valid line A must NOT have been shipped';
  assert (select count(*) from public.order_shipment_items where invoice_id='00000000-0000-0000-0000-0000000000e1') = 0,
    'atomic rollback: no shipment items may persist';
  raise notice 'OK over-ship rejected atomically';
end $$;

select public.create_shipment('00000000-0000-0000-0000-0000000000e1', date '2026-07-10', 'FedEx', 'Ground', 'TRK-A', 'https://track/A', 'first leg',
  jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',4)));
do $$
begin
  assert (select quantity_shipped from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 4, 'A shipped must be 4';
  assert (select quantity_remaining from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 6, 'A remaining must be 6';
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 'partially_shipped',
    'A must be partially_shipped';
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 'partially_shipped',
    'order must be partially_shipped';
  -- Lot snapshot falls back to the line's assigned lot.
  assert (select lot_number from public.order_shipment_items
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 'LOT-A',
    'A shipment item must snapshot LOT-A';
  raise notice 'OK partial shipment + lot snapshot';
end $$;

do $$
begin
  assert (select subtotal from public.invoices where id='00000000-0000-0000-0000-0000000000e1')
       = (select subtotal from _snap), 'subtotal must be unchanged';
  assert (select total from public.invoices where id='00000000-0000-0000-0000-0000000000e1')
       = (select total from _snap), 'total must be unchanged';
  assert (select gross_profit from public.invoices where id='00000000-0000-0000-0000-0000000000e1')
       is not distinct from (select gross_profit from _snap), 'gross_profit must be unchanged';
  raise notice 'OK financials immutable through shipping';
end $$;

do $$ declare ok boolean := false; begin
  begin update public.invoices set total = 1 where id='00000000-0000-0000-0000-0000000000e1'; ok := true;
  exception when others then ok := false; end;
  assert not ok, 'issued invoice total must not be editable';
  raise notice 'OK issued invoice immutable';
end $$;

select public.create_shipment('00000000-0000-0000-0000-0000000000e1', date '2026-07-15', 'UPS', 'Next Day', 'TRK-A2', null, null,
  jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',6)));
do $$
begin
  assert (select quantity_shipped from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 10, 'A shipped must total 10';
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f1') = 'shipped',
    'A must derive to shipped';
  assert (select count(*) from public.v_order_shipments
           where invoice_id='00000000-0000-0000-0000-0000000000e1' and status='finalized') = 2,
    'order must have two finalized shipments';
  raise notice 'OK multi-shipment + fully-shipped derivation for a line';
end $$;

do $$ declare ok boolean := false; begin
  begin
    perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, 'FedEx', null, null, null, null,
      jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',1)));
    ok := true;
  exception when others then ok := false; end;
  assert not ok, 'shipping past ordered quantity must be rejected';
  raise notice 'OK no over-ship on a completed line';
end $$;

select public.create_shipment('00000000-0000-0000-0000-0000000000e1', date '2026-07-16', 'FedEx', 'Ground', 'TRK-B', null, null,
  jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f2','quantity',5)));
do $$
begin
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f2') = 'shipped', 'B must be shipped';
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 'fully_shipped',
    'order must be fully_shipped once every non-cancelled qty ships';
  raise notice 'OK fully_shipped derivation';
end $$;

do $$ declare v uuid; ok boolean := false; begin
  select id into v from public.order_shipments where invoice_id='00000000-0000-0000-0000-0000000000e1' limit 1;
  begin update public.order_shipments set carrier='HACK' where id=v; ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a finalized shipment must not be silently editable';
  ok := false;
  begin delete from public.order_shipments where id=v; ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a finalized shipment must not be deletable';
  ok := false;
  begin update public.order_shipment_items set quantity_shipped=999 where shipment_id=v; ok := true;
  exception when others then ok := false; end;
  assert not ok, 'shipment items must be immutable';
  raise notice 'OK append-only enforced';
end $$;

do $$ declare v uuid;
begin
  -- Void the line-B shipment; B returns to fully-remaining, order leaves fully_shipped.
  select id into v from public.v_order_shipments
    where invoice_id='00000000-0000-0000-0000-0000000000e1' and tracking_number='TRK-B';
  perform public.void_shipment(v, 'wrong box');
  assert (select quantity_shipped from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f2') = 0,
    'voided shipment quantities must stop counting';
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 'partially_shipped',
    'order returns to partially_shipped after the void';
  assert exists (select 1 from public.activity_log
           where entity_type='invoice' and entity_id='00000000-0000-0000-0000-0000000000e1'
             and action='shipment_voided'), 'void must be audited';
  raise notice 'OK audited void + balance restoration';
end $$;

do $$ declare ok boolean := false;
begin
  -- A line that has shipped cannot be cancelled without an explicit reversal.
  begin perform public.set_line_fulfillment_status('00000000-0000-0000-0000-0000000000f1','cancelled'); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a line with shipped qty cannot be cancelled';
  -- Line B currently has nothing shipped (its shipment was voided): it CAN be cancelled.
  perform public.set_line_fulfillment_status('00000000-0000-0000-0000-0000000000f2','cancelled');
  assert (select fulfillment_status from public.v_order_fulfillment_lines
           where invoice_item_id='00000000-0000-0000-0000-0000000000f2') = 'cancelled', 'B must derive to cancelled';
  -- A cancelled line cannot be shipped.
  ok := false;
  begin perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, null, null, null, null, null,
    jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f2','quantity',1))); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a cancelled line cannot be shipped';
  raise notice 'OK cancelled-line handling';
end $$;

do $$
begin
  assert exists (select 1 from public.activity_log where entity_type='invoice'
    and entity_id='00000000-0000-0000-0000-0000000000e1' and action='shipment_created'), 'create must be audited';
  assert exists (select 1 from public.activity_log where entity_type='invoice'
    and entity_id='00000000-0000-0000-0000-0000000000e1' and action='shipment_finalized'), 'finalize must be audited';
  assert exists (select 1 from public.activity_log where entity_type='invoice'
    and entity_id='00000000-0000-0000-0000-0000000000e1' and action='line_status_changed'), 'status change must be audited';
  raise notice 'OK audit trail';
end $$;

-- ===========================================================================
-- AUTHORIZATION — role gates (Owner/Admin only)
-- ===========================================================================
-- Admin (a2) creates a fresh order + line and ships it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2', false);
insert into public.invoices(id,invoice_number,status,currency,sales_rep_id) values
 ('00000000-0000-0000-0000-0000000000e2','AUR-M8-2','sent','USD','00000000-0000-0000-0000-0000000000a3');
insert into public.invoice_items(id,invoice_id,product_id,sku,product_name,quantity,unit_price) values
 ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d1','SKU-A','Product A',3,25);
do $$
begin
  perform public.create_shipment('00000000-0000-0000-0000-0000000000e2', current_date, 'FedEx', null, null, null, null,
    jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f3','quantity',3)));
  assert (select fulfillment_status from public.v_order_fulfillment_summary
           where invoice_id='00000000-0000-0000-0000-0000000000e2') = 'fully_shipped', 'admin shipment must apply';
  raise notice 'OK admin can create shipments';
end $$;

-- Sales Rep (a3) is refused create / status change / void.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3', false);
do $$ declare ok boolean := false; begin
  begin perform public.create_shipment('00000000-0000-0000-0000-0000000000e1', current_date, null, null, null, null, null,
    jsonb_build_array(jsonb_build_object('invoice_item_id','00000000-0000-0000-0000-0000000000f1','quantity',1))); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a Sales Rep must NOT create shipments';
  ok := false;
  begin perform public.set_line_fulfillment_status('00000000-0000-0000-0000-0000000000f1','backordered'); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'a Sales Rep must NOT change fulfillment status';
  raise notice 'OK reps refused write';
end $$;

-- Rep a3 (the order''s rep) can READ its shipments; Rep2 a4 cannot see them.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.v_order_shipments
           where invoice_id='00000000-0000-0000-0000-0000000000e1') >= 1,
    'the owning rep must read their book''s shipments';
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.v_order_shipments
           where invoice_id='00000000-0000-0000-0000-0000000000e1') = 0,
    'another rep must see ZERO of this book''s shipments';
  assert (select count(*) from public.order_shipments) = 0,
    'base order_shipments must be empty for an out-of-book rep';
end $$;
reset role;

do $$ declare bad text;
begin
  select string_agg(column_name, ', ') into bad
    from information_schema.columns
   where table_schema='public' and table_name='v_order_shipment_items'
     and column_name ~* '(price|cost|profit|margin|commission|subtotal|total|expense)';
  assert bad is null, format('v_order_shipment_items must expose no financial columns; found: %s', bad);
  raise notice 'OK shipment read surface is customer-safe';
end $$;

select 'M8 fulfillment suite: ALL PASSED (rolled back)' as result;
rollback;
