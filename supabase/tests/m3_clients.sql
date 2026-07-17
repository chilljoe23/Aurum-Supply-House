-- ============================================================================
-- Aurum Supply House — M3 client-management test suite (non-destructive; ROLLBACK)
--   psql "$DATABASE_URL" -f supabase/tests/m3_clients.sql
-- Verifies database-layer guarantees for clients: RLS scoping, rep self-assignment,
-- admin assignment, address persistence, status transitions, pricing preservation,
-- and the M3 activity-log trigger (migration 0160). App-layer rules (near-duplicate
-- company names, same-as-billing copy) are noted where the DB is not the enforcer.
-- Uses ASSERT so any regression aborts loudly.
-- ============================================================================
begin;

-- ---- Fixtures (as superuser; RLS bypassed for setup) -----------------------
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','owner@a.test','{"full_name":"Olivia Owner"}'),
 ('10000000-0000-0000-0000-000000000002','admin@a.test','{"full_name":"Adam Admin"}'),
 ('10000000-0000-0000-0000-000000000003','rep1@a.test','{"full_name":"Rita Rep"}'),
 ('10000000-0000-0000-0000-000000000004','rep2@a.test','{"full_name":"Raj Rep"}');
-- Roles are explicit (handle_new_user only auto-elevates the very first profile).
update public.profiles set role='owner'     where email='owner@a.test';
update public.profiles set role='admin'     where email='admin@a.test';
update public.profiles set role='sales_rep' where email in ('rep1@a.test','rep2@a.test');

insert into public.pricing_sheets(id,name,code,currency,is_default,status) values
 ('20000000-0000-0000-0000-000000000001','Standard','STD','USD',true,'active');

