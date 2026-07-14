-- ============================================================================
-- Aurum Supply House · 0150 · M2 pricing RLS + margin masking (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Reps may read ACTIVE model selling prices but never cost or margin. Cost/margin
-- is exposed only through a security-invoker view that inherits the admin-only
-- RLS on products — so a rep querying it gets zero rows.
-- ============================================================================

-- ---- pricing_sheets: reps see active models only ---------------------------
drop policy if exists pricing_sheets_read on public.pricing_sheets;
create policy pricing_sheets_read on public.pricing_sheets for select
  using (app.is_admin() or (app.is_staff() and status = 'active'));

-- ---- pricing_sheet_items: reps see active bands only; admins all ------------
drop policy if exists pricing_sheet_items_read on public.pricing_sheet_items;
create policy pricing_sheet_items_read on public.pricing_sheet_items for select
  using (app.is_admin() or (app.is_staff() and active));

-- ---- pricing import: admin only --------------------------------------------
drop policy if exists pricing_import_batches_read  on public.pricing_import_batches;
drop policy if exists pricing_import_batches_write on public.pricing_import_batches;
create policy pricing_import_batches_all on public.pricing_import_batches for all
  using (app.is_admin()) with check (app.is_admin());

alter table public.pricing_import_rows enable row level security;
drop policy if exists pricing_import_rows_all on public.pricing_import_rows;
create policy pricing_import_rows_all on public.pricing_import_rows for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- client_pricing_assignments: admin all; rep reads own clients ----------
alter table public.client_pricing_assignments enable row level security;
drop policy if exists cpa_admin_all on public.client_pricing_assignments;
create policy cpa_admin_all on public.client_pricing_assignments for all
  using (app.is_admin()) with check (app.is_admin());
drop policy if exists cpa_rep_read on public.client_pricing_assignments;
create policy cpa_rep_read on public.client_pricing_assignments for select
  using (app.is_staff() and client_id in (select app.rep_client_ids()));

-- ----------------------------------------------------------------------------
-- pricing_item_margins — cost/margin surface for Owner/Admin ONLY.
-- security_invoker=true → inherits products' admin-only RLS, so reps see nothing.
-- Never referenced by rep-facing queries or exports.
-- ----------------------------------------------------------------------------
create or replace view public.pricing_item_margins
  with (security_invoker = true)
as
select
  psi.id                                   as item_id,
  psi.pricing_sheet_id,
  psi.product_id,
  p.sku,
  p.name,
  p.strength,
  p.pack_size,
  psi.selling_price,
  psi.currency,
  psi.min_quantity,
  psi.max_quantity,
  psi.effective_date,
  psi.updated_at,
  p.current_true_cost                       as true_cost,
  (psi.selling_price - p.current_true_cost) as margin_amount,
  case when psi.selling_price > 0
       then round((psi.selling_price - p.current_true_cost) / psi.selling_price, 6)
       else null end                        as margin_pct,
  (psi.selling_price < p.current_true_cost) as below_cost
from public.pricing_sheet_items psi
join public.products p on p.id = psi.product_id
where psi.effective_to is null and psi.active;

revoke all on public.pricing_item_margins from anon;
grant select on public.pricing_item_margins to authenticated;

comment on view public.pricing_item_margins is
  'Owner/Admin margin surface. security_invoker inherits admin-only products RLS; reps get zero rows.';
