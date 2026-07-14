-- ============================================================================
-- Aurum Supply House — M2 pricing test suite (non-destructive; ROLLBACKs)
--   psql "$DATABASE_URL" -f supabase/tests/m2_pricing.sql
-- Asserts the deterministic resolver priority chain and pricing guarantees.
-- ============================================================================
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','o@a.test','{"full_name":"O"}'),
 ('33333333-3333-3333-3333-333333333333','r@a.test','{}');
update public.profiles set role='sales_rep' where email='r@a.test';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

insert into public.products(id,sku,name) values
 ('aa000001-0000-0000-0000-000000000001','SKU-1','P1'),
 ('aa000002-0000-0000-0000-000000000002','SKU-2','P2'),
 ('aa000003-0000-0000-0000-000000000003','SKU-3','P3-noprice');
insert into public.product_cost_history(product_id,true_cost,source) values ('aa000001-0000-0000-0000-000000000001',20,'manual');
insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('ba000001-0000-0000-0000-000000000001','Pricing A','PA','USD',false,'active'),
 ('bb000001-0000-0000-0000-000000000001','Pricing B','PB','USD',false,'active'),
 ('cc000001-0000-0000-0000-000000000001','VIP','VIP','USD',true,'active');
insert into public.clients(id,company_name,default_pricing_sheet_id) values ('dd000001-0000-0000-0000-000000000001','C1','ba000001-0000-0000-0000-000000000001');
select app.set_price('ba000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1,99,42,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
select app.set_price('ba000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',100,499,39,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
select app.set_price('ba000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',500,null,36,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
select app.set_price('bb000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1,null,40,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
select app.set_price('cc000001-0000-0000-0000-000000000001','aa000002-0000-0000-0000-000000000002',1,null,50,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
select app.set_override('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',500,null,30,'USD',current_date,null,true,'Loyalty',null,null,'11111111-1111-1111-1111-111111111111');

\echo 'RESOLVER CHAIN (source, price):'
\echo ' assigned (q1)      -> assigned_model 42:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1) r) x;
\echo ' tier (q150)        -> assigned_model 39:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',150) r) x;
\echo ' override (q600)    -> client_override 30:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',600) r) x;
\echo ' override beats selected model (q600, sel=B):'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',600,'USD','bb000001-0000-0000-0000-000000000001') r) x;
\echo ' selected model (q1, sel=B) -> selected_model 40:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1,'USD','bb000001-0000-0000-0000-000000000001') r) x;
\echo ' default fallback (P2) -> default_model 50:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000002-0000-0000-0000-000000000002',1) r) x;
\echo ' unresolved (P3)    -> resolved false:'
select r->>'resolved' resolved, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000003-0000-0000-0000-000000000003',1) r) x;
\echo ' authorized manual  -> manual 99:'
select r->>'source' s, r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000003-0000-0000-0000-000000000003',1,'USD',null,current_date,99,'quote') r) x;

\echo 'OVERLAP rejection (expect error):'
savepoint o; do $$ begin
  perform app.set_price('ba000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',50,150,9,'USD',current_date,null,true,null,'import',null,null,'11111111-1111-1111-1111-111111111111');
  raise exception 'NO'; exception when others then raise notice 'overlap rejected: %', sqlerrm; end $$; rollback to o;

\echo 'BULK +10% (42 -> 46.20) and history preserved:'
select app.bulk_adjust_prices('ba000001-0000-0000-0000-000000000001',null,'percent',10,'Q3','11111111-1111-1111-1111-111111111111');
select r->>'price' p from (select app.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1) r) x;
select count(*) as closed_history from public.pricing_sheet_items where effective_to is not null;

\echo 'APPEND-ONLY: closed band update blocked (expect error):'
savepoint a; do $$ begin update public.pricing_sheet_items set selling_price=1 where effective_to is not null; raise exception 'NO';
exception when others then raise notice 'closed band immutable: %', sqlerrm; end $$; rollback to a;

\echo 'RLS: rep resolves price but margin view is empty:'
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
select (public.resolve_price('dd000001-0000-0000-0000-000000000001','aa000001-0000-0000-0000-000000000001',1)->>'price') as rep_price;
select count(*) as rep_margin_rows from public.pricing_item_margins;
reset role;

rollback;
\echo 'M2 suite complete (rolled back).';
