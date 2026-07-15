-- ============================================================================
-- Aurum Supply House — M4 orders/invoices test suite (non-destructive; ROLLBACK)
--   psql "$DATABASE_URL" -f supabase/tests/m4_orders.sql
-- Exercises the DB-layer guarantees for M4 through the real public RPCs and the
-- masked views, from each role, using ASSERT so any regression aborts loudly.
-- Covers: client/rep scoping, price-resolution priority, quantity tiers, client
-- overrides, manual override (reason + admin gate), cost/price snapshotting,
-- draft editing, issued-invoice immutability, AUR numbering, money math, customer
-- shipping vs internal freight, partial/full/invalid/over payments, voiding,
-- owner/admin vs rep permissions, rep isolation, cost/profit masking, and atomic
-- rollback on a failed create.
-- ============================================================================
begin;

-- ---- Fixtures (superuser; RLS bypassed) ------------------------------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','owner@a.test','{"full_name":"Olivia Owner"}'),
 ('10000000-0000-0000-0000-000000000002','admin@a.test','{"full_name":"Adam Admin"}'),
 ('10000000-0000-0000-0000-000000000003','rep1@a.test','{"full_name":"Rita Rep"}'),
 ('10000000-0000-0000-0000-000000000004','rep2@a.test','{"full_name":"Raj Rep"}');
update public.profiles set role='owner'     where email='owner@a.test';
update public.profiles set role='admin'     where email='admin@a.test';
update public.profiles set role='sales_rep' where email in ('rep1@a.test','rep2@a.test');

insert into public.manufacturers(id,name) values ('aa000000-0000-0000-0000-000000000001','Acme Labs');
insert into public.products(id,sku,name,strength,pack_size,manufacturer_id,status) values
 ('bb000000-0000-0000-0000-000000000001','AUR-P1','Aurum P1','500mg','30ct','aa000000-0000-0000-0000-000000000001','active'),
 ('bb000000-0000-0000-0000-000000000002','AUR-P2','Aurum P2','10mg','10ct','aa000000-0000-0000-0000-000000000001','active');
-- Cost history drives products.current_true_cost via the 0030 trigger.
insert into public.product_cost_history(product_id,true_cost,effective_date,source) values
 ('bb000000-0000-0000-0000-000000000001',10.00,'2026-01-01','manual'),
 ('bb000000-0000-0000-0000-000000000002', 7.00,'2026-01-01','manual');

insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('20000000-0000-0000-0000-000000000001','Standard','STD','USD',true ,'active'),
 ('20000000-0000-0000-0000-000000000002','Premium' ,'PRM','USD',false,'active');
-- STD: 25 @ qty>=1, 22 @ qty>=100 (tier).  PRM: 30 @ qty>=1.
insert into public.pricing_sheet_items(pricing_sheet_id,product_id,selling_price,min_quantity) values
 ('20000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',25.00,1),
 ('20000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',22.00,100),
 ('20000000-0000-0000-0000-000000000002','bb000000-0000-0000-0000-000000000001',30.00,1);

insert into public.clients(id,company_name,status,assigned_rep_id,default_pricing_sheet_id,payment_terms,billing_address) values
 ('30000000-0000-0000-0000-000000000001','Acme Corp','active','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','net_30','{"line1":"1 Market","city":"Denver","region":"CO","postal_code":"80202","country":"USA"}'),
 ('30000000-0000-0000-0000-000000000002','Beta Inc' ,'active','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','net_30','{}'),
 ('30000000-0000-0000-0000-000000000003','Gamma LLC','active','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','net_15','{"line1":"9 Elm","city":"Boulder","region":"CO","postal_code":"80301","country":"USA"}');
-- Client-specific override for Acme on P1 (19.50).
insert into public.client_price_overrides(client_id,product_id,selling_price,min_quantity) values
 ('30000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',19.50,1);

