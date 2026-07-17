-- ============================================================================
-- Aurum Supply House — M7 Owner-only permanent order-deletion test suite
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m7_order_delete.sql
-- Non-destructive (BEGIN … ROLLBACK), ASSERT-driven, exercised through the real
-- public RPCs from each role. Requires migrations 0001–0394.
--
-- Covers: Owner deletes an eligible Draft; Owner deletes an eligible Void;
-- deleted invoice number stays retired (never reissued); Admin denied; Sales Rep
-- denied; Sent/Partial/Paid denied; order-with-payment denied; order-with-paid-
-- commission denied; unsafe (approved/earned) commission denied; missing reason
-- denied; fulfilled/complete stage denied; atomic rollback (denied delete leaves
-- every child intact); tombstone written WITHOUT sensitive financial/PII data;
-- deleted order disappears from v_orders/operational reads; idempotent repeat
-- delete is safe; Void workflow unchanged; numbering remains monotonic.
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
 ('bb000000-0000-0000-0000-000000000001','AUR-P1','Aurum P1','500mg','30ct','aa000000-0000-0000-0000-000000000001','active');
insert into public.product_cost_history(product_id,true_cost,effective_date,source) values
 ('bb000000-0000-0000-0000-000000000001',10.00,'2026-01-01','manual');
insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('20000000-0000-0000-0000-000000000001','Standard','STD','USD',true,'active');
insert into public.pricing_sheet_items(pricing_sheet_id,product_id,selling_price,min_quantity) values
 ('20000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',25.00,1);
insert into public.clients(id,company_name,status,assigned_rep_id,default_pricing_sheet_id,payment_terms) values
 ('30000000-0000-0000-0000-000000000001','Gamma LLC','active','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','net_30');

-- Convenience: a line item spec reused across drafts.
-- (product P1 x2 → subtotal 50, cost 20, GP 30)

------------------------------------------------------------------------------
\echo '== Section 1: Owner deletes an eligible DRAFT (with a pending commission) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(
  null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'draft to delete',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as d1 \gset
-- a pending commission is safe scaffolding and must be removed with the order
select public.create_commission(:'d1'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita Rep',null,null,null,'percent_of_sale',0.05,null,null) as d1c \gset
select public.hard_delete_order(:'d1'::uuid, 'entered by mistake');
reset role;
do $$ begin
  assert (select count(*) from public.invoices    where id=:'d1'::uuid)=0, 'draft invoice must be gone';
  assert (select count(*) from public.invoice_items where invoice_id=:'d1'::uuid)=0, 'draft items must be gone';
  assert (select count(*) from public.commissions  where invoice_id=:'d1'::uuid)=0, 'pending commission must be gone';
  assert (select count(*) from public.activity_log
           where entity_id=:'d1'::uuid and action='deleted')=1, 'a deletion tombstone must be written';
  raise notice 'PASS: owner deleted an eligible draft; children removed; tombstone written';
end $$;

------------------------------------------------------------------------------
\echo '== Section 2: Owner deletes an eligible VOID; tombstone is minimal; disappears from reports =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(
  null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'void to delete',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as v1 \gset
select public.issue_invoice(:'v1'::uuid, '2026-07-01', '2026-07-31') as v1_num \gset
select public.void_invoice(:'v1'::uuid, 'issued in error');
-- confirm it is genuinely void and appears in the operational view first
do $$ begin
  assert (select status from public.invoices where id=:'v1'::uuid)='void', 'v1 should be void';
  assert (select count(*) from public.v_orders where id=:'v1'::uuid)=1, 'void order still visible pre-delete';
end $$;
select public.hard_delete_order(:'v1'::uuid, 'void was created by mistake') as v1_result \gset
-- still owner; verify disappearance from the reporting/operational view
do $$ begin
  assert (select count(*) from public.v_orders where id=:'v1'::uuid)=0, 'deleted order must vanish from v_orders/reports';
end $$;
reset role;
do $$
declare m jsonb;
begin
  assert (select count(*) from public.invoices where id=:'v1'::uuid)=0, 'void invoice must be gone';
  assert (select count(*) from public.invoice_status_history where invoice_id=:'v1'::uuid)=0, 'status history gone';
  -- Tombstone content: identity + reason only, and byte-for-byte NO sensitive data.
  select metadata into m from public.activity_log where entity_id=:'v1'::uuid and action='deleted';
  assert m->>'former_order_number' = :'v1_num', 'tombstone keeps former order number';
  assert m->>'former_status' = 'void', 'tombstone keeps former status';
  assert m->>'retired_invoice_number' = :'v1_num', 'tombstone records the permanently retired number';
  assert m->>'client_id' = '30000000-0000-0000-0000-000000000001', 'tombstone keeps client id';
  assert (m->>'reason') = 'void was created by mistake', 'tombstone keeps the reason';
  assert (select actor_id from public.activity_log where entity_id=:'v1'::uuid and action='deleted')
         = '10000000-0000-0000-0000-000000000001', 'tombstone actor is the deleting Owner';
  -- Must NOT leak line pricing, costs, totals, PII, or notes.
  for m in select metadata from public.activity_log where entity_id=:'v1'::uuid and action='deleted' loop
    assert not (m ?| array['total','subtotal','true_cost','gross_profit','net_profit','margin',
                           'unit_price','line_total','notes','company_name','billing_address']),
      format('tombstone must not contain sensitive keys: %s', m);
  end loop;
  raise notice 'PASS: owner deleted an eligible void; minimal tombstone; gone from reports';
end $$;

------------------------------------------------------------------------------
\echo '== Section 3: deleted invoice number stays RETIRED (never reissued) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(
  null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'after-delete issue',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as a1 \gset
select public.issue_invoice(:'a1'::uuid, '2026-07-02', '2026-08-01') as a1_num \gset
reset role;
do $$ begin
  -- The freshly issued number must be strictly greater than the deleted one and
  -- must never equal it — the monotonic counter was never rolled back.
  assert split_part(:'a1_num','-',2)::bigint > split_part(:'v1_num','-',2)::bigint,
    format('new number %s must exceed retired %s', :'a1_num', :'v1_num');
  assert :'a1_num' <> :'v1_num', 'a deleted number is never reissued';
  assert (select count(*) from public.invoices where invoice_number = :'v1_num')=0,
    'the retired number belongs to no live invoice';
  raise notice 'PASS: retired number % never reused (next issued %)', :'v1_num', :'a1_num';
end $$;

------------------------------------------------------------------------------
\echo '== Section 4: ADMIN denied (owner-only gate) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner builds a draft
select public.save_order_draft(
  null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'admin-attempt',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as admd \gset
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- become admin
do $$ declare ok boolean := false; begin
  begin perform public.hard_delete_order(:'admd'::uuid, 'admin tries'); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'Admin must NOT be able to permanently delete an order';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'admd'::uuid)=1, 'order intact after admin attempt';
  raise notice 'PASS: admin denied';
end $$;

------------------------------------------------------------------------------
\echo '== Section 5: SALES REP denied =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1 (owns Gamma)
do $$ declare ok boolean := false; begin
  begin perform public.hard_delete_order(:'admd'::uuid, 'rep tries'); ok := true;
  exception when others then ok := false; end;
  assert not ok, 'Sales Representative must NOT be able to permanently delete an order';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'admd'::uuid)=1, 'order intact after rep attempt';
  raise notice 'PASS: sales representative denied';
