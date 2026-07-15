-- ============================================================================
-- Aurum Supply House — M6 purchase-order test suite (non-destructive; ROLLBACKs)
--   psql "$DATABASE_URL" -f supabase/tests/m6_purchase_orders.sql
-- Requires migrations 0001–0360 applied. Runs inside one transaction and rolls
-- back, so it never mutates real data. Owner = admin actor; rep = sales_rep.
-- ============================================================================
begin;

-- ---- Actors ----------------------------------------------------------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','o@a.test','{"full_name":"Owner"}'),
 ('33333333-3333-3333-3333-333333333333','r@a.test','{}');
update public.profiles set role='sales_rep' where email='r@a.test';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

-- ---- Fixtures --------------------------------------------------------------
insert into public.manufacturers(id,name,contact_name,email,phone,address,status) values
 ('m1000000-0000-0000-0000-000000000001','Vendor One','Pat Vendor','pat@v1.test','555','{"line1":"1 Way","city":"Reno","region":"NV","postal_code":"89501","country":"USA"}','active'),
 ('m2000000-0000-0000-0000-000000000002','Vendor Two',null,null,null,'{}','active');

insert into public.products(id,sku,name,strength,pack_size,status) values
 ('p1000000-0000-0000-0000-000000000001','SKU-1','Product One','500mg','30ct','active'),
 ('p2000000-0000-0000-0000-000000000002','SKU-2','Product Two',null,null,'active'),
 ('p3000000-0000-0000-0000-000000000003','SKU-3','Product Three (no rel)',null,null,'active');

-- Relationship V1↔P1 with MOQ 10, order-multiple 5, lead 30; base cost 100, tier(100+) cost 80
do $$
declare rel uuid;
begin
  rel := app.upsert_manufacturer_product('m1000000-0000-0000-0000-000000000001','p1000000-0000-0000-0000-000000000001',
           'MFR-P1','Vendor One P1 desc','USD',10,5,30,true,null,null,'11111111-1111-1111-1111-111111111111');
  perform app.set_manufacturer_cost(rel,1,99,100,'USD',current_date,null,true,'import',null,null,'11111111-1111-1111-1111-111111111111');
  perform app.set_manufacturer_cost(rel,100,null,80,'USD',current_date,null,true,'import',null,null,'11111111-1111-1111-1111-111111111111');
  -- V1↔P2 base 50
  rel := app.upsert_manufacturer_product('m1000000-0000-0000-0000-000000000001','p2000000-0000-0000-0000-000000000002',
           null,null,'USD',null,null,null,true,null,null,'11111111-1111-1111-1111-111111111111');
  perform app.set_manufacturer_cost(rel,1,null,50,'USD',current_date,null,true,'import',null,null,'11111111-1111-1111-1111-111111111111');
  -- V2↔P2 base 200 (for manufacturer-filtering test)
  rel := app.upsert_manufacturer_product('m2000000-0000-0000-0000-000000000002','p2000000-0000-0000-0000-000000000002',
           null,null,'USD',null,null,null,true,null,null,'11111111-1111-1111-1111-111111111111');
  perform app.set_manufacturer_cost(rel,1,null,200,'USD',current_date,null,true,'import',null,null,'11111111-1111-1111-1111-111111111111');
end $$;

\echo 'T1 save_po_draft resolves base cost (expect unit_cost 100, source base, subtotal 1000, total 1050):'
do $$
declare po uuid;
begin
  po := app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',50,0,0,current_date+7,'50% deposit','build it',
    '[{"product_id":"p1000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  perform set_config('test.po', po::text, false);
end $$;
select unit_cost, resolved_cost_source, resolved_tier_min, moq, order_multiple, lead_time_days
  from public.purchase_order_items where purchase_order_id = current_setting('test.po')::uuid;
select subtotal, total, status from public.purchase_orders where id = current_setting('test.po')::uuid;

\echo 'T2 quantity-tier selection (expect unit_cost 80, source tier, tier_min 100):'
do $$
declare po uuid;
begin
  po := app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p1000000-0000-0000-0000-000000000001","quantity":100}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  perform set_config('test.po2', po::text, false);
end $$;
select unit_cost, resolved_cost_source, resolved_tier_min from public.purchase_order_items where purchase_order_id = current_setting('test.po2')::uuid;