------------------------------------------------------------------------------
\echo '== Section 1: price-resolution priority + tiers + client override =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
do $$
declare v jsonb;
begin
  -- Acme has an override → wins for any model/qty.
  v := public.resolve_price('30000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',1);
  assert (v->>'source')='client_override' and (v->>'price')::numeric=19.50, format('override should win, got %s', v);

  -- Gamma (no override): assigned STD → 25 @ qty 1, tier 22 @ qty 150.
  v := public.resolve_price('30000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000001',1);
  assert (v->>'source')='assigned_model' and (v->>'price')::numeric=25.00, format('assigned base expected 25, got %s', v);
  v := public.resolve_price('30000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000001',150);
  assert (v->>'price')::numeric=22.00, format('tier expected 22 at qty 150, got %s', v);

  -- Explicitly selected Premium model → 30.
  v := public.resolve_price('30000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000001',1,'USD','20000000-0000-0000-0000-000000000002');
  assert (v->>'source')='selected_model' and (v->>'price')::numeric=30.00, format('selected model expected 30, got %s', v);

  -- No price anywhere → unresolved (never 0, never cost).
  v := public.resolve_price('30000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000002',1);
  assert (v->>'resolved')='false' and (v->>'price') is null, format('P2 should be unresolved, got %s', v);
  raise notice 'PASS: resolution priority (override→selected→assigned→tier) and unresolved';
end $$;

------------------------------------------------------------------------------
\echo '== Section 2: rep scoping — rep builds only for own book =='
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1 (owns Gamma & Acme)
select public.save_order_draft(
  null, '30000000-0000-0000-0000-000000000003', null, 'USD', 0,0,0,0,'rep draft',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":5}]'::jsonb) as gamma_draft \gset
reset role;  -- base invoices/invoice_items are admin-only; read them as superuser
do $$ begin
  assert (select sales_rep_id from public.invoices where id=:'gamma_draft'::uuid)
         ='10000000-0000-0000-0000-000000000003', 'draft sales_rep must be the client''s assigned rep';
  assert (select count(*) from public.invoice_items where invoice_id=:'gamma_draft'::uuid)=1, 'draft should have one line';
end $$;

\echo '   rep2 CANNOT build for Acme (rep1''s client) — expect rejection'
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004', true);  -- rep2
do $$ begin
  perform public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,null,
    '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  raise exception 'FAIL: rep2 built an order for another rep''s client';
exception when insufficient_privilege then raise notice 'PASS: rep2 blocked from Acme (%).', sqlstate;
end $$;

------------------------------------------------------------------------------
\echo '== Section 3: manual override — admin-only + reason required =='
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1
do $$ begin
  perform public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
    '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1,"manual_price":99,"manual_reason":"x"}]'::jsonb);
  raise exception 'FAIL: rep applied a manual override';
exception when insufficient_privilege then raise notice 'PASS: rep blocked from manual override (%).', sqlstate;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
\echo '   admin override without a reason must fail'
do $$
declare v_raised boolean := false;
begin
  begin
    perform public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
      '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1,"manual_price":99,"manual_reason":""}]'::jsonb);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'manual override without a reason must be rejected';
  raise notice 'PASS: manual override requires a reason';
end $$;

\echo '   admin override WITH reason snapshots manual price + original'
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2,"manual_price":40,"manual_reason":"contract price"}]'::jsonb) as ovr_draft \gset
do $$
declare it record;
begin
  select unit_price, price_overridden, original_unit_price, price_source, manual_reason
    into it from public.invoice_items where invoice_id=:'ovr_draft'::uuid;
  assert it.unit_price=40 and it.price_overridden and it.price_source='manual', 'manual override not snapshotted';
  assert it.original_unit_price=25.00, format('original (resolved) price should be 25, got %s', it.original_unit_price);
  assert it.manual_reason='contract price', 'override reason must persist';
  raise notice 'PASS: manual override (admin + reason) snapshots price 40, original 25';
end $$;

------------------------------------------------------------------------------
\echo '== Section 4: money math + customer shipping vs internal freight =='
-- Gamma order: P1 x10 @25 = 250; discount 20; ship 15 (revenue); fees 5; tax 7%.
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',15,5,0.07,20,'thanks',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as money_order \gset
-- Internal expenses: company freight 12 + processing 3 (never on the invoice).
select public.add_order_expense(:'money_order'::uuid,'outbound_shipping',12,'freight',null);
select public.add_order_expense(:'money_order'::uuid,'payment_processing_fee',3,'stripe',null);
\echo '   discount may not exceed the product subtotal'
do $$
declare v_raised boolean := false;
begin
  begin
    perform public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,9999,null,
      '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'discount over subtotal must be rejected';
  raise notice 'PASS: discount over subtotal rejected';
