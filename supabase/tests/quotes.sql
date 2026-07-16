-- ============================================================================
-- Aurum Supply House — Quotes module test suite (non-destructive; ROLLBACK)
--   psql "$DATABASE_URL" -f supabase/tests/quotes.sql
-- Exercises the DB-layer guarantees for the Quotes module through the real public
-- RPCs and the masked views, from each role, using ASSERT so any regression aborts
-- loudly. Covers: draft creation, assigned/explicit-model pricing, quantity tiers,
-- client overrides, authorized manual pricing (+ required reason), unresolved-price
-- rejection, snapshot preservation, quote numbering (monotonic, drafts don't
-- consume, no reuse), valid/invalid lifecycle transitions, expiration, draft
-- editing, sent financial immutability, owner/admin vs rep permissions, rep
-- isolation, cost/profit NON-exposure, duplication (re-resolve + retain), atomic
-- quote→order conversion, double-conversion prevention, quote-derived price
-- preservation, current-cost snapshot at conversion, conversion abort/rollback,
-- and client-timeline events.
-- ============================================================================
begin;

-- ---- Fixtures (superuser; RLS bypassed) ------------------------------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('40000000-0000-0000-0000-000000000001','owner@q.test','{"full_name":"Olivia Owner"}'),
 ('40000000-0000-0000-0000-000000000002','admin@q.test','{"full_name":"Adam Admin"}'),
 ('40000000-0000-0000-0000-000000000003','rep1@q.test','{"full_name":"Rita Rep"}'),
 ('40000000-0000-0000-0000-000000000004','rep2@q.test','{"full_name":"Raj Rep"}');
update public.profiles set role='owner'     where email='owner@q.test';
update public.profiles set role='admin'     where email='admin@q.test';
update public.profiles set role='sales_rep' where email in ('rep1@q.test','rep2@q.test');

insert into public.manufacturers(id,name) values ('a1000000-0000-0000-0000-000000000001','Quote Labs');
insert into public.products(id,sku,name,strength,pack_size,manufacturer_id,status) values
 ('b1000000-0000-0000-0000-000000000001','QT-P1','Quote P1','500mg','30ct','a1000000-0000-0000-0000-000000000001','active'),
 ('b1000000-0000-0000-0000-000000000002','QT-P2','Quote P2','10mg','10ct','a1000000-0000-0000-0000-000000000001','active');
insert into public.product_cost_history(product_id,true_cost,effective_date,source) values
 ('b1000000-0000-0000-0000-000000000001',10.00,'2026-01-01','manual'),
 ('b1000000-0000-0000-0000-000000000002', 7.00,'2026-01-01','manual');

insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('c1000000-0000-0000-0000-000000000001','Standard','QSTD','USD',true ,'active'),
 ('c1000000-0000-0000-0000-000000000002','Premium' ,'QPRM','USD',false,'active');
-- STD: 25 @ qty>=1, 22 @ qty>=100 (tier).  PRM: 30 @ qty>=1.
insert into public.pricing_sheet_items(pricing_sheet_id,product_id,selling_price,min_quantity) values
 ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',25.00,1),
 ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',22.00,100),
 ('c1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001',30.00,1);

insert into public.clients(id,company_name,status,assigned_rep_id,default_pricing_sheet_id,payment_terms,billing_address) values
 ('d1000000-0000-0000-0000-000000000001','Acme Corp','active','40000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','net_30','{"line1":"1 Market","city":"Denver","region":"CO","postal_code":"80202","country":"USA"}'),
 ('d1000000-0000-0000-0000-000000000002','Beta Inc' ,'active','40000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001','net_30','{}'),
 ('d1000000-0000-0000-0000-000000000003','Gamma LLC','active','40000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','net_15','{"line1":"9 Elm","city":"Boulder","region":"CO","postal_code":"80301","country":"USA"}');
-- Client-specific override for Acme on P1 (19.50).
insert into public.client_price_overrides(client_id,product_id,selling_price,min_quantity) values
 ('d1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',19.50,1);

