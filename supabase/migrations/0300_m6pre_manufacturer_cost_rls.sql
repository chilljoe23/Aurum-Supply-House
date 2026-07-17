-- ============================================================================
-- Aurum Supply House · 0300 · M6-prerequisite: Manufacturer cost RLS (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Manufacturer costs are Owner/Admin ONLY at the database layer. Every new table
-- is default-deny with a single admin-only policy — a Sales Rep hitting any of
-- them (directly, via a join, or via the security_invoker views in 0290) gets
-- ZERO rows and never receives a cost field. Mirrors 0120/0150.
--
-- Import files continue to use the private, admin-only `imports` storage bucket
-- (0090) — no new bucket or storage policy is required.
-- ============================================================================

alter table public.manufacturer_products             enable row level security;
alter table public.manufacturer_cost_history         enable row level security;
alter table public.manufacturer_cost_import_batches  enable row level security;
alter table public.manufacturer_cost_import_rows     enable row level security;

-- ---- manufacturer_products : admin-only (relationship terms editable direct) -
drop policy if exists manufacturer_products_all on public.manufacturer_products;
create policy manufacturer_products_all on public.manufacturer_products for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- manufacturer_cost_history : admin-only. Writes flow through SECURITY
--       DEFINER RPCs; the append-only trigger (0270) still guards every change.
drop policy if exists manufacturer_cost_history_all on public.manufacturer_cost_history;
create policy manufacturer_cost_history_all on public.manufacturer_cost_history for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- import batches + rows : admin-only -------------------------------------
drop policy if exists manufacturer_cost_import_batches_all on public.manufacturer_cost_import_batches;
create policy manufacturer_cost_import_batches_all on public.manufacturer_cost_import_batches for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists manufacturer_cost_import_rows_all on public.manufacturer_cost_import_rows;
create policy manufacturer_cost_import_rows_all on public.manufacturer_cost_import_rows for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- Table privileges: reachable by `authenticated` (RLS is the real gate),
--       never by `anon`. RLS above restricts every row to admins.
revoke all on public.manufacturer_products            from anon;
revoke all on public.manufacturer_cost_history        from anon;
revoke all on public.manufacturer_cost_import_batches from anon;
revoke all on public.manufacturer_cost_import_rows    from anon;

grant select, insert, update, delete on public.manufacturer_products            to authenticated;
grant select, insert, update, delete on public.manufacturer_cost_import_batches to authenticated;
grant select, insert, update, delete on public.manufacturer_cost_import_rows    to authenticated;
-- Cost history: readable by admins; all writes go through append-only RPCs.
grant select on public.manufacturer_cost_history to authenticated;