end $$;
reset role;  -- superuser: read stored economics directly
do $$
declare i record;
begin
  select * into i from public.invoices where id=:'money_order'::uuid;
  assert i.subtotal        = 250.00, format('subtotal 250 expected, got %s', i.subtotal);
  assert i.discount        = 20.00 , format('discount 20 expected, got %s', i.discount);
  assert i.tax_amount      = 16.10 , format('tax 16.10 expected (230*0.07), got %s', i.tax_amount);
  assert i.total           = 266.10, format('total 266.10 expected (230+15+5+16.10), got %s', i.total);
  assert i.shipping        = 15.00 , 'customer-paid shipping is revenue on the invoice';
  assert i.total_true_cost = 100.00, format('true cost 100 expected, got %s', i.total_true_cost);
  assert i.gross_profit    = 130.00, format('GP 130 expected (230-100), got %s', i.gross_profit);
  assert round(i.gross_margin,6) = round(130.0/230.0,6), format('margin mismatch, got %s', i.gross_margin);
  assert i.total_expenses  = 15.00 , format('internal expenses 15 expected (12+3), got %s', i.total_expenses);
  assert i.net_profit      = 115.00, format('net 115 expected (130-0-15), got %s', i.net_profit);
  -- Customer shipping (15) is in total; company freight (12) is only in expenses.
  assert i.total = i.subtotal - i.discount + i.shipping + i.fees + i.tax_amount, 'total composition';
  raise notice 'PASS: money math + shipping(15 revenue) vs freight(12 expense) kept separate';
end $$;

------------------------------------------------------------------------------
\echo '== Section 5: draft editing replaces lines (no append) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1 owns Gamma
select public.save_order_draft(:'gamma_draft'::uuid,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,'edited',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":8}]'::jsonb);
reset role;
do $$ begin
  assert (select count(*) from public.invoice_items where invoice_id=:'gamma_draft'::uuid)=1, 'edit must replace, not append';
  assert (select quantity from public.invoice_items where invoice_id=:'gamma_draft'::uuid)=8, 'qty should be 8 after edit';
  assert (select subtotal from public.invoices where id=:'gamma_draft'::uuid)=200.00, 'subtotal 200 (8*25) after edit';
end $$;

------------------------------------------------------------------------------
\echo '== Section 6: issue → AUR numbering (monotonic, no reuse) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.issue_invoice(:'money_order'::uuid, '2026-07-14', null) as num1 \gset
select public.issue_invoice(:'gamma_draft'::uuid, '2026-07-14', null) as num2 \gset
do $$ begin
  assert :'num1' = 'AUR-1001', format('first issue should be AUR-1001, got %s', :'num1');
  assert :'num2' = 'AUR-1002', format('second issue should be AUR-1002, got %s', :'num2');
  -- due date derived from client terms (Gamma net_15).
  assert (select due_date from public.invoices where id=:'gamma_draft'::uuid) = date '2026-07-29', 'net_15 due date derived';
  assert (select status from public.invoices where id=:'money_order'::uuid) = 'sent', 'issued → sent';
end $$;

------------------------------------------------------------------------------
\echo '== Section 7: issued-invoice immutability + cost/price snapshot =='
reset role;
savepoint sp_lock;
\echo '   (financial edit on an issued invoice is expected to fail)'
do $$
declare v_raised boolean := false;
begin
  begin
    update public.invoices set subtotal = 1 where id=:'money_order'::uuid;
  exception when others then v_raised := true;
  end;
  assert v_raised, 'locked invoice must reject a financial edit';
  raise notice 'PASS: locked invoice rejected financial edit';
end $$;
rollback to sp_lock;
savepoint sp_lock_li;
do $$
declare v_raised boolean := false;
begin
  begin
    update public.invoice_items set unit_price = 1 where invoice_id=:'money_order'::uuid;
  exception when others then v_raised := true;
  end;
  assert v_raised, 'locked line items must reject edits';
  raise notice 'PASS: locked line items rejected edit';
end $$;
rollback to sp_lock_li;

\echo '   changing catalog cost + model price must NOT rewrite the issued invoice'
insert into public.product_cost_history(product_id,true_cost,effective_date,source)
  values ('bb000000-0000-0000-0000-000000000001',99.00,'2026-07-14','manual');
do $$ begin
  assert (select current_true_cost from public.products where id='bb000000-0000-0000-0000-000000000001')=99.00, 'catalog cost updated';
  assert (select total_true_cost from public.invoices where id=:'money_order'::uuid)=100.00, 'issued invoice cost snapshot must not move';
  assert (select gross_profit    from public.invoices where id=:'money_order'::uuid)=130.00, 'issued invoice GP must not move';
  assert (select unit_price from public.invoice_items where invoice_id=:'money_order'::uuid limit 1)=25.00, 'issued line price snapshot must not move';
  raise notice 'PASS: issued invoice immune to later cost/price changes';
end $$;

------------------------------------------------------------------------------
\echo '== Section 8: payments — partial, full, invalid, over =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.record_payment(:'money_order'::uuid,100,'ach','ref1',null,null);
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'money_order'::uuid)='partial', 'partial after 100';
  assert (select balance_due from public.invoices where id=:'money_order'::uuid)=166.10, 'balance 166.10 after 100';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);