------------------------------------------------------------------------------
\echo '== Section 1: draft creation + resolution priority + tiers + override + unresolved =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
-- Gamma (assigned STD, no override): base 25 @ qty 1.
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,'net_15',null,null,null,'assigned',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as q_assigned \gset
-- Explicit Premium model → 30.
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002','USD',0,0,0,0,null,null,null,null,'explicit',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as q_explicit \gset
-- Tier: qty 150 on STD → 22.
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,'tier',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":150}]'::jsonb) as q_tier \gset
-- Override: Acme has a client override → 19.50 regardless of model.
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,null,null,null,null,'override',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as q_override \gset
reset role;
do $$ begin
  assert (select unit_price from public.quote_items where quote_id=:'q_assigned'::uuid)=25.00, 'assigned base 25';
  assert (select price_source from public.quote_items where quote_id=:'q_assigned'::uuid)='assigned_model', 'source assigned_model';
  assert (select unit_price from public.quote_items where quote_id=:'q_explicit'::uuid)=30.00, 'explicit Premium 30';
  assert (select price_source from public.quote_items where quote_id=:'q_explicit'::uuid)='selected_model', 'source selected_model';
  assert (select unit_price from public.quote_items where quote_id=:'q_tier'::uuid)=22.00, 'tier 22 @ qty 150';
  assert (select unit_price from public.quote_items where quote_id=:'q_override'::uuid)=19.50, 'client override 19.50';
  assert (select price_source from public.quote_items where quote_id=:'q_override'::uuid)='client_override', 'source client_override';
  -- Drafts do NOT consume a number.
  assert (select quote_number from public.quotes where id=:'q_assigned'::uuid) like 'QDRAFT-%', 'draft carries QDRAFT number';
  raise notice 'PASS: draft creation + resolution priority (override→selected→assigned→tier)';
end $$;

\echo '   unresolved price is rejected (never zero, never cost)'
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);
do $$
declare v_raised boolean := false;
begin
  begin perform public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,null,
    '[{"product_id":"b1000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb);
  exception when others then v_raised := true; end;
  assert v_raised, 'a line with no resolvable price must be rejected';
  raise notice 'PASS: unresolved-price line rejected';
end $$;

------------------------------------------------------------------------------
\echo '== Section 2: rep scoping — rep quotes only for own book =='
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003', true);  -- rep1 (owns Gamma & Acme)
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,'rep draft',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":5}]'::jsonb) as q_repdraft \gset
reset role;
do $$ begin
  assert (select sales_rep_id from public.quotes where id=:'q_repdraft'::uuid)='40000000-0000-0000-0000-000000000003',
    'draft rep must be the client''s assigned rep';
end $$;

\echo '   rep2 CANNOT quote for Acme (rep1''s client) — expect rejection'
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000004', true);  -- rep2
do $$ begin
  perform public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,null,null,null,null,null,
    '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  raise exception 'FAIL: rep2 quoted for another rep''s client';
exception when insufficient_privilege then raise notice 'PASS: rep2 blocked from Acme (%).', sqlstate;
end $$;

------------------------------------------------------------------------------
\echo '== Section 3: manual override — admin-only + reason required + snapshot =='
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003', true);  -- rep1
do $$ begin
  perform public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,null,
    '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1,"manual_price":99,"manual_reason":"x"}]'::jsonb);
  raise exception 'FAIL: rep applied a manual override';
exception when insufficient_privilege then raise notice 'PASS: rep blocked from manual override (%).', sqlstate;
end $$;

select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
do $$
declare v_raised boolean := false;
begin
  begin perform public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,null,
    '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1,"manual_price":99,"manual_reason":""}]'::jsonb);
  exception when others then v_raised := true; end;
  assert v_raised, 'manual override without a reason must be rejected';
  raise notice 'PASS: manual override requires a reason';
end $$;

