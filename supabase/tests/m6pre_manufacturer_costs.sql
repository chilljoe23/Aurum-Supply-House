-- ============================================================================
-- Aurum Supply House — M6-prerequisite: Manufacturer cost files test suite
--   psql "$DATABASE_URL" -f supabase/tests/m6pre_manufacturer_costs.sql
-- Non-destructive: everything runs inside a single transaction and ROLLBACKs.
-- Covers: multi-manufacturer supply, imports (new/update/atomic/valid-only),
-- tier resolution, overlap rejection, unknown-SKU, future/expired, inactive,
-- MOQ/order-multiple, unresolved behaviour, true-cost promotion + protection,
-- Owner/Admin permissions, and Sales-rep cost masking + RPC denial.
-- ============================================================================
begin;

-- ---- identities (profiles auto-created by the identity trigger) -------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','owner@a.test','{"full_name":"Owner"}'),
 ('33333333-3333-3333-3333-333333333333','rep@a.test','{}');
update public.profiles set role='owner'     where email='owner@a.test';
update public.profiles set role='sales_rep' where email='rep@a.test';
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

-- ---- fixtures ---------------------------------------------------------------
insert into public.manufacturers(id,name,status,default_currency) values
 ('f1000000-0000-0000-0000-0000000000a1','Mfr A','active','USD'),
 ('f1000000-0000-0000-0000-0000000000b1','Mfr B','active','USD');
insert into public.products(id,sku,name,status) values
 ('a1000000-0000-0000-0000-000000000001','MC-1','Product 1','active'),
 ('a1000000-0000-0000-0000-000000000002','MC-2','Product 2','active'),
 ('a1000000-0000-0000-0000-000000000003','MC-3','Product 3 (unsupplied)','active');
-- A pre-existing catalog true cost of 20 for MC-1 (as an invoice would have snapshotted).
insert into public.product_cost_history(product_id,true_cost,source) values
 ('a1000000-0000-0000-0000-000000000001',20,'manual');

-- import batches
insert into public.manufacturer_cost_import_batches(id,manufacturer_id,filename,storage_path,status) values
 ('b1000000-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000a1','a.xlsx','mfr-costs/a.xlsx','previewed'),
 ('b1000000-0000-0000-0000-0000000000a2','f1000000-0000-0000-0000-0000000000a1','a2.xlsx','mfr-costs/a2.xlsx','previewed'),
 ('b1000000-0000-0000-0000-0000000000b1','f1000000-0000-0000-0000-0000000000b1','b.xlsx','mfr-costs/b.xlsx','previewed');

\echo '=== 1. NEW cost-file import (Mfr A): base + 2 tiers for MC-1, base for MC-2 ==='
select app.commit_manufacturer_cost_import(
  'b1000000-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(
    jsonb_build_object('row_number',2,'sku','MC-1','unit_cost','12.00','min_quantity','1','max_quantity','99','moq','50','order_multiple','25','manufacturer_sku','A-1','valid',true,'classification','new_manufacturer_product'),
    jsonb_build_object('row_number',3,'sku','MC-1','unit_cost','10.50','min_quantity','100','max_quantity','499','valid',true,'classification','tier_added'),
    jsonb_build_object('row_number',4,'sku','MC-1','unit_cost','9.25','min_quantity','500','valid',true,'classification','tier_added'),
    jsonb_build_object('row_number',5,'sku','MC-2','unit_cost','5.00','min_quantity','1','valid',true,'classification','new_manufacturer_product')
  ), 'atomic','11111111-1111-1111-1111-111111111111');
\echo ' expect: relationships=2, costs_created=2, tiers=2, skipped=0'

\echo '--- MULTIPLE MANUFACTURERS supply the same SKU at different costs (Mfr B: MC-1 @ 11) ---'
select app.commit_manufacturer_cost_import(
  'b1000000-0000-0000-0000-0000000000b1','f1000000-0000-0000-0000-0000000000b1',
  jsonb_build_array(jsonb_build_object('row_number',2,'sku','MC-1','unit_cost','11.00','min_quantity','1','valid',true,'classification','new_manufacturer_product')
  ), 'atomic','11111111-1111-1111-1111-111111111111');
select count(*) as mc1_supply_relationships from public.manufacturer_products mp
 where mp.product_id='a1000000-0000-0000-0000-000000000001';
\echo ' expect mc1_supply_relationships = 2'

\echo '=== 2. TRUE-COST PROTECTION: import did NOT touch catalog current_true_cost ==='
select current_true_cost as mc1_true_cost_should_be_20 from public.products where sku='MC-1';
select count(*) as mc1_product_cost_history_rows_should_be_1 from public.product_cost_history
 where product_id='a1000000-0000-0000-0000-000000000001';