end $$;

------------------------------------------------------------------------------
\echo '== Section 6: SENT / PARTIAL / PAID orders denied; PAID stays fully intact (atomic) =='
-- Build three issued orders in sent / partial / paid states.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'sent',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as o_sent \gset
select public.issue_invoice(:'o_sent'::uuid,'2026-07-03','2026-08-02');

select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'partial',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":4}]'::jsonb) as o_part \gset
select public.issue_invoice(:'o_part'::uuid,'2026-07-03','2026-08-02');
select public.record_payment(:'o_part'::uuid,10,'ach','p-part',null,null);   -- subtotal 100 → partial

select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'paid',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as o_paid \gset
select public.create_commission(:'o_paid'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita Rep',null,null,null,'percent_of_sale',0.05,null,null);
select public.issue_invoice(:'o_paid'::uuid,'2026-07-03','2026-08-02');
select public.record_payment(:'o_paid'::uuid,50,'wire','p-full',null,null);  -- subtotal 50 → paid
do $$ declare ok boolean;
begin
  -- SENT
  ok := false; begin perform public.hard_delete_order(:'o_sent'::uuid,'x'); ok := true; exception when others then ok := false; end;
  assert not ok, 'sent order must be refused';
  -- PARTIAL
  ok := false; begin perform public.hard_delete_order(:'o_part'::uuid,'x'); ok := true; exception when others then ok := false; end;
  assert not ok, 'partial order must be refused';
  -- PAID
  ok := false; begin perform public.hard_delete_order(:'o_paid'::uuid,'x'); ok := true; exception when others then ok := false; end;
  assert not ok, 'paid order must be refused';
end $$;
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'o_sent'::uuid)='sent', 'sent intact';
  assert (select status from public.invoices where id=:'o_part'::uuid)='partial', 'partial intact';
  assert (select status from public.invoices where id=:'o_paid'::uuid)='paid', 'paid intact';
  -- Atomic: the refused PAID deletion left EVERY dependent record untouched.
  assert (select count(*) from public.invoice_items where invoice_id=:'o_paid'::uuid)=1, 'paid items intact';
  assert (select count(*) from public.payments      where invoice_id=:'o_paid'::uuid)=1, 'paid payment intact';
  assert (select count(*) from public.commissions   where invoice_id=:'o_paid'::uuid)=1, 'paid commission intact';
  raise notice 'PASS: sent/partial/paid denied; paid order fully intact (atomic, nothing partially deleted)';
end $$;