select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,null,
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":2,"manual_price":40,"manual_reason":"contract price"}]'::jsonb) as q_ovr \gset
reset role;
do $$
declare it record;
begin
  select unit_price, price_overridden, original_unit_price, price_source, manual_reason
    into it from public.quote_items where quote_id=:'q_ovr'::uuid;
  assert it.unit_price=40 and it.price_overridden and it.price_source='manual', 'manual override not snapshotted';
  assert it.original_unit_price=25.00, format('original (resolved) price should be 25, got %s', it.original_unit_price);
  assert it.manual_reason='contract price', 'override reason must persist';
  raise notice 'PASS: manual override (admin + reason) snapshots price 40, original 25';
end $$;

------------------------------------------------------------------------------
\echo '== Section 4: money math (subtotal → discount → net_sales → tax → total) =='
-- Gamma quote: P1 x10 @25 = 250; discount 20; ship 15; fees 5; tax 7%.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',15,5,0.07,20,'net_30',null,null,null,'thanks',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as q_money \gset
reset role;
do $$
declare q record;
begin
  select * into q from public.quotes where id=:'q_money'::uuid;
  assert q.subtotal   = 250.00, format('subtotal 250 expected, got %s', q.subtotal);
  assert q.discount   = 20.00 , format('discount 20 expected, got %s', q.discount);
  assert q.tax_amount = 16.10 , format('tax 16.10 expected (230*0.07), got %s', q.tax_amount);
  assert q.total      = 266.10, format('total 266.10 expected (230+15+5+16.10), got %s', q.total);
  assert q.total = q.subtotal - q.discount + q.shipping + q.fees + q.tax_amount, 'total composition';
  raise notice 'PASS: customer money math (net_sales tax base, discount before tax)';
end $$;

\echo '   discount may not exceed the product subtotal'
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);
do $$
declare v_raised boolean := false;
begin
  begin perform public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,9999,null,null,null,null,null,
    '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  exception when others then v_raised := true; end;
  assert v_raised, 'discount over subtotal must be rejected';
  raise notice 'PASS: discount over subtotal rejected';
end $$;