\echo '=== 3. DETERMINISTIC TIER RESOLUTION (Mfr A) ==='
\echo ' q=1   -> base 12.00 (source base):'
select (r->>'unit_cost') cost,(r->>'source') src from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',1) r) x;
\echo ' q=150 -> tier 10.50 (source tier):'
select (r->>'unit_cost') cost,(r->>'source') src from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',150) r) x;
\echo ' q=600 -> tier 9.25 (source tier):'
select (r->>'unit_cost') cost,(r->>'source') src from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',600) r) x;
\echo ' DIFFERENT manufacturer, same SKU q=1 -> Mfr B 11.00:'
select (r->>'unit_cost') cost from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-000000000001',1) r) x;

\echo '=== 4. MOQ / ORDER-MULTIPLE warnings (moq=50, multiple=25) ==='
\echo ' q=10 -> warnings [below_moq, not_order_multiple]:'
select (r->'warnings') warnings from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',10) r) x;
\echo ' q=100 -> warnings [] (100>=50 and 100%25=0):'
select (r->'warnings') warnings from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',100) r) x;

\echo '=== 5. COST UPDATE preserves history (MC-1 base 12.00 -> 12.75) ==='
select app.commit_manufacturer_cost_import(
  'b1000000-0000-0000-0000-0000000000a2','f1000000-0000-0000-0000-0000000000a1',
  jsonb_build_array(jsonb_build_object('row_number',2,'sku','MC-1','unit_cost','12.75','min_quantity','1','valid',true,'classification','cost_update')
  ), 'atomic','11111111-1111-1111-1111-111111111111');
select unit_cost, previous_cost, (effective_to is null) as open
  from public.manufacturer_cost_history h
  join public.manufacturer_products mp on mp.id=h.manufacturer_product_id
 where mp.manufacturer_id='f1000000-0000-0000-0000-0000000000a1' and mp.product_id='a1000000-0000-0000-0000-000000000001'
   and h.min_quantity=1 order by h.created_at;
\echo ' expect: row1 (12.00, closed) preserved; row2 (12.75, previous_cost 12.00, open)'

\echo '=== 6. OVERLAPPING-TIER rejection (expect error) ==='
savepoint ov; do $$ begin
  perform app.set_manufacturer_cost(
    (select id from public.manufacturer_products where manufacturer_id='f1000000-0000-0000-0000-0000000000a1' and product_id='a1000000-0000-0000-0000-000000000001'),
    50, 150, 8, 'USD', current_date, null, true, 'manual', 'overlap test', null, '11111111-1111-1111-1111-111111111111');
  raise exception 'NO-OVERLAP-GUARD'; exception when others then raise notice 'overlap rejected: %', sqlerrm; end $$;
rollback to ov;

\echo '=== 7. UNKNOWN SKU: atomic aborts (expect error) ==='
savepoint uk; do $$ begin
  perform app.commit_manufacturer_cost_import(
    'b1000000-0000-0000-0000-0000000000a2','f1000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(jsonb_build_object('row_number',2,'sku','NOPE-999','unit_cost','5','min_quantity','1','valid',true,'classification','unknown_sku')),
    'atomic','11111111-1111-1111-1111-111111111111');
  raise exception 'NO-ABORT'; exception when others then raise notice 'atomic aborted on unknown SKU: %', sqlerrm; end $$;
rollback to uk;

\echo '=== 8. ATOMIC ROLLBACK: a bad row rolls back the whole import ==='
savepoint at;
select count(*) as bands_before from public.manufacturer_cost_history;
do $$ begin
  perform app.commit_manufacturer_cost_import(
    'b1000000-0000-0000-0000-0000000000a2','f1000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(
      jsonb_build_object('row_number',2,'sku','MC-2','unit_cost','4.00','min_quantity','1','valid',true,'classification','cost_update'),
      jsonb_build_object('row_number',3,'sku','MC-2','unit_cost','-1','min_quantity','1','valid',true,'classification','invalid')),
    'atomic','11111111-1111-1111-1111-111111111111');
  raise exception 'NO'; exception when others then raise notice 'atomic rolled back: %', sqlerrm; end $$;
rollback to at;
select unit_cost as mc2_cost_still_5 from public.manufacturer_cost_history h
 join public.manufacturer_products mp on mp.id=h.manufacturer_product_id
 where mp.product_id='a1000000-0000-0000-0000-000000000002' and h.effective_to is null;

\echo '=== 9. VALID-ROWS-ONLY: valid rows apply, invalid skipped ==='
savepoint vo; do $$
declare v jsonb; begin
  v := app.commit_manufacturer_cost_import(
    'b1000000-0000-0000-0000-0000000000a2','f1000000-0000-0000-0000-0000000000a1',
    jsonb_build_array(
      jsonb_build_object('row_number',2,'sku','MC-2','unit_cost','4.50','min_quantity','1','valid',true,'classification','cost_update'),
      jsonb_build_object('row_number',3,'sku','NOPE-1','unit_cost','9','min_quantity','1','valid',true,'classification','unknown_sku')),
    'valid_only','11111111-1111-1111-1111-111111111111');
  raise notice 'valid_only summary: %', v;
