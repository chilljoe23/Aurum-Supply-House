-- ============================================================================
-- Aurum Supply House — M5 commissions / payments / AR test suite
--   psql "$DATABASE_URL" -f supabase/tests/m5_commissions_payments.sql
-- Non-destructive (BEGIN … ROLLBACK), ASSERT-driven, exercised through the real
-- public RPCs and masked views from each role. Requires migrations 0001–0260.
-- Covers: all four commission calculations, multiple recipients + rollup +
-- net-profit reduction, external recipients, the pending→earned→approved→paid
-- lifecycle, invalid transitions, paid immutability, invoice-void behavior,
-- partial/full/duplicate/draft/void payments + overpayment, AR aging buckets and
-- paid/void exclusion, owner/admin vs rep permissions, rep isolation, cost/profit
-- masking, own-commission-only visibility, audit events, and atomic rollback.
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
 ('bb000000-0000-0000-0000-000000000001',10.00,'2026-01-01','manual');   -- cost 10 → GP math

insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('20000000-0000-0000-0000-000000000001','Standard','STD','USD',true,'active');
insert into public.pricing_sheet_items(pricing_sheet_id,product_id,selling_price,min_quantity) values
 ('20000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',25.00,1);  -- P1 @ 25

insert into public.clients(id,company_name,status,assigned_rep_id,default_pricing_sheet_id,payment_terms) values
 ('30000000-0000-0000-0000-000000000001','Gamma LLC','active','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','net_30'),
 ('30000000-0000-0000-0000-000000000002','Delta Inc','active','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','net_30');

-- Helper: act as a given user with the authenticated role.
-- (mirrors the M4 suite: set the JWT sub so auth.uid() resolves in RPCs)

------------------------------------------------------------------------------
\echo '== Section 1: build order A (subtotal 250, cost 100, GP 150) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.save_order_draft(
  null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order A',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_a \gset
reset role;
do $$ declare i record; begin
  select subtotal,total_true_cost,gross_profit into i from public.invoices where id=:'order_a'::uuid;
  assert i.subtotal=250.00 and i.total_true_cost=100.00 and i.gross_profit=150.00,
    format('order A economics wrong: %s', i);
  raise notice 'PASS: order A subtotal 250, GP 150';
end $$;

------------------------------------------------------------------------------
\echo '== Section 2: all four commission calculations + external recipient =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
-- 1) % of sale 5% → 12.50 (internal rep1)
select public.create_commission(:'order_a'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita Rep',null,null,null,'percent_of_sale',0.05,null,null) as c_sale \gset
-- 2) % of gross profit 10% → 15.00 (internal owner)
select public.create_commission(:'order_a'::uuid,'internal_user','10000000-0000-0000-0000-000000000001','Olivia Owner',null,null,null,'percent_of_gross_profit',0.10,null,null) as c_gp \gset
-- 3) flat 500 → 500 (external partner; exceeds GP but must NOT be blocked)
select public.create_commission(:'order_a'::uuid,'external_partner',null,'Referral Co','pay@ref.co','Referral Co','ACH to routing 123','flat',500,null,'referral') as c_flat \gset
-- 4) per unit 2 × 10 = 20 (internal admin)
select public.create_commission(:'order_a'::uuid,'internal_user','10000000-0000-0000-0000-000000000002','Adam Admin',null,null,null,'per_unit',2,10,null) as c_unit \gset
reset role;
do $$ declare c record; begin
  select amount,basis_amount,invoice_subtotal,invoice_gross_profit into c from public.commissions where id=:'c_sale'::uuid;
  assert c.amount=12.50 and c.basis_amount=250.00, format('%% of sale wrong: %s', c);
  assert c.invoice_subtotal=250.00 and c.invoice_gross_profit=150.00, 'snapshots frozen on % of sale';

  select amount,basis_amount into c from public.commissions where id=:'c_gp'::uuid;
  assert c.amount=15.00 and c.basis_amount=150.00, format('%% of GP wrong: %s', c);

  select amount,recipient_id,recipient_type,recipient_company into c from public.commissions where id=:'c_flat'::uuid;
  assert c.amount=500.00, format('flat wrong: %s', c);
  assert c.recipient_id is null and c.recipient_type='external_partner' and c.recipient_company='Referral Co',
    'external recipient must have no internal user id';

  select amount,basis_amount into c from public.commissions where id=:'c_unit'::uuid;
  assert c.amount=20.00 and c.basis_amount=10.00, format('per-unit wrong: %s', c);
  raise notice 'PASS: %% of sale 12.50, %% of GP 15.00, flat 500 (external, > GP but allowed), per-unit 20';
end $$;