------------------------------------------------------------------------------
\echo '== Section 5: snapshot preservation — later pricing changes never move a saved quote =='
-- Bump the STD base price to 99 through the sanctioned effective-dated RPC (closes
-- the old band), prove the saved quote holds, then restore 25 for later sections.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.set_product_price('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1,null,99.00,'USD',current_date,null,true,null,'test bump');
reset role;
do $$ begin
  assert (select subtotal from public.quotes where id=:'q_money'::uuid)=250.00, 'saved quote subtotal must not move';
  assert (select unit_price from public.quote_items where quote_id=:'q_money'::uuid)=25.00, 'saved quote line price must not move';
  raise notice 'PASS: saved quote immune to later pricing changes';
end $$;
-- Restore the base price so later resolutions see 25 again.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.set_product_price('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',1,null,25.00,'USD',current_date,null,true,null,'test restore');
reset role;

------------------------------------------------------------------------------
\echo '== Section 6: draft editing replaces lines (no append) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003', true);  -- rep1 owns Gamma
select public.save_quote_draft(:'q_repdraft'::uuid,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,'edited',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":8}]'::jsonb);
reset role;
do $$ begin
  assert (select count(*) from public.quote_items where quote_id=:'q_repdraft'::uuid)=1, 'edit must replace, not append';
  assert (select quantity from public.quote_items where quote_id=:'q_repdraft'::uuid)=8, 'qty should be 8 after edit';
  raise notice 'PASS: draft editing replaces lines';
end $$;

------------------------------------------------------------------------------
\echo '== Section 7: send → QTE numbering (monotonic, drafts do not consume, no reuse) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.send_quote(:'q_money'::uuid) as num1 \gset
select public.send_quote(:'q_repdraft'::uuid) as num2 \gset
do $$ begin
  assert :'num1' = 'QTE-1001', format('first send should be QTE-1001, got %s', :'num1');
  assert :'num2' = 'QTE-1002', format('second send should be QTE-1002, got %s', :'num2');
  assert (select status from public.quotes where id=:'q_money'::uuid)='sent', 'sent after send';
end $$;

------------------------------------------------------------------------------
\echo '== Section 8: sent-quote financial immutability =='
reset role;
savepoint sp_lock;
do $$
declare v_raised boolean := false;
begin
  begin update public.quotes set subtotal = 1 where id=:'q_money'::uuid;
  exception when others then v_raised := true; end;
  assert v_raised, 'sent quote must reject a financial edit';
  raise notice 'PASS: sent quote financial fields frozen';
end $$;
rollback to sp_lock;
savepoint sp_lock_li;
do $$
declare v_raised boolean := false;
begin
  begin update public.quote_items set unit_price = 1 where quote_id=:'q_money'::uuid;
  exception when others then v_raised := true; end;
  assert v_raised, 'sent quote line items must reject edits';
  raise notice 'PASS: sent quote line items frozen';
end $$;
rollback to sp_lock_li;

------------------------------------------------------------------------------
\echo '== Section 9: lifecycle — valid + invalid transitions =='
-- q_repdraft is sent → accept it. q_money is sent → decline it.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.transition_quote_status(:'q_repdraft'::uuid,'accepted','looks good');
select public.transition_quote_status(:'q_money'::uuid,'declined','went another way');
reset role;
do $$ begin
  assert (select status from public.quotes where id=:'q_repdraft'::uuid)='accepted', 'accepted transition';
  assert (select status from public.quotes where id=:'q_money'::uuid)='declined', 'declined transition';
  assert (select accepted_at from public.quotes where id=:'q_repdraft'::uuid) is not null, 'accepted_at stamped';
  assert exists(select 1 from public.quote_status_history where quote_id=:'q_repdraft'::uuid and to_status='accepted' and note='looks good'), 'transition note logged';
end $$;

\echo '   invalid transitions must fail at the DB layer'
savepoint sp_bad;
do $$
declare v_raised boolean;
begin
  -- declined is terminal.
  v_raised := false;
  begin update public.quotes set status='accepted' where id=:'q_money'::uuid;
  exception when others then v_raised := true; end;
  assert v_raised, 'declined → accepted must be rejected';

  -- accepted → declined is not allowed (only → converted).
  v_raised := false;
  begin update public.quotes set status='declined' where id=:'q_repdraft'::uuid;
  exception when others then v_raised := true; end;
  assert v_raised, 'accepted → declined must be rejected';

  raise notice 'PASS: invalid lifecycle transitions rejected at DB layer';
end $$;
rollback to sp_bad;

------------------------------------------------------------------------------
\echo '== Section 10: expiration — deterministic sweep =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
-- Draft with a past expiration date (the lock freezes expiration once sent, so it
-- is set at draft time), send it, then run the deterministic sweep.
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,(current_date - 1),'expiring',
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as q_exp \gset
select public.send_quote(:'q_exp'::uuid);
select public.expire_quotes() as expired_ct \gset
reset role;
do $$ begin
  assert :'expired_ct'::int >= 1, 'sweep should expire at least the back-dated quote';
  assert (select status from public.quotes where id=:'q_exp'::uuid)='expired', 'past-expiry sent quote → expired';
  raise notice 'PASS: deterministic expiration sweep';
end $$;

------------------------------------------------------------------------------
\echo '== Section 11: permissions — rep cannot send / accept / decline / void / expire =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003', true);  -- rep1
select public.save_quote_draft(null,'d1000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,null,null,null,null,
  '[{"product_id":"b1000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as q_repperm \gset
do $$ begin
  begin perform public.send_quote(:'q_repperm'::uuid);
    raise exception 'FAIL: rep sent'; exception when insufficient_privilege then raise notice 'PASS: rep cannot send (%).', sqlstate; end;
  begin perform public.transition_quote_status(:'q_repdraft'::uuid,'converted',null);
    raise exception 'FAIL: rep transitioned'; exception when insufficient_privilege then raise notice 'PASS: rep cannot transition (%).', sqlstate; end;
  begin perform public.void_quote(:'q_repdraft'::uuid,'x');
    raise exception 'FAIL: rep voided'; exception when insufficient_privilege then raise notice 'PASS: rep cannot void (%).', sqlstate; end;
  begin perform public.expire_quotes();
    raise exception 'FAIL: rep swept'; exception when insufficient_privilege then raise notice 'PASS: rep cannot expire (%).', sqlstate; end;
end $$;

------------------------------------------------------------------------------
\echo '== Section 12: masking + isolation via v_quotes / v_quote_items =='
-- rep1 owns Gamma quotes; sees them. rep2 does not.
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003', true);  -- rep1
do $$
declare q record;
begin
  select * into q from public.v_quotes where id=:'q_repdraft'::uuid;
  assert q.id is not null, 'rep must see own quote in v_quotes';
  assert (select count(*) from public.v_quote_items where quote_id=:'q_repdraft'::uuid) >= 1, 'rep sees own quote lines';
  raise notice 'PASS: rep sees own quotes via masked views';
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000004', true);  -- rep2
do $$ begin
  assert (select count(*) from public.v_quotes where id=:'q_repdraft'::uuid)=0, 'rep2 must not see another rep''s quote';
  assert (select count(*) from public.v_quote_items where quote_id=:'q_repdraft'::uuid)=0, 'rep2 must not see another rep''s lines';
  raise notice 'PASS: rep isolation on quotes';
end $$;

\echo '   cost/profit NON-exposure — no such columns exist on quote tables or views'
reset role;
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from information_schema.columns
   where table_schema='public'
     and table_name in ('quotes','quote_items','v_quotes','v_quote_items')
     and (column_name ilike '%cost%' or column_name ilike '%gross_profit%' or column_name ilike '%margin%'
          or column_name ilike '%net_profit%' or column_name ilike '%commission%' or column_name ilike '%expense%');
  assert v_cnt = 0, format('quotes must expose NO cost/profit columns; found %s', v_cnt);
  raise notice 'PASS: quotes expose no cost/profit/margin/commission/expense columns';
end $$;

------------------------------------------------------------------------------
\echo '== Section 13: duplication — re-resolve default + retain option; original unchanged =='
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
-- q_ovr has a manual line @ 40 (original resolved 25). Re-resolve default → 25.
select public.duplicate_quote(:'q_ovr'::uuid, false) as q_dup_reresolve \gset
-- Retain → keep the quoted 40.
select public.duplicate_quote(:'q_ovr'::uuid, true) as q_dup_retain \gset
reset role;
do $$ begin
  -- Original is untouched.
  assert (select unit_price from public.quote_items where quote_id=:'q_ovr'::uuid)=40.00, 'original quote must not mutate';
  assert (select quote_number from public.quotes where id=:'q_ovr'::uuid) <> (select quote_number from public.quotes where id=:'q_dup_reresolve'::uuid),
    'duplicate must not reuse the number';
  assert (select status from public.quotes where id=:'q_dup_reresolve'::uuid)='draft', 'duplicate is a new draft';
  -- Re-resolve picked up the current resolved price (25 base still applies at qty 2).
  assert (select unit_price from public.quote_items where quote_id=:'q_dup_reresolve'::uuid)=25.00,
    format('re-resolved duplicate should be 25, got %s', (select unit_price from public.quote_items where quote_id=:'q_dup_reresolve'::uuid));
  -- Retain kept the quoted 40.
  assert (select unit_price from public.quote_items where quote_id=:'q_dup_retain'::uuid)=40.00, 'retained duplicate keeps 40';
  assert (select price_source from public.quote_items where quote_id=:'q_dup_retain'::uuid)='quote_retained', 'retained line marked quote_retained';
  raise notice 'PASS: duplication (re-resolve default, retain option, original immutable, new number)';
end $$;

------------------------------------------------------------------------------
\echo '== Section 14: conversion — atomic, idempotent, quote-derived price + current cost snapshot =='
-- Bump P1 current cost to 12 so we can prove the ORDER snapshots the cost at
-- conversion time (not any quote figure — a quote has none).
insert into public.product_cost_history(product_id,true_cost,effective_date,source)
  values ('b1000000-0000-0000-0000-000000000001',12.00,current_date,'manual');
do $$ begin
  assert (select current_true_cost from public.products where id='b1000000-0000-0000-0000-000000000001')=12.00, 'current cost is 12';
end $$;

\echo '   converting a non-accepted quote must fail atomically (no order persists)'
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
do $$
declare v_raised boolean := false;
begin
  begin perform public.convert_quote_to_order(:'q_dup_retain'::uuid);  -- still a draft
  exception when others then v_raised := true; end;
  assert v_raised, 'converting a non-accepted quote must be rejected';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where source_quote_id=:'q_dup_retain'::uuid)=0, 'atomic: no order after a failed conversion';
  raise notice 'PASS: conversion aborts atomically on a non-accepted quote';
