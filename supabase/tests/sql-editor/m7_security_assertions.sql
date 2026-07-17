-- ============================================================================
-- Aurum Supply House · M7 · Adversarial security assertions (STRUCTURAL)
-- ----------------------------------------------------------------------------
-- SQL EDITOR EDITION — pure SQL, no psql meta-commands.
-- This is a hand-converted copy of supabase/tests/m7_security_assertions.sql
-- for pasting directly into the Supabase SQL Editor. The only change from the
-- original is the removal of the psql-only `\set ON_ERROR_STOP on` line; every
-- assertion is preserved exactly. Each `assert` inside a DO block raises an
-- exception that aborts the run, so a clean run == all guarantees present.
--
-- Proves — at the schema level, no fixtures required — that restricted financial
-- fields CANNOT be reached by a Sales Rep through any of the routes the M7 brief
-- names: dashboard views, insights views, RPCs, CSV exports, joins, and direct
-- base-table access.
--
-- To run: paste this entire file into the Supabase SQL Editor and click Run
-- (against a migrated database with migrations 0001..0391 applied).
-- ============================================================================

do $$
declare
  def text;
begin
  -- 1. Dashboard/order surface masks every internal figure behind app.is_admin().
  -- NOTE: pg_get_viewdef(..., true) PRETTY-PRINTS each CASE across several indented
  -- lines ("CASE\n  WHEN app.is_admin() THEN i.net_profit\n  ELSE NULL::numeric\nEND"),
  -- so a single-space ILIKE pattern can NEVER match a correctly-masked view. Collapse
  -- every run of whitespace to one space first, then the substring checks are exact.
  def := regexp_replace(pg_get_viewdef('public.v_orders'::regclass, true), '\s+', ' ', 'g');
  assert def ilike '%is_admin()%', 'v_orders must gate internal columns on app.is_admin()';
  assert position('net_profit' in def) > 0, 'v_orders must expose net_profit (masked)';
  assert position('gross_profit' in def) > 0, 'v_orders must expose gross_profit (masked)';
  -- every sensitive column appears alongside an is_admin guard
  perform 1
  where def ilike '%case when app.is_admin() then i.net_profit%'
    and def ilike '%case when app.is_admin() then i.gross_profit%'
    and def ilike '%case when app.is_admin() then i.total_true_cost%';
  assert found, 'v_orders must mask net_profit / gross_profit / total_true_cost for non-admins';

  -- 2. M7 line-level insights surface masks line cost + line gross profit.
  --    (same whitespace-normalization rationale as check #1 above).
  def := regexp_replace(pg_get_viewdef('public.v_report_order_lines'::regclass, true), '\s+', ' ', 'g');
  assert def ilike '%case when app.is_admin() then ii.line_true_cost%',
    'v_report_order_lines must mask line_true_cost';
  assert def ilike '%case when app.is_admin() then ii.line_gross_profit%',
    'v_report_order_lines must mask line_gross_profit';

  -- 3. No customer/staff line surface leaks the CoA path.
  assert pg_get_viewdef('public.v_order_items'::regclass, true) not ilike '%coa_path%',
    'v_order_items must never expose coa_path';

  -- 4. Line/commission GP masking carries into the commission surface too.
  assert pg_get_viewdef('public.v_commissions'::regclass, true) ilike '%is_admin()%',
    'v_commissions must gate invoice_gross_profit on app.is_admin()';

  raise notice 'OK  view masking (v_orders, v_report_order_lines, v_order_items, v_commissions)';
end $$;

-- 5. Legacy insights views are now security_invoker=true (base RLS applies), so a
--    rep gets zero rows / NULL profit instead of company-wide profit.
do $$
declare
  v text;
  opts text[];
begin
  foreach v in array array[
    'v_revenue_monthly','v_profit_by_client','v_profit_by_product','v_profit_by_rep',
    'v_commission_by_rep','v_outstanding_invoices','v_purchase_spend_monthly'
  ] loop
    select c.reloptions into opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v;
    assert opts is not null and 'security_invoker=true' = any(opts),
      format('legacy insights view %I must be security_invoker=true (base RLS applies)', v);
  end loop;
  raise notice 'OK  legacy insights views hardened to security_invoker=true';
end $$;

-- 6. Direct base-table access: the cost/profit-bearing tables carry NO rep policy
--    (M4/M5/M6 dropped them) — only admin-scoped policies remain. A rep reading
--    the base table (or joining through it) therefore returns zero rows.
do $$
declare
  bad int;
begin
  select count(*) into bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('invoices','invoice_items','commissions','order_expenses',
                      'purchase_orders','purchase_order_items','manufacturer_payments')
    and (qual ilike '%rep_client_ids%' or qual ilike '%sales_rep_id = auth.uid()%'
         or policyname ilike '%rep%');
  assert bad = 0,
    format('%s rep-scoped policy(ies) still present on cost/profit base tables — must be admin-only', bad);

  -- and each such table must have at least one admin-only policy
  assert (select count(distinct tablename) from pg_policies
          where schemaname='public'
            and tablename in ('invoices','invoice_items','commissions','order_expenses',
                              'purchase_orders','purchase_order_items','manufacturer_payments')
            and qual ilike '%is_admin()%') = 7,
    'every cost/profit base table must retain an admin-only policy';
  raise notice 'OK  cost/profit base tables are admin-only (no rep policy)';
end $$;

-- 7. RPC surface: the rep-safe activity feed is SECURITY DEFINER and scopes in
--    its own body; anon cannot execute it.
do $$
begin
  assert (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='report_recent_activity'),
    'report_recent_activity must be SECURITY DEFINER';
  assert not has_function_privilege('anon',
    'public.report_recent_activity(integer)', 'EXECUTE'),
    'anon must not execute report_recent_activity';
  assert pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='report_recent_activity')) ilike '%rep_client_ids%',
    'report_recent_activity must apply rep book scoping';
  raise notice 'OK  report_recent_activity is definer + rep-scoped + anon-denied';
end $$;

-- 8. anon (public web role) can select NONE of the reporting surfaces.
do $$
declare v text;
begin
  foreach v in array array[
    'v_orders','v_order_items','v_report_order_lines','v_commissions','v_ar_aging',
    'v_quotes','v_purchase_orders','v_manufacturer_payments','v_profit_by_client'
  ] loop
    assert not has_table_privilege('anon', format('public.%I', v), 'SELECT'),
      format('anon must not have SELECT on %I', v);
  end loop;
  raise notice 'OK  anon has no SELECT on any reporting surface';
end $$;

-- 9. PO / manufacturer subsystem is admin-only at the table level (0350), so the
--    manufacturer-cost columns can never be reached by a rep via PO joins.
do $$
begin
  assert (select count(*) from pg_policies
          where schemaname='public' and tablename='purchase_order_items'
            and qual ilike '%is_admin()%') >= 1,
    'purchase_order_items must be admin-only';
  assert (select count(*) from pg_policies
          where schemaname='public' and tablename='manufacturer_payments'
            and qual ilike '%is_admin()%') >= 1,
    'manufacturer_payments must be admin-only';
  raise notice 'OK  purchase-order / manufacturer cost tables are admin-only';
end $$;

select 'M7 structural security assertions: ALL PASSED' as result;