\echo 'T3 MOQ warning (qty 5 < MOQ 10 → below_moq present):'
select (public.resolve_manufacturer_cost('m1000000-0000-0000-0000-000000000001','p1000000-0000-0000-0000-000000000001',5,'USD',current_date)->'warnings') as warnings;

\echo 'T4 order-multiple warning (qty 7 not multiple of 5 → not_order_multiple present):'
select (public.resolve_manufacturer_cost('m1000000-0000-0000-0000-000000000001','p1000000-0000-0000-0000-000000000001',7,'USD',current_date)->'warnings') as warnings;

\echo 'T5 unresolved cost never returns zero and blocks save (expect error, no fallback):'
savepoint sp5;
do $$ begin
  perform app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p3000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'unresolved blocked: %', sqlerrm; end $$;
rollback to sp5;

\echo 'T6 manual cost requires reason (expect error then success with source manual):'
savepoint sp6;
do $$ begin
  perform app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p3000000-0000-0000-0000-000000000003","quantity":1,"manual_cost":7}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'manual-without-reason blocked: %', sqlerrm; end $$;
rollback to sp6;
do $$
declare po uuid;
begin
  po := app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p3000000-0000-0000-0000-000000000003","quantity":1,"manual_cost":7,"manual_reason":"one-off sample"}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  perform set_config('test.po_manual', po::text, false);
end $$;
select unit_cost, resolved_cost_source, cost_reason from public.purchase_order_items where purchase_order_id = current_setting('test.po_manual')::uuid;

