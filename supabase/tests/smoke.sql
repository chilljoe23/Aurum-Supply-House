-- ============================================================================
-- Aurum Supply House — business-rule + RLS smoke test
-- ----------------------------------------------------------------------------
-- Safe & non-destructive: everything runs inside a transaction that ROLLBACKs.
-- Intended for a scratch/local database with the migrations applied.
-- Business-rule checks run as the DB owner; the RLS section switches to the
-- `authenticated` role and simulates JWT subjects.
-- Run:  psql "$DATABASE_URL" -f supabase/tests/smoke.sql
-- ============================================================================
begin;

-- Seed identities (first profile becomes owner via trigger).
insert into auth.users(id,email,raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','owner@aurum.test','{"full_name":"Owner"}'),
  ('22222222-2222-2222-2222-222222222222','rep@aurum.test','{"full_name":"Rep One"}'),
  ('33333333-3333-3333-3333-333333333333','rep2@aurum.test','{"full_name":"Rep Two"}');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

insert into public.manufacturers(id,name) values ('aaaaaaa1-0000-0000-0000-000000000001','Acme Labs');
insert into public.products(id,sku,name,manufacturer_id) values ('bbbbbbb1-0000-0000-0000-000000000001','AUR-500','Aurum 500mg','aaaaaaa1-0000-0000-0000-000000000001');
insert into public.product_cost_history(product_id,true_cost,effective_date,source) values ('bbbbbbb1-0000-0000-0000-000000000001',10.00,'2026-01-01','manual');
insert into public.pricing_sheets(id,name,is_default) values ('ccccccc1-0000-0000-0000-000000000001','Pricing A',true);
insert into public.pricing_sheet_items(id,pricing_sheet_id,product_id,selling_price) values ('c1111111-0000-0000-0000-000000000001','ccccccc1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001',25.00);
insert into public.pricing_tiers(pricing_sheet_item_id,min_qty,max_qty,unit_price) values ('c1111111-0000-0000-0000-000000000001',100,null,22.00);
insert into public.clients(id,company_name,assigned_rep_id,default_pricing_sheet_id) values ('ddddddd1-0000-0000-0000-000000000001','Beta Pharma','22222222-2222-2222-2222-222222222222','ccccccc1-0000-0000-0000-000000000001');
insert into public.clients(id,company_name,assigned_rep_id) values ('ddddddd2-0000-0000-0000-000000000002','Gamma Meds','33333333-3333-3333-3333-333333333333');

\echo '== price resolution (expect 25 assigned / 22 tier / 19.50 override) =='
select price, source from app.resolve_price('ddddddd1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001',1);
select price, source from app.resolve_price('ddddddd1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001',150);
insert into public.client_price_overrides(client_id,product_id,selling_price) values ('ddddddd1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001',19.50);
select price, source from app.resolve_price('ddddddd1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001',150);

insert into public.invoices(id,invoice_number,client_id,sales_rep_id,sales_rep_name,pricing_sheet_id,pricing_sheet_name,status,shipping,issue_date)
  values ('eeeeeee1-0000-0000-0000-000000000001', app.next_document_number('invoice','INV'),'ddddddd1-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Rep One','ccccccc1-0000-0000-0000-000000000001','Pricing A','draft',15.00,current_date);
insert into public.invoice_items(invoice_id,product_id,sku,product_name,quantity,unit_price,unit_true_cost,lot_number,expiration_date)
  values ('eeeeeee1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001','AUR-500','Aurum 500mg',100,19.50,10.00,'LOT-2026-07','2028-07-01');

\echo '== invoice economics + expenses (expect GP 950; after 100 expenses net 850) =='
select subtotal, gross_profit, net_profit from public.invoices where id='eeeeeee1-0000-0000-0000-000000000001';
insert into public.order_expenses(invoice_id,type,amount) values ('eeeeeee1-0000-0000-0000-000000000001','payment_processing_fee',60),('eeeeeee1-0000-0000-0000-000000000001','outbound_shipping',40);
select total_expenses, net_profit from public.invoices where id='eeeeeee1-0000-0000-0000-000000000001';

\echo '== internal + external commissions (expect total 170; net 680) =='
insert into public.commissions(invoice_id,recipient_id,recipient_type,recipient_name,commission_type,rate) values ('eeeeeee1-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','internal_user','Rep One','percent_of_gross_profit',0.10);
insert into public.commissions(invoice_id,recipient_type,recipient_name,recipient_email,commission_type,rate) values ('eeeeeee1-0000-0000-0000-000000000001','external_partner','Referral LLC','pay@referral.com','flat',75);
select total_commission, net_profit from public.invoices where id='eeeeeee1-0000-0000-0000-000000000001';

\echo '== PO manufacturer payment ledger (expect paid 9500 / balance 500 after refund) =='
insert into public.purchase_orders(id,po_number,manufacturer_id,status) values ('fff00001-0000-0000-0000-000000000001', app.next_document_number('purchase_order','PO'),'aaaaaaa1-0000-0000-0000-000000000001','draft');
insert into public.purchase_order_items(purchase_order_id,product_id,sku,name,quantity,unit_cost) values ('fff00001-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001','AUR-500','Aurum 500mg',1000,10.00);
insert into public.manufacturer_payments(purchase_order_id,type,amount) values ('fff00001-0000-0000-0000-000000000001','deposit',3000),('fff00001-0000-0000-0000-000000000001','balance',7000),('fff00001-0000-0000-0000-000000000001','refund_credit',500);
select amount_paid, balance_due from public.purchase_orders where id='fff00001-0000-0000-0000-000000000001';

\echo '== immutability: sending then editing a locked invoice must ERROR =='
update public.invoices set status='sent' where id='eeeeeee1-0000-0000-0000-000000000001';
\echo '(the next statement is expected to fail)'
savepoint before_lock;
update public.invoices set subtotal = 1 where id='eeeeeee1-0000-0000-0000-000000000001';
rollback to before_lock;

\echo '== RLS: Rep One sees only Beta Pharma; Rep Two sees only Gamma Meds =='
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
select company_name as rep_one_clients from public.clients order by 1;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
select company_name as rep_two_clients from public.clients order by 1;
reset role;

rollback;
\echo '== smoke test complete (all changes rolled back) =='
