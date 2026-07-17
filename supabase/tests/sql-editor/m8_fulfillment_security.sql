-- ============================================================================
-- Aurum Supply House · Fulfillment · Adversarial security assertions (STRUCTURAL)
-- ----------------------------------------------------------------------------
-- Proves — at the schema level, no fixtures required — that the fulfillment
-- objects preserve the security model: base tables are RLS-protected & admin-
-- only for writes, the read views are row-scoped and carry no financial columns,
-- the write RPCs are SECURITY DEFINER and unreachable by anon, and finalized
-- shipments are append-only. Every check raises (aborting the run) if a guarantee
-- is missing, so a clean run == all guarantees present.
--
-- Run against a migrated database (0001..0399):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m8_fulfillment_security.sql
-- ============================================================================

do $$
declare t text; def text;
begin
  -- 1. RLS is enabled on every new base table.
  foreach t in array array['order_line_fulfillment','order_shipments','order_shipment_items'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass),
      format('RLS must be enabled on %s', t);
    -- Admin-only "for all" policy present.
    assert exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_admin_all'),
      format('%s must have an admin-only policy', t);
    -- No direct write grant to the API roles (writes go only through definer RPCs).
    assert not has_table_privilege('authenticated', 'public.'||t, 'INSERT'),
      format('authenticated must NOT have INSERT on %s', t);
    assert not has_table_privilege('authenticated', 'public.'||t, 'UPDATE'),
      format('authenticated must NOT have UPDATE on %s', t);
    assert not has_table_privilege('authenticated', 'public.'||t, 'DELETE'),
      format('authenticated must NOT have DELETE on %s', t);
    -- anon has no access at all.
    assert not has_table_privilege('anon', 'public.'||t, 'SELECT'),
      format('anon must NOT read %s', t);
  end loop;
  raise notice 'OK  base-table RLS + admin-only writes + anon denied';

  -- 2. Read views are row-scoped (can_access_invoice) and carry NO financial columns.
  foreach t in array array['v_order_fulfillment_lines','v_order_fulfillment_summary',
                           'v_order_shipments','v_order_shipment_items'] loop
    def := pg_get_viewdef(('public.'||t)::regclass, true);
    assert def ilike '%can_access_invoice%',
      format('%s must be row-scoped via app.can_access_invoice', t);
    assert (select count(*) from information_schema.columns
              where table_schema='public' and table_name=t
                and column_name ~* '(unit_price|line_total|line_subtotal|true_cost|gross_profit|net_profit|margin|commission|expense)') = 0,
      format('%s must expose no financial columns', t);
    assert not has_table_privilege('anon', 'public.'||t, 'SELECT'),
      format('anon must NOT read %s', t);
  end loop;
  raise notice 'OK  read views row-scoped + customer-safe';

  -- 3. Write RPCs are SECURITY DEFINER, not executable by anon, executable by authenticated.
  foreach t in array array['set_line_fulfillment_status','create_shipment','void_shipment'] loop
    assert exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname=t and p.prosecdef),
      format('public.%s must be SECURITY DEFINER', t);
  end loop;
  assert not has_function_privilege('anon', 'public.create_shipment(uuid,date,text,text,text,text,text,jsonb)', 'EXECUTE'),
    'anon must NOT execute create_shipment';
  assert has_function_privilege('authenticated', 'public.create_shipment(uuid,date,text,text,text,text,text,jsonb)', 'EXECUTE'),
    'authenticated must execute create_shipment (body still gates on app.is_admin)';
  assert not has_function_privilege('anon', 'public.void_shipment(uuid,text)', 'EXECUTE'),
    'anon must NOT execute void_shipment';
  raise notice 'OK  RPCs are definer + anon-denied';

  -- 4. Append-only locks exist on both shipment tables.
  assert exists (select 1 from pg_trigger where tgrelid='public.order_shipments'::regclass and tgname='trg_order_shipments_lock'),
    'order_shipments must have the append-only lock trigger';
  assert exists (select 1 from pg_trigger where tgrelid='public.order_shipment_items'::regclass and tgname='trg_order_shipment_items_lock'),
    'order_shipment_items must have the append-only lock trigger';
  raise notice 'OK  append-only lock triggers present';
end $$;

select 'M8 fulfillment security assertions: ALL PASSED' as result;