\echo 'T7 atomic rollback: one good + one unresolved line → nothing persists:'
savepoint sp7;
do $$ begin
  perform app.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p1000000-0000-0000-0000-000000000001","quantity":10},
      {"product_id":"p3000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'atomic save rolled back: %', sqlerrm; end $$;
rollback to sp7;

\echo 'T8 send_po allocates a number and locks (expect PO-#### and status sent):'
select app.send_po(current_setting('test.po')::uuid,'11111111-1111-1111-1111-111111111111') as po_number;
select status, sent_at is not null as has_sent_at from public.purchase_orders where id = current_setting('test.po')::uuid;

\echo 'T9 snapshot preservation: change base cost to 120; sent PO line stays 100:'
do $$
declare rel uuid;
begin
  select id into rel from public.manufacturer_products
   where manufacturer_id='m1000000-0000-0000-0000-000000000001' and product_id='p1000000-0000-0000-0000-000000000001';
  perform app.set_manufacturer_cost(rel,1,99,120,'USD',current_date,null,true,'manual','price increase',null,'11111111-1111-1111-1111-111111111111');
end $$;
select unit_cost as still_100 from public.purchase_order_items where purchase_order_id = current_setting('test.po')::uuid;

\echo 'T10 sent-PO immutability: editing financials / line items is rejected:'
savepoint sp10a;
do $$ begin
  update public.purchase_orders set total = 1 where id = current_setting('test.po')::uuid;
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'sent PO financial edit blocked: %', sqlerrm; end $$;
rollback to sp10a;
savepoint sp10b;
do $$ begin
  update public.purchase_order_items set quantity = 999 where purchase_order_id = current_setting('test.po')::uuid;
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'sent PO line edit blocked: %', sqlerrm; end $$;
rollback to sp10b;

\echo 'T11 invalid transition sent→shipped rejected; valid sent→confirmed ok:'
savepoint sp11;
do $$ begin
  perform app.transition_po_status(current_setting('test.po')::uuid,'shipped',null,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'invalid transition blocked: %', sqlerrm; end $$;
rollback to sp11;
select app.transition_po_status(current_setting('test.po')::uuid,'confirmed','vendor confirmed','11111111-1111-1111-1111-111111111111');
select status from public.purchase_orders where id = current_setting('test.po')::uuid;

\echo 'T12 payments: deposit 400 + balance 650 (total 1050) → paid 1050, balance 0:'
select app.record_manufacturer_payment(current_setting('test.po')::uuid,'deposit',400,current_date,'wire','dep-1',null,'11111111-1111-1111-1111-111111111111');
select app.record_manufacturer_payment(current_setting('test.po')::uuid,'balance',650,current_date,'wire','bal-1',null,'11111111-1111-1111-1111-111111111111');
select amount_paid, balance_due from public.purchase_orders where id = current_setting('test.po')::uuid;

\echo 'T13 refund/credit 100 reduces paid (expect paid 950, balance 100):'
select app.record_manufacturer_payment(current_setting('test.po')::uuid,'refund_credit',100,current_date,'wire','ref-1',null,'11111111-1111-1111-1111-111111111111');
select amount_paid, balance_due from public.purchase_orders where id = current_setting('test.po')::uuid;

\echo 'T14 overpayment rejected (paying 500 over the 100 balance):'
savepoint sp14;
do $$ begin
  perform app.record_manufacturer_payment(current_setting('test.po')::uuid,'additional',500,current_date,'wire','over-1',null,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'overpayment blocked: %', sqlerrm; end $$;
rollback to sp14;

\echo 'T15 duplicate-payment prevention (identical entry within 2 min):'
savepoint sp15;
do $$ begin
  perform app.record_manufacturer_payment(current_setting('test.po')::uuid,'deposit',400,current_date,'wire','dep-1',null,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'duplicate payment blocked: %', sqlerrm; end $$;
rollback to sp15;

\echo 'T16 payment against a DRAFT PO rejected:'
savepoint sp16;
do $$ begin
  perform app.record_manufacturer_payment(current_setting('test.po2')::uuid,'deposit',10,current_date,'wire',null,null,'11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'payment on draft blocked: %', sqlerrm; end $$;
rollback to sp16;

\echo 'T17 receiving workflow: advance to shipped→received, receive a line (expect a receipt row):'
select app.transition_po_status(current_setting('test.po')::uuid,'deposit_paid',null,'11111111-1111-1111-1111-111111111111');
select app.transition_po_status(current_setting('test.po')::uuid,'production',null,'11111111-1111-1111-1111-111111111111');
select app.transition_po_status(current_setting('test.po')::uuid,'testing',null,'11111111-1111-1111-1111-111111111111');
select app.transition_po_status(current_setting('test.po')::uuid,'ready_to_ship',null,'11111111-1111-1111-1111-111111111111');
select app.transition_po_status(current_setting('test.po')::uuid,'shipped',null,'11111111-1111-1111-1111-111111111111');
select app.transition_po_status(current_setting('test.po')::uuid,'received',null,'11111111-1111-1111-1111-111111111111');
do $$
declare it uuid;
begin
  select id into it from public.purchase_order_items where purchase_order_id = current_setting('test.po')::uuid limit 1;
  perform app.receive_po_line(it,10,current_date,'LOTPO-1','all received',null,'11111111-1111-1111-1111-111111111111');
end $$;
select count(*) as receipts, sum(quantity_received) as qty from public.purchase_order_receipts where purchase_order_id = current_setting('test.po')::uuid;

\echo 'T18 void from received is rejected (goods already received):'
savepoint sp18;
do $$ begin
  perform app.void_po(current_setting('test.po')::uuid,'changed mind','11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'void after receipt blocked: %', sqlerrm; end $$;
rollback to sp18;

\echo 'T19 PO views expose NO customer profit fields (expect 0 rows for each name):'
select count(*) as leaks from information_schema.columns
 where table_schema='public' and table_name in ('v_purchase_orders','v_purchase_order_items')
   and column_name in ('gross_profit','gross_margin','net_profit','selling_price','commission');

-- ---- Sales-rep denial + cost masking --------------------------------------
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);

\echo 'T20 rep sees ZERO purchase orders / items / payments (RLS):'
select
 (select count(*) from public.purchase_orders)            as po_rows,
 (select count(*) from public.purchase_order_items)       as item_rows,
 (select count(*) from public.manufacturer_payments)      as payment_rows,
 (select count(*) from public.v_purchase_orders)          as view_rows,
 (select count(*) from public.manufacturer_product_costs) as cost_rows;

\echo 'T21 rep cannot resolve manufacturer cost (expect error, admin-only):'
savepoint sp21;
do $$ begin
  perform public.resolve_manufacturer_cost('m1000000-0000-0000-0000-000000000001','p1000000-0000-0000-0000-000000000001',10,'USD',current_date);
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'rep cost resolution blocked: %', sqlerrm; end $$;
rollback to sp21;

\echo 'T22 rep cannot create a purchase order (expect error):'
savepoint sp22;
do $$ begin
  perform public.save_po_draft(null,'m1000000-0000-0000-0000-000000000001','USD',0,0,0,null,null,null,
    '[{"product_id":"p1000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb);
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'rep PO create blocked: %', sqlerrm; end $$;
rollback to sp22;

rollback;