end $$;

-- Happy path: q_repdraft is accepted (qty 8 @ 25 = 200). Convert it.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002', true);  -- admin
select public.convert_quote_to_order(:'q_repdraft'::uuid) as order_id \gset
-- Idempotent: a second convert returns the SAME order.
select public.convert_quote_to_order(:'q_repdraft'::uuid) as order_id2 \gset
reset role;
do $$
declare inv record; li record;
begin
  assert :'order_id' = :'order_id2', 'double conversion must return the same order';
  assert (select count(*) from public.invoices where source_quote_id=:'q_repdraft'::uuid)=1, 'exactly one order per quote';

  select * into inv from public.invoices where id=:'order_id'::uuid;
  assert inv.status='draft', 'conversion produces a DRAFT order (not issued)';
  assert inv.source_quote_id=:'q_repdraft'::uuid, 'order → quote link stored';
  assert inv.source_quote_number = (select quote_number from public.quotes where id=:'q_repdraft'::uuid), 'quote number preserved on order';
  assert inv.invoice_number like 'DRAFT-%', 'draft order does not consume an AUR invoice number';

  -- Quote → order link + status.
  assert (select converted_order_id from public.quotes where id=:'q_repdraft'::uuid)=:'order_id'::uuid, 'quote → order link stored';
  assert (select status from public.quotes where id=:'q_repdraft'::uuid)='converted', 'quote marked converted';

  select * into li from public.invoice_items where invoice_id=:'order_id'::uuid limit 1;
  assert li.unit_price=25.00, format('quoted selling price preserved (25), got %s', li.unit_price);
  assert li.price_source='quote', 'order line marked quote-derived';
  assert li.unit_true_cost=12.00, format('order snapshots CURRENT cost (12) at conversion, got %s', li.unit_true_cost);

  -- Internal profitability recomputed on the order from the cost snapshot.
  assert inv.subtotal=200.00, format('order subtotal 200, got %s', inv.subtotal);
  assert inv.total_true_cost=96.00, format('order cost 96 (8*12), got %s', inv.total_true_cost);
  assert inv.gross_profit=104.00, format('order GP 104 (200-96), got %s', inv.gross_profit);
  raise notice 'PASS: conversion — atomic, idempotent, quote price preserved, current cost snapshot, profitability recomputed';
end $$;

------------------------------------------------------------------------------
\echo '== Section 15: client timeline mirrors quote lifecycle (non-sensitive, no money) =='
do $$
declare v_created int; v_converted int; v_money int;
begin
  select count(*) into v_created from public.activity_log
    where entity_type='client' and entity_id='d1000000-0000-0000-0000-000000000003' and action='quote_created';
  select count(*) into v_converted from public.activity_log
    where entity_type='client' and entity_id='d1000000-0000-0000-0000-000000000003' and action='quote_converted';
  assert v_created >= 1, 'client timeline records quote_created';
  assert v_converted >= 1, 'client timeline records quote_converted';
  -- Non-sensitive: quote client-timeline metadata never carries a money amount.
  select count(*) into v_money from public.activity_log
    where entity_type='client' and action like 'quote_%' and (metadata ? 'amount' or metadata ? 'total');
  assert v_money = 0, 'quote client-timeline metadata must not include money';
  raise notice 'PASS: client timeline quote events (non-sensitive)';
end $$;

rollback;
\echo 'Quotes suite complete (rolled back). All ASSERTs passed if no error was raised.';