------------------------------------------------------------------------------
\echo '== Section 3: multi-recipient rollup + net-profit reduction =='
do $$ declare i record; begin
  select total_commission, net_profit, gross_profit into i from public.invoices where id=:'order_a'::uuid;
  assert i.total_commission=547.50, format('total commission should be 547.50, got %s', i.total_commission);
  assert i.net_profit=150.00-547.50, format('net profit should be GP-547.50, got %s', i.net_profit);
  raise notice 'PASS: rollup 547.50; net profit reduced by every non-void commission';
end $$;

------------------------------------------------------------------------------
\echo '== Section 4: issue A, partial then full payment → pending→earned =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.issue_invoice(:'order_a'::uuid, '2026-07-01', '2026-07-31');
select public.record_payment(:'order_a'::uuid,100,'ach','p1',null,null);
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'order_a'::uuid)='partial', 'A partial after 100';
  assert (select count(*) from public.commissions where invoice_id=:'order_a'::uuid and status='pending')=4,
    'commissions stay pending until the invoice is fully paid';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);
select public.record_payment(:'order_a'::uuid,150,'wire','p2',null,null);   -- full
reset role;
do $$ begin
  assert (select status from public.invoices where id=:'order_a'::uuid)='paid', 'A paid after full';
  assert (select count(*) from public.commissions where invoice_id=:'order_a'::uuid and status='earned')=4,
    'all commissions earn when the invoice is fully paid';
  raise notice 'PASS: pending → earned on full invoice payment';
end $$;

------------------------------------------------------------------------------
\echo '== Section 5: earned→approved→paid + invalid transitions + immutability =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.approve_commission(:'c_sale'::uuid);
select public.pay_commission(:'c_sale'::uuid,'wire','payref','thanks',null);
reset role;
do $$ declare c record; begin
  select status, paid_method, paid_reference, paid_by into c from public.commissions where id=:'c_sale'::uuid;
  assert c.status='paid' and c.paid_method='wire' and c.paid_reference='payref', format('pay snapshot wrong: %s', c);
  assert c.paid_by='10000000-0000-0000-0000-000000000002', 'paid_by recorded';
  raise notice 'PASS: earned → approved → paid (method/reference/paid_by recorded)';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);
\echo '   pay an earned (not approved) commission must fail'
do $$ declare r boolean:=false; begin
  begin perform public.pay_commission(:'c_gp'::uuid,'wire',null,null,null); exception when others then r:=true; end;
  assert r, 'cannot pay a commission that is not approved';
  raise notice 'PASS: pay of non-approved rejected';
end $$;
\echo '   approve / pay an already-paid commission must fail (no duplicate action)'
do $$ declare r boolean:=false; begin
  begin perform public.approve_commission(:'c_sale'::uuid); exception when others then r:=true; end;
  assert r, 'cannot approve a paid commission';
  r:=false;
  begin perform public.pay_commission(:'c_sale'::uuid,'wire',null,null,null); exception when others then r:=true; end;
  assert r, 'cannot re-pay a paid commission';
  raise notice 'PASS: duplicate approve/pay rejected';