\echo '   overpayment (200 on 166.10 balance) must fail'
do $$
declare v_raised boolean := false;
begin
  begin perform public.record_payment(:'money_order'::uuid,200,'wire',null,null,null);
  exception when others then v_raised := true; end;
  assert v_raised, 'overpayment must be rejected';
  raise notice 'PASS: overpayment rejected';
end $$;
\echo '   negative/zero payment must fail'
do $$
declare v_raised boolean := false;
begin
  begin perform public.record_payment(:'money_order'::uuid,-5,'cash',null,null,null);
  exception when others then v_raised := true; end;
  assert v_raised, 'non-positive payment must be rejected';
  raise notice 'PASS: non-positive payment rejected';
end $$;
\echo '   full remaining payment → paid'
select public.record_payment(:'money_order'::uuid,166.10,'wire','final',null,null);
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'money_order'::uuid)='paid', 'paid after full';
  assert (select balance_due from public.invoices where id=:'money_order'::uuid)=0.00, 'zero balance when paid';
  assert (select paid_at from public.invoices where id=:'money_order'::uuid) is not null, 'paid_at stamped';
end $$;

\echo '   payment on a draft must fail (issue first)'
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as draft_pay \gset
do $$
declare v_raised boolean := false;
begin
  begin perform public.record_payment(:'draft_pay'::uuid,10,'cash',null,null,null);
  exception when others then v_raised := true; end;
  assert v_raised, 'payment on a draft must be rejected';
  raise notice 'PASS: payment on draft rejected';
end $$;

------------------------------------------------------------------------------
\echo '== Section 9: void — reason required; number retained; no delete =='
select public.issue_invoice(:'draft_pay'::uuid, '2026-07-14', null) as num3 \gset
do $$ begin assert :'num3'='AUR-1003', format('third issue should be AUR-1003 (no reuse), got %s', :'num3'); end $$;
\echo '   void without a reason must fail'
do $$
declare v_raised boolean := false;
begin
  begin perform public.void_invoice(:'draft_pay'::uuid, '');
  exception when others then v_raised := true; end;
  assert v_raised, 'void without a reason must be rejected';
  raise notice 'PASS: void requires a reason';
end $$;
select public.void_invoice(:'draft_pay'::uuid, 'customer cancelled');
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'draft_pay'::uuid)='void', 'status void';
  assert (select invoice_number from public.invoices where id=:'draft_pay'::uuid)='AUR-1003', 'void keeps its number';
  assert exists(select 1 from public.invoice_status_history where invoice_id=:'draft_pay'::uuid and to_status='void' and note='customer cancelled'), 'void reason logged';