------------------------------------------------------------------------------
\echo '== Section 7: order with a PAID commission denied (void + retained pay) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'paid-comm',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as o_pc \gset
select public.issue_invoice(:'o_pc'::uuid,'2026-07-04','2026-08-03');
select public.void_invoice(:'o_pc'::uuid,'voided but keeps a paid commission');
reset role;
-- Superuser: fabricate a retained (paid) commission on the void order to isolate rule (6).
insert into public.commissions(invoice_id,recipient_id,recipient_type,recipient_name,commission_type,rate,amount,status,paid_at)
values (:'o_pc'::uuid,'10000000-0000-0000-0000-000000000003','internal_user','Rita Rep','percent_of_sale',0.05,2.50,'paid',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
do $$ declare ok boolean := false; begin
  begin perform public.hard_delete_order(:'o_pc'::uuid,'try'); ok := true; exception when others then ok := false; end;
  assert not ok, 'order with a paid commission must be refused';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'o_pc'::uuid)=1, 'order with paid commission intact';
  assert (select count(*) from public.commissions where invoice_id=:'o_pc'::uuid and status='paid')=1, 'paid commission retained';
  raise notice 'PASS: order with paid commission denied and retained';
end $$;

------------------------------------------------------------------------------
\echo '== Section 8: unsafe dependent (APPROVED commission) denied =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'approved-comm',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb) as o_ac \gset
select public.issue_invoice(:'o_ac'::uuid,'2026-07-05','2026-08-04');
select public.void_invoice(:'o_ac'::uuid,'void with approved commission');
reset role;
insert into public.commissions(invoice_id,recipient_id,recipient_type,recipient_name,commission_type,rate,amount,status)
values (:'o_ac'::uuid,'10000000-0000-0000-0000-000000000003','internal_user','Rita Rep','percent_of_sale',0.05,2.50,'approved');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
do $$ declare ok boolean := false; begin
  begin perform public.hard_delete_order(:'o_ac'::uuid,'try'); ok := true; exception when others then ok := false; end;
  assert not ok, 'order with an approved (owed) commission must be refused';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'o_ac'::uuid)=1, 'unsafe-dependent order intact';
  raise notice 'PASS: unsafe dependent (approved commission) denied';
end $$;

------------------------------------------------------------------------------
\echo '== Section 9: MISSING REASON denied =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'no-reason',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as o_nr \gset
do $$ declare ok boolean;
begin
  ok := false; begin perform public.hard_delete_order(:'o_nr'::uuid,''); ok := true; exception when others then ok := false; end;
  assert not ok, 'empty reason must be refused';
  ok := false; begin perform public.hard_delete_order(:'o_nr'::uuid,'   '); ok := true; exception when others then ok := false; end;
  assert not ok, 'whitespace-only reason must be refused';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'o_nr'::uuid)=1, 'order intact when reason missing';
  raise notice 'PASS: missing/blank reason denied';
end $$;

------------------------------------------------------------------------------
\echo '== Section 10: FULFILLED / COMPLETE stage denied =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'fulfilled',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as o_ff \gset
reset role;
update public.invoices set stage='fulfilled' where id=:'o_ff'::uuid;  -- simulate downstream fulfillment
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
do $$ declare ok boolean := false; begin
  begin perform public.hard_delete_order(:'o_ff'::uuid,'try'); ok := true; exception when others then ok := false; end;
  assert not ok, 'a fulfilled/completed order must be refused';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.invoices where id=:'o_ff'::uuid)=1, 'fulfilled order intact';
  raise notice 'PASS: fulfilled/complete stage denied';
end $$;

------------------------------------------------------------------------------
\echo '== Section 11: idempotent repeat delete is safe (race guard) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'twice',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as o_2x \gset
select public.hard_delete_order(:'o_2x'::uuid,'first delete');
do $$ declare ok boolean := false; begin
  -- second attempt against the now-gone id must fail cleanly (FOR UPDATE row lock
  -- + not-found guard), never double-delete or crash.
  begin perform public.hard_delete_order(:'o_2x'::uuid,'second delete'); ok := true; exception when others then ok := false; end;
  assert not ok, 'a repeat delete of an already-deleted order must be refused, not crash';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.activity_log where entity_id=:'o_2x'::uuid and action='deleted')=1,
    'exactly one tombstone for the single successful delete';
  raise notice 'PASS: repeat delete is safe (single effect, single tombstone)';
end $$;

------------------------------------------------------------------------------
\echo '== Section 12: existing VOID workflow is UNCHANGED =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'void-still-works',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb) as o_vw \gset
select public.issue_invoice(:'o_vw'::uuid,'2026-07-06','2026-08-05') as o_vw_num \gset
select public.void_invoice(:'o_vw'::uuid,'normal void still works');
-- issued invoices still cannot be plain-deleted from the base table (lock intact)
reset role;
do $$ declare ok boolean := false; begin
  assert (select status from public.invoices where id=:'o_vw'::uuid)='void', 'void still sets status void';
  assert (select count(*) from public.invoice_status_history where invoice_id=:'o_vw'::uuid and to_status='void')=1,
    'void still writes status history';
  begin delete from public.invoices where id=:'o_vw'::uuid; ok := true; exception when others then ok := false; end;
  assert not ok, 'base-table delete of a void invoice is still blocked by the immutability lock';
  raise notice 'PASS: void workflow and issued-invoice immutability lock unchanged';
end $$;

rollback;
\echo '== ALL M7 order-deletion assertions passed (rolled back) =='