end $$;
rollback to vo;

\echo '=== 10a. FUTURE cost is not applied until its effective date (MC-3) ==='
savepoint fu;
select app.upsert_manufacturer_product('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',null,null,'USD',null,null,null,true,null,null,'11111111-1111-1111-1111-111111111111');
select app.set_manufacturer_cost(
  (select id from public.manufacturer_products where manufacturer_id='f1000000-0000-0000-0000-0000000000a1' and product_id='a1000000-0000-0000-0000-000000000003'),
  1, null, 7, 'USD', current_date + 30, null, true, 'manual','future cost', null,'11111111-1111-1111-1111-111111111111');
\echo ' today -> resolved=false (future not yet effective):'
select (r->>'resolved') resolved from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',1) r) x;
\echo ' +60d -> 7.00 (now effective):'
select (r->>'unit_cost') cost from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',1,'USD',current_date+60) r) x;
rollback to fu;

\echo '=== 10b. EXPIRED cost is excluded (MC-3) ==='
savepoint ex;
select app.upsert_manufacturer_product('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',null,null,'USD',null,null,null,true,null,null,'11111111-1111-1111-1111-111111111111');
select app.set_manufacturer_cost(
  (select id from public.manufacturer_products where manufacturer_id='f1000000-0000-0000-0000-0000000000a1' and product_id='a1000000-0000-0000-0000-000000000003'),
  1, null, 7, 'USD', current_date - 60, current_date - 30, true, 'manual','expired cost', null,'11111111-1111-1111-1111-111111111111');
\echo ' today -> resolved=false (expired), warnings [no_cost]:'
select (r->>'resolved') resolved,(r->'warnings') warnings from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',1) r) x;
rollback to ex;

\echo '=== 11. INACTIVE manufacturer / product -> unresolved ==='
savepoint ia;
update public.manufacturers set status='discontinued' where id='f1000000-0000-0000-0000-0000000000a1';
select (r->>'resolved') resolved,(r->'warnings') warnings from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',1) r) x;
\echo ' expect resolved=false, warnings [inactive]'
rollback to ia;

\echo '=== 12. UNRESOLVED never returns zero and never a selling price ==='
\echo ' MC-3 has no relationship -> resolved false, unit_cost null:'
select (r->>'resolved') resolved,(r->>'unit_cost') cost,(r->'warnings') warnings from (select app.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000003',1) r) x;

\echo '=== 13. PROMOTION updates catalog true cost through the sanctioned path ONLY ==='
select app.promote_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','Preferred supplier', current_date, true, '11111111-1111-1111-1111-111111111111');
select current_true_cost as mc1_true_cost_now_12_75 from public.products where sku='MC-1';
select preferred_manufacturer_id = 'f1000000-0000-0000-0000-0000000000a1' as preferred_set from public.products where sku='MC-1';
\echo ' HISTORICAL PRESERVATION: original 20 cost record retained (append-only), plus promoted 12.75:'
select true_cost, previous_cost, (effective_to is null) as open from public.product_cost_history
 where product_id='a1000000-0000-0000-0000-000000000001' order by created_at;
\echo ' expect: (20, closed) preserved; (12.75, previous 20, open)'

\echo '=== 14. OWNER/ADMIN permissions: public resolver works for owner ==='
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
select (public.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',600)->>'unit_cost') as owner_resolve_925;
select count(*) as owner_sees_costs from public.manufacturer_product_costs;
reset role;

\echo '=== 15. SALES-REP cost masking + RPC denial ==='
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
\echo ' rep sees ZERO manufacturer cost rows (base + view + tiers):'
select count(*) as rep_base_rows      from public.manufacturer_products;
select count(*) as rep_view_rows      from public.manufacturer_product_costs;
select count(*) as rep_history_rows   from public.manufacturer_cost_history;
select count(*) as rep_band_rows      from public.manufacturer_cost_bands;
\echo ' rep resolver call -> denied (expect error 42501):'
savepoint rp; do $$ begin
  perform public.resolve_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001',1);
  raise exception 'NO-DENY'; exception when others then raise notice 'rep resolver denied: %', sqlerrm; end $$;
rollback to rp;
\echo ' rep import call -> denied (expect error 42501):'
savepoint ri; do $$ begin
  perform public.import_manufacturer_costs('b1000000-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000a1','[]'::jsonb,'atomic');
  raise exception 'NO-DENY'; exception when others then raise notice 'rep import denied: %', sqlerrm; end $$;
rollback to ri;
\echo ' rep promote call -> denied (expect error 42501):'
savepoint rpr; do $$ begin
  perform public.promote_manufacturer_cost('f1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','x',current_date,true);
  raise exception 'NO-DENY'; exception when others then raise notice 'rep promote denied: %', sqlerrm; end $$;
rollback to rpr;
reset role;

rollback;
\echo 'M6-prerequisite manufacturer-cost suite complete (rolled back).';