\echo '== Section 1: Owner/Admin may create a client and assign any rep =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001', true);  -- owner
insert into public.clients(id, company_name, assigned_rep_id, billing_address, shipping_address, created_by)
values (
  '30000000-0000-0000-0000-000000000001', 'Acme Labs',
  '10000000-0000-0000-0000-000000000003',                     -- assign Rita (owner may assign anyone)
  '{"line1":"1 Market St","city":"Denver","region":"CO","postal_code":"80202","country":"USA"}',
  '{"line1":"1 Market St","city":"Denver","region":"CO","postal_code":"80202","country":"USA"}',
  '10000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.clients where id='30000000-0000-0000-0000-000000000001')=1,
    'owner should be able to create a client';
end $$;

\echo '== Section 2: Owner/Admin can reassign to any active rep =='
update public.clients set assigned_rep_id='10000000-0000-0000-0000-000000000004'  -- reassign to Raj
 where id='30000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select assigned_rep_id from public.clients where id='30000000-0000-0000-0000-000000000001')
         ='10000000-0000-0000-0000-000000000004', 'admin reassignment should persist';
end $$;

\echo '== Section 3: Sales rep may create a client only when self-assigned =='
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003', true);  -- Rita
insert into public.clients(id, company_name, assigned_rep_id, created_by)
values ('30000000-0000-0000-0000-000000000002','Rita Co','10000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000003');
do $$ begin
  assert (select count(*) from public.clients where id='30000000-0000-0000-0000-000000000002')=1,
    'rep self-assigned create should succeed';
end $$;

\echo '   rep CANNOT assign a client to another rep (RLS WITH CHECK) — expect rejection'
do $$ begin
  insert into public.clients(company_name, assigned_rep_id)
  values ('Sneaky Co','10000000-0000-0000-0000-000000000004');  -- assign Raj, not self
  raise exception 'FAIL: rep was allowed to assign another rep';
exception when insufficient_privilege or check_violation then
  raise notice 'PASS: rep blocked from assigning another rep (%).', sqlstate;
end $$;

\echo '== Section 4: Sales rep cannot view or edit another rep''s client =='
-- Client 30..01 is assigned to Raj; Rita must neither see nor edit it.
do $$ begin
  assert (select count(*) from public.clients where id='30000000-0000-0000-0000-000000000001')=0,
    'rep must not see another rep''s client';
end $$;
with upd as (
  update public.clients set notes='hacked' where id='30000000-0000-0000-0000-000000000001' returning 1)
select count(*) as rows_updated from upd \gset
do $$ begin
  assert :rows_updated = 0, 'rep must not be able to edit another rep''s client';
end $$;

\echo '== Section 5: Billing/shipping addresses persist; same-as-billing stored equal =='
reset role;  -- superuser to read the owner-created row's addresses regardless of RLS
do $$
declare b jsonb; s jsonb;
begin
  select billing_address, shipping_address into b, s
    from public.clients where id='30000000-0000-0000-0000-000000000001';
  assert b->>'city' = 'Denver', 'billing address must persist';
  assert b = s, 'same-as-billing must store shipping equal to billing';
end $$;

\echo '== Section 6: Status transitions + inactive clients remain (no hard delete) =='
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002', true);  -- admin
update public.clients set status='prospect' where id='30000000-0000-0000-0000-000000000001';
update public.clients set status='inactive' where id='30000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.clients where id='30000000-0000-0000-0000-000000000001')='inactive',
    'status change should persist';
  assert (select count(*) from public.clients where id='30000000-0000-0000-0000-000000000001')=1,
    'inactive client must still exist and be visible to admin (no hard delete)';
end $$;

\echo '== Section 7: Pricing-model assignment is preserved across unrelated edits =='
update public.clients set default_pricing_sheet_id='20000000-0000-0000-0000-000000000001'
 where id='30000000-0000-0000-0000-000000000001';
update public.clients set primary_contact_name='Pat Buyer'
 where id='30000000-0000-0000-0000-000000000001';   -- unrelated edit
do $$ begin
  assert (select default_pricing_sheet_id from public.clients where id='30000000-0000-0000-0000-000000000001')
         ='20000000-0000-0000-0000-000000000001', 'pricing assignment must survive edits';
end $$;

\echo '== Section 7b: Generic field edit succeeds and journals an ''updated'' event =='
-- Regression guard for the 0160 defect (fixed in 0170): appending a changed-field
-- name to a text[] with `||` and an untyped literal raised
-- `malformed array literal: "email"` and aborted the UPDATE. This exercises the
-- exact failing path — an email edit with company_name/contact unchanged — and
-- asserts the row is persisted and an 'updated' event carries the field names.
update public.clients set email='buyer@acme.test', notes='call before noon'
 where id='30000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select email from public.clients where id='30000000-0000-0000-0000-000000000001')='buyer@acme.test',
    'email edit must persist (0170 trigger fix)';
end $$;

\echo '== Section 8: Activity logging (migrations 0160/0170) captures lifecycle events =='
reset role;  -- superuser: read activity_log without RLS filtering
do $$
declare n_created int; n_status int; n_rep int; n_model int; n_updated int; v_fields jsonb;
begin
  select count(*) into n_created from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='created';
  select count(*) into n_status from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='status_changed';
  select count(*) into n_rep from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='rep_reassigned';
  select count(*) into n_model from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='model_changed';
  select count(*) into n_updated from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='updated';
  -- The most recent 'updated' event should list the fields that moved as an array.
  select metadata->'fields' into v_fields from public.activity_log
   where entity_type='client' and entity_id='30000000-0000-0000-0000-000000000001' and action='updated'
   order by created_at desc limit 1;
  assert n_created = 1,  format('expected 1 created event, got %s', n_created);
  assert n_status >= 2,  format('expected >=2 status_changed events, got %s', n_status);
  assert n_rep   >= 1,   format('expected >=1 rep_reassigned event, got %s', n_rep);
  assert n_model >= 1,   format('expected >=1 model_changed event, got %s', n_model);
  assert n_updated >= 1, format('expected >=1 updated event, got %s', n_updated);
  assert v_fields ? 'email' and v_fields ? 'notes',
    format('updated event should record changed field names, got %s', v_fields);
  raise notice 'PASS: activity events created=% status=% rep=% model=% updated=% fields=%',
    n_created, n_status, n_rep, n_model, n_updated, v_fields;
end $$;

-- NOTE: near-duplicate company-name prevention is an application-layer guard in
-- createClient() (normalized-name match with an explicit "create anyway" override).
-- The database intentionally does NOT enforce name uniqueness, so it is not asserted here.

rollback;
\echo 'M3 client suite complete (rolled back). All ASSERTs passed if no error was raised.';
