-- ============================================================================
-- Aurum Supply House — M1 catalog & import test suite (non-destructive)
-- Runs inside a transaction and ROLLBACKs. Requires migrations applied.
--   psql "$DATABASE_URL" -f supabase/tests/m1_catalog.sql
-- ============================================================================
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','o@a.test','{"full_name":"Owner"}'),
 ('33333333-3333-3333-3333-333333333333','r@a.test','{}');
update public.profiles set role='sales_rep' where email='r@a.test';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into public.manufacturers(id,name) values ('aaaaaaa1-0000-0000-0000-000000000001','Acme Labs');
insert into public.catalog_import_batches(id,filename,storage_path,status,kind) values ('b0000001-0000-0000-0000-000000000001','p.xlsx','imports/p.xlsx','previewed','catalog');

\echo 'T1 new import (expect created 2):'
select (app.commit_catalog_import('b0000001-0000-0000-0000-000000000001',
 '[{"row_number":2,"sku":"AUR-500","name":"Aurum 500","true_cost":"10","valid":true},
   {"row_number":3,"sku":"AUR-750","name":"Aurum 750","true_cost":"14.5","valid":true}]'::jsonb,
 'atomic','11111111-1111-1111-1111-111111111111')->>'created')::int as created;

\echo 'T2 re-import cost+data+new, valid_only (expect updated 2, costs 1, created 1, skipped 1):'
insert into public.catalog_import_batches(id,filename,storage_path,status,kind) values ('b0000002-0000-0000-0000-000000000002','p2.csv','imports/p2.csv','previewed','catalog');
select app.commit_catalog_import('b0000002-0000-0000-0000-000000000002',
 '[{"row_number":2,"sku":"AUR-500","name":"Aurum 500","true_cost":"11.25","valid":true},
   {"row_number":3,"sku":"AUR-750","name":"Aurum 750","description":"coated","true_cost":"14.5","valid":true},
   {"row_number":4,"sku":"AUR-900","name":"Aurum 900","true_cost":"18","valid":true},
   {"row_number":5,"sku":"","name":"X","valid":false,"errors":["Missing SKU"]}]'::jsonb,
 'valid_only','11111111-1111-1111-1111-111111111111');

\echo 'T3 cost history preserved for AUR-500 (expect 2 rows; open row previous_cost=10):'
select true_cost, previous_cost, effective_to is null as open from public.product_cost_history h
 join public.products p on p.id=h.product_id where p.sku='AUR-500' order by h.created_at;

\echo 'T4 atomic rollback on invalid row (expect error, AUR-500 stays 11.25):'
insert into public.catalog_import_batches(id,filename,storage_path,status,kind) values ('b0000003-0000-0000-0000-000000000003','p3','imports/p3','previewed','catalog');
savepoint sp;
-- This call is EXPECTED to error (negative cost) and abort to the savepoint.
select app.commit_catalog_import('b0000003-0000-0000-0000-000000000003',
  '[{"row_number":2,"sku":"AUR-500","name":"x","true_cost":"99","valid":true},
    {"row_number":3,"sku":"BAD","name":"y","true_cost":"-5","valid":true}]'::jsonb,
  'atomic','11111111-1111-1111-1111-111111111111');
rollback to sp;
select current_true_cost as aur500_cost_after_rollback from public.products where sku='AUR-500';
select count(*) as bad_product_count from public.products where sku='BAD';

\echo 'T5 deactivation via import (expect discontinued):'
insert into public.catalog_import_batches(id,filename,storage_path,status,kind) values ('b0000004-0000-0000-0000-000000000004','p4','imports/p4','previewed','catalog');
select app.commit_catalog_import('b0000004-0000-0000-0000-000000000004',
 '[{"row_number":2,"sku":"AUR-900","name":"Aurum 900","active":"false","valid":true}]'::jsonb,
 'valid_only','11111111-1111-1111-1111-111111111111');
select status from public.products where sku='AUR-900';

\echo 'T6 manual cost requires reason (expect error then success):'
savepoint sp2;
do $$ declare pid uuid; begin
  select id into pid from public.products where sku='AUR-500';
  perform app.record_cost_change(pid, 12, 'USD', 'manual', null, null, '11111111-1111-1111-1111-111111111111');
  raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'manual-without-reason blocked: %', sqlerrm; end $$;
rollback to sp2;

\echo 'T7 append-only guard (expect error):'
savepoint sp3;
do $$ begin update public.product_cost_history set true_cost=1; raise exception 'SHOULD_NOT_REACH';
exception when others then raise notice 'cost tamper blocked: %', sqlerrm; end $$;
rollback to sp3;

\echo 'T8 RLS: rep sees no cost + only active products'
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
select sku, true_cost, can_see_cost from public.catalog_products order by sku;
select count(*) as rep_base_products from public.products;
reset role;

rollback;
\echo 'M1 suite complete (rolled back).'