end $$;
\echo '   editing a paid commission must fail (immutable)'
do $$ declare r boolean:=false; begin
  begin perform public.update_commission(:'c_sale'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita Rep',null,null,null,'percent_of_sale',0.99,null,null);
  exception when others then r:=true; end;
  assert r, 'a paid commission cannot be edited';
  raise notice 'PASS: paid commission immutable';
end $$;
reset role;
\echo '   invalid direct transition paid→pending must fail (guard trigger)'
do $$ declare r boolean:=false; begin
  begin update public.commissions set status='pending' where id=:'c_sale'::uuid; exception when others then r:=true; end;
  assert r, 'transition guard blocks paid→pending';
  assert (select status from public.commissions where id=:'c_sale'::uuid)='paid', 'still paid';
  raise notice 'PASS: invalid lifecycle transition rejected';
end $$;

------------------------------------------------------------------------------
\echo '== Section 6: invoice void → unpaid commissions void, paid retained =='
-- Order C: pay it fully (earn), pay one commission, add another (earned), then void.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order C',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_c \gset
select public.create_commission(:'order_c'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita Rep',null,null,null,'flat',30,null,null) as c_paid \gset
select public.issue_invoice(:'order_c'::uuid, '2026-07-01', '2026-07-31');
select public.record_payment(:'order_c'::uuid,250,'wire','full',null,null);   -- → paid, commission earned
select public.approve_commission(:'c_paid'::uuid);
select public.pay_commission(:'c_paid'::uuid,'check','chk-9',null,null);       -- commission paid
-- second commission created after invoice is paid → starts earned; approve it.
select public.create_commission(:'order_c'::uuid,'internal_user','10000000-0000-0000-0000-000000000001','Olivia Owner',null,null,null,'flat',40,null,null) as c_open \gset
select public.approve_commission(:'c_open'::uuid);
select public.void_invoice(:'order_c'::uuid,'customer returned goods');
reset role;
do $$ begin
  assert (select status from public.commissions where id=:'c_paid'::uuid)='paid', 'paid commission retained on void';
  assert (select status from public.commissions where id=:'c_open'::uuid)='void', 'approved (unpaid) commission voided with invoice';
  raise notice 'PASS: void invoice voids unpaid commissions, retains paid ones';
end $$;

------------------------------------------------------------------------------
\echo '== Section 7: customer payments — duplicate, draft, void rejection =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order D',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_d \gset
\echo '   payment on a DRAFT must fail'
do $$ declare r boolean:=false; begin
  begin perform public.record_payment(:'order_d'::uuid,50,'wire',null,null,null); exception when others then r:=true; end;
  assert r, 'no payment on a draft'; raise notice 'PASS: payment on draft rejected';
end $$;
select public.issue_invoice(:'order_d'::uuid, current_date - 15, current_date - 15);   -- 1–30 overdue
select public.record_payment(:'order_d'::uuid,50,'wire','dupref',null,null);
\echo '   an identical payment within 2 minutes must fail (duplicate guard)'
do $$ declare r boolean:=false; begin
  begin perform public.record_payment(:'order_d'::uuid,50,'wire','dupref',null,null); exception when others then r:=true; end;
  assert r, 'duplicate payment rejected'; raise notice 'PASS: duplicate payment rejected';
end $$;
\echo '   overpayment must fail'
do $$ declare r boolean:=false; begin
  begin perform public.record_payment(:'order_d'::uuid,9999,'wire','x',null,null); exception when others then r:=true; end;
  assert r, 'overpayment rejected'; raise notice 'PASS: overpayment rejected';
end $$;
\echo '   payment on a VOID invoice must fail'
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order V',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_v \gset
select public.issue_invoice(:'order_v'::uuid, '2026-07-01', '2026-07-31');
select public.void_invoice(:'order_v'::uuid,'test void');
do $$ declare r boolean:=false; begin
  begin perform public.record_payment(:'order_v'::uuid,10,'wire',null,null,null); exception when others then r:=true; end;
  assert r, 'no payment on void'; raise notice 'PASS: payment on void rejected';
end $$;

------------------------------------------------------------------------------
\echo '== Section 8: AR aging buckets + paid/void/draft exclusion =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
-- Order E: 45 days overdue (31–60).  Order F: due in the future (current).
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order E',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_e \gset
select public.issue_invoice(:'order_e'::uuid, current_date - 45, current_date - 45);
select public.save_order_draft(null,'30000000-0000-0000-0000-000000000001',null,'USD',0,0,0,0,'order F',
  '[{"product_id":"bb000000-0000-0000-0000-000000000001","quantity":10}]'::jsonb) as order_f \gset
select public.issue_invoice(:'order_f'::uuid, current_date, current_date + 10);
do $$ declare v_d text; v_e text; v_f text; begin
  select aging_bucket into v_d from public.v_ar_aging where id=:'order_d'::uuid;   -- 15 days overdue
  select aging_bucket into v_e from public.v_ar_aging where id=:'order_e'::uuid;   -- 45 days overdue
  select aging_bucket into v_f from public.v_ar_aging where id=:'order_f'::uuid;   -- future
  assert v_d='d1_30', format('order D should be 1–30, got %s', v_d);
  assert v_e='d31_60', format('order E should be 31–60, got %s', v_e);
  assert v_f='current', format('order F should be current, got %s', v_f);
  -- Exclusions: paid (A, C? C is void), void (V), draft (none open) never appear.
  assert (select count(*) from public.v_ar_aging where id=:'order_a'::uuid)=0, 'paid invoice excluded from AR';
  assert (select count(*) from public.v_ar_aging where id=:'order_v'::uuid)=0, 'void invoice excluded from AR';
  raise notice 'PASS: AR aging buckets correct; paid/void excluded';
end $$;
do $$ declare s record; begin
  select * into s from public.v_ar_summary;
  -- D(200 balance) + E(250) + F(250) = 700 outstanding; D+E overdue = 450.
  assert s.total_outstanding = 700.00, format('AR total should be 700, got %s', s.total_outstanding);
  assert s.overdue_amt = 450.00, format('AR overdue should be 450, got %s', s.overdue_amt);
  raise notice 'PASS: AR summary outstanding 700, overdue 450';
end $$;

------------------------------------------------------------------------------
\echo '== Section 9: permissions — rep cannot create/approve/pay/void =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1
do $$ begin
  begin perform public.create_commission(:'order_d'::uuid,'internal_user','10000000-0000-0000-0000-000000000003','Rita',null,null,null,'flat',5,null,null);
    raise exception 'FAIL: rep created a commission'; exception when insufficient_privilege then raise notice 'PASS: rep cannot create (%).', sqlstate; end;
  begin perform public.approve_commission(:'c_gp'::uuid);
    raise exception 'FAIL: rep approved'; exception when insufficient_privilege then raise notice 'PASS: rep cannot approve (%).', sqlstate; end;
  begin perform public.pay_commission(:'c_gp'::uuid,'wire',null,null,null);
    raise exception 'FAIL: rep paid'; exception when insufficient_privilege then raise notice 'PASS: rep cannot pay (%).', sqlstate; end;
  begin perform public.void_commission(:'c_gp'::uuid,'x');
    raise exception 'FAIL: rep voided'; exception when insufficient_privilege then raise notice 'PASS: rep cannot void (%).', sqlstate; end;
end $$;

------------------------------------------------------------------------------
\echo '== Section 10: masking + isolation + own-only visibility (v_commissions) =='
-- rep1 owns commission c_sale (recipient). Sees it; GP masked; sees no others.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- rep1
do $$ declare c record; n int; begin
  select * into c from public.v_commissions where id=:'c_sale'::uuid;
  assert c.id is not null, 'rep must see own commission';
  assert c.invoice_gross_profit is null, 'invoice gross profit masked for rep';
  assert c.can_see_internal = false, 'can_see_internal false for rep';
  assert c.basis_amount = 250.00, 'rep sees % of sale basis (subtotal, not cost-derived)';
  -- rep1 must NOT see the owner/admin/external commissions on the same invoice.
  select count(*) into n from public.v_commissions where invoice_id=:'order_a'::uuid;
  assert n = 1, format('rep must see only their own commission, saw %s', n);
  raise notice 'PASS: rep sees only own commission, GP masked';
end $$;
-- rep2 sees none of order A''s commissions.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004', true);  -- rep2
do $$ begin
  assert (select count(*) from public.v_commissions where invoice_id=:'order_a'::uuid)=0, 'rep2 sees no commissions here';
  raise notice 'PASS: cross-rep commission isolation';
end $$;
-- admin sees the GP basis for the % of GP commission.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
do $$ declare c record; begin
  select * into c from public.v_commissions where id=:'c_gp'::uuid;
  assert c.invoice_gross_profit=150.00 and c.basis_amount=150.00 and c.can_see_internal,
    'admin sees GP basis on the % of GP commission';
  raise notice 'PASS: admin sees gross-profit basis';
end $$;

------------------------------------------------------------------------------
\echo '== Section 11: audit events recorded (non-sensitive) =='
reset role;
do $$ begin
  assert exists(select 1 from public.activity_log where entity_type='commission' and action='commission_created' and entity_id=:'c_sale'::uuid), 'created event';
  assert exists(select 1 from public.activity_log where entity_type='commission' and action='commission_earned'   and entity_id=:'c_sale'::uuid), 'earned event';
  assert exists(select 1 from public.activity_log where entity_type='commission' and action='commission_approved' and entity_id=:'c_sale'::uuid), 'approved event';
  assert exists(select 1 from public.activity_log where entity_type='commission' and action='commission_paid'     and entity_id=:'c_sale'::uuid), 'paid event';
  assert exists(select 1 from public.activity_log where entity_type='commission' and action='commission_voided'   and entity_id=:'c_open'::uuid), 'voided event';
  -- Metadata must never carry the amount (activity_log is staff-wide readable).
  assert not exists(
    select 1 from public.activity_log
     where entity_type='commission' and metadata ? 'amount'), 'activity metadata must not include amounts';
  raise notice 'PASS: commission audit events present and non-sensitive';
end $$;

------------------------------------------------------------------------------
\echo '== Section 12: atomic rollback on invalid create =='
select count(*)::text as before_ct from public.commissions \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
do $$ begin
  -- internal recipient with no user id → must raise, nothing inserted.
  perform public.create_commission(:'order_d'::uuid,'internal_user',null,'No One',null,null,null,'flat',5,null,null);
  raise notice 'UNEXPECTED: invalid create did not error';
exception when others then raise notice 'expected create failure (%).', sqlstate;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.commissions) = :'before_ct'::int, 'no partial commission after a failed create';
  raise notice 'PASS: failed create left no row';
end $$;

rollback;
\echo 'M5 commissions/payments suite complete (rolled back). All ASSERTs passed if no error was raised.';
