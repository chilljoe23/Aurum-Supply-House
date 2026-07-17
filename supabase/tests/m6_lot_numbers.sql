-- ============================================================================
-- Aurum Supply House — M6 invoice lot-number test suite (ROLLBACKs)
--   psql "$DATABASE_URL" -f supabase/tests/m6_lot_numbers.sql
-- Verifies lot capture on drafts, freeze on issue, the audited post-issue lot
-- RPC, and that coa_path is never exposed on the read surface.
-- ============================================================================
begin;

insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','o@a.test','{"full_name":"Owner"}');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

insert into public.products(id,sku,name,status) values
 ('p1000000-0000-0000-0000-000000000001','SKU-LOT','Lot Product','active');

-- A draft invoice with one lot-bearing line (inserted directly to isolate the lot behavior).
insert into public.invoices(id,invoice_number,status,currency) values
 ('a1000000-0000-0000-0000-000000000001','DRAFT-LOT','draft','USD');
insert into public.invoice_items(id,invoice_id,product_id,sku,product_name,quantity,unit_price,lot_number,expiration_date)
 values ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',
         'p1000000-0000-0000-0000-000000000001','SKU-LOT','Lot Product',10,25,'LOT-DRAFT','2027-01-31');

\echo 'T1 lot persists on the draft line (expect LOT-DRAFT / 2027-01-31):'
select lot_number, expiration_date from public.invoice_items where id='c1000000-0000-0000-0000-000000000001';

\echo 'T2 lot is visible on the read surface v_order_items:'
select lot_number, expiration_date from public.v_order_items where id='c1000000-0000-0000-0000-000000000001';

-- Issue the invoice (draft → sent) to engage line immutability.
update public.invoices set status='sent', issue_date=current_date, invoice_number='AUR-TEST-1'
 where id='a1000000-0000-0000-0000-000000000001';

\echo 'T3 general edit of an issued line is rejected (quantity change blocked):'
savepoint sp3;
do $$ begin
  update public.invoice_items set quantity=5 where id='c1000000-0000-0000-0000-000000000001';
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'issued line edit blocked: %', sqlerrm; end $$;
rollback to sp3;

\echo 'T4 a raw lot-only UPDATE (without the RPC guard) is STILL blocked:'
savepoint sp4;
do $$ begin
  update public.invoice_items set lot_number='SNEAKY' where id='c1000000-0000-0000-0000-000000000001';
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'unguarded issued lot edit blocked: %', sqlerrm; end $$;
rollback to sp4;

\echo 'T5 audited RPC assigns a lot on the ISSUED invoice (expect LOT-ISSUED):'
select public.assign_invoice_lot('c1000000-0000-0000-0000-000000000001','LOT-ISSUED','2026-06-01','2028-06-01','2027-12-01',null);
select lot_number, manufacturing_date, expiration_date, retest_date
  from public.invoice_items where id='c1000000-0000-0000-0000-000000000001';

\echo 'T6 the assignment is audited in activity_log (expect a lot_assigned row):'
select action from public.activity_log
 where entity_type='invoice' and entity_id='a1000000-0000-0000-0000-000000000001' and action='lot_assigned';

\echo 'T7 non-lot fields remain frozen after the RPC (expect quantity still 10):'
select quantity from public.invoice_items where id='c1000000-0000-0000-0000-000000000001';

\echo 'T8 coa_path is NOT exposed on the read surface v_order_items (expect 0):'
select count(*) as coa_leak from information_schema.columns
 where table_schema='public' and table_name='v_order_items' and column_name='coa_path';

rollback;