end $$;
savepoint sp_del;
do $$
declare v_raised boolean := false;
begin
  begin delete from public.invoices where id=:'money_order'::uuid;  -- non-draft
  exception when others then v_raised := true; end;
  assert v_raised, 'a non-draft invoice must not be deletable';
  raise notice 'PASS: non-draft delete rejected';
end $$;
rollback to sp_del;

------------------------------------------------------------------------------
\echo '== Section 10: permissions — rep cannot issue / pay / void =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as rep_draft \gset
do $$ begin
  begin perform public.issue_invoice(:'rep_draft'::uuid, current_date, null);
    raise exception 'FAIL: rep issued'; exception when insufficient_privilege then raise notice 'PASS: rep cannot issue (%).', sqlstate; end;
  begin perform public.void_invoice(:'money_order'::uuid, 'x');
    raise exception 'FAIL: rep voided'; exception when insufficient_privilege then raise notice 'PASS: rep cannot void (%).', sqlstate; end;
  begin perform public.record_payment(:'money_order'::uuid, 1, 'cash', null, null, null);
    raise exception 'FAIL: rep recorded payment'; exception when insufficient_privilege then raise notice 'PASS: rep cannot record payment (%).', sqlstate; end;
  begin perform public.add_order_expense(:'money_order'::uuid,'other',1,null,null);
    raise exception 'FAIL: rep added expense'; exception when insufficient_privilege then raise notice 'PASS: rep cannot add expense (%).', sqlstate; end;
end $$;

------------------------------------------------------------------------------
\echo '== Section 11: masking + isolation via v_orders / v_order_items =='
-- rep1 (owns the Gamma money order): sees the row, but internal economics NULL.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1
do $$
declare o record; li record;
begin
  select * into o from public.v_orders where id=:'money_order'::uuid;
  assert o.id is not null, 'rep must see own order in v_orders';
  assert o.total = 266.10, 'rep sees customer total';
  assert o.gross_profit is null and o.net_profit is null and o.total_true_cost is null
         and o.total_commission is null and o.total_expenses is null, 'internal economics masked for rep';
  assert o.can_see_internal = false, 'can_see_internal false for rep';
  select * into li from public.v_order_items where invoice_id=:'money_order'::uuid limit 1;
  assert li.unit_price is not null, 'rep sees unit price';
  assert li.unit_true_cost is null and li.line_true_cost is null and li.line_gross_profit is null, 'line cost/GP masked for rep';
  raise notice 'PASS: reps see totals but never cost/profit (DB-masked)';
end $$;

-- rep2 must NOT see the Gamma order at all (isolation).
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004', true);  -- rep2
do $$ begin
  assert (select count(*) from public.v_orders where id=:'money_order'::uuid)=0, 'rep2 must not see another rep''s order';
  assert (select count(*) from public.v_order_items where invoice_id=:'money_order'::uuid)=0, 'rep2 must not see another rep''s line items';
end $$;

-- admin sees the internal economics.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
do $$
declare o record;
begin
  select * into o from public.v_orders where id=:'money_order'::uuid;
  assert o.gross_profit = 130.00 and o.net_profit = 115.00 and o.can_see_internal, 'admin sees internal economics';
  raise notice 'PASS: admin sees gross/net profit';
end $$;

------------------------------------------------------------------------------
\echo '== Section 12: atomic rollback on a failed create =='
reset role;
select count(*)::text as before_ct from public.invoices \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
\echo '   (second line is unpriceable → the whole create must abort)'
do $$ begin
  perform public.save_order_draft(null,'30000000-0000-0000-0000-000000000003',null,'USD',0,0,0,0,null,
    '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1},
      {"product_id":"bb000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb);
  raise notice 'UNEXPECTED: unpriceable create did not error';
exception when others then raise notice 'expected create failure (%).', sqlstate;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices) = :'before_ct'::int,
    'atomic: no invoice should persist after a failed create';
  raise notice 'PASS: failed order create left no partial invoice';
end $$;

rollback;
\echo 'M4 orders suite complete (rolled back). All ASSERTs passed if no error was raised.';
