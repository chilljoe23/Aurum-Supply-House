-- ============================================================================
-- Aurum Supply House · 0120 · M1 RLS: true-cost hiding + import access (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Reps may read the ACTIVE catalog but must never see true cost or cost history.
-- Postgres RLS can hide rows but not columns, and all app users share the
-- `authenticated` DB role — so column hiding is enforced with a security-barrier
-- VIEW that masks true_cost for non-admins, while the base products/cost tables
-- are locked to admins only. A rep hitting the base table gets zero rows; the
-- view is their only catalog surface and it emits NULL cost.
-- ============================================================================

-- ---- products: base table readable by admins only (reps use the view) -------
drop policy if exists products_read on public.products;
create policy products_read on public.products for select
  using (app.is_admin());
-- products_write (admin all) from 0080 remains.

-- ---- product_cost_history: admin-only read (was staff read in M0) -----------
drop policy if exists product_cost_history_read on public.product_cost_history;
create policy product_cost_history_read on public.product_cost_history for select
  using (app.is_admin());
-- product_cost_history_write (admin all) from 0080 remains; inserts also flow
-- through SECURITY DEFINER RPCs.

-- ---- import batches + rows: admin only --------------------------------------
drop policy if exists catalog_import_batches_read  on public.catalog_import_batches;
drop policy if exists catalog_import_batches_write on public.catalog_import_batches;
create policy catalog_import_batches_all on public.catalog_import_batches for all
  using (app.is_admin()) with check (app.is_admin());

alter table public.catalog_import_rows enable row level security;
drop policy if exists catalog_import_rows_all on public.catalog_import_rows;
create policy catalog_import_rows_all on public.catalog_import_rows for all
  using (app.is_admin()) with check (app.is_admin());

-- ----------------------------------------------------------------------------
-- catalog_products : the catalog read surface for the whole app.
-- Security-barrier, runs as owner (bypasses base RLS) and applies its OWN
-- gate: staff-only; reps see active products only; true_cost is NULL unless
-- the caller is an admin. This is where column-level cost hiding is enforced.
-- ----------------------------------------------------------------------------
create or replace view public.catalog_products
  with (security_invoker = false, security_barrier = true)
as
select
  p.id,
  p.sku,
  p.name,
  p.description,
  p.strength,
  p.product_form,
  p.pack_size,
  p.unit_of_measure,
  p.manufacturer_id,
  m.name              as manufacturer_name,
  p.manufacturer_sku,
  p.category,
  p.moq,
  p.lead_time_days,
  p.currency,
  p.status,
  p.notes,
  p.created_at,
  p.updated_at,
  case when app.is_admin() then p.current_true_cost else null end as true_cost,
  app.is_admin() as can_see_cost
from public.products p
left join public.manufacturers m on m.id = p.manufacturer_id
where app.is_staff()
  and (app.is_admin() or p.status = 'active');

revoke all on public.catalog_products from anon;
grant select on public.catalog_products to authenticated;

comment on view public.catalog_products is
  'Catalog read surface. Masks true_cost for non-admins; reps see active products only.';
