-- ============================================================================
-- Aurum Supply House · 0290 · M6-prerequisite: Manufacturer cost views (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Owner/Admin cost surfaces. Both are security_invoker=true so they inherit the
-- admin-only RLS on manufacturer_products / manufacturer_cost_history / products
-- (0300) — a Sales Rep querying either view gets ZERO rows and never sees a cost
-- column through any join. (Same idiom as pricing_item_margins, 0150.)
-- ============================================================================

-- ---- manufacturer_product_costs : one row per supply relationship -----------
-- Current base cost + terms + preferred flag + tier count + last file update.
create or replace view public.manufacturer_product_costs
  with (security_invoker = true) as
select
  mp.id                        as manufacturer_product_id,
  mp.manufacturer_id,
  m.name                       as manufacturer_name,
  m.status                     as manufacturer_status,
  mp.product_id,
  p.sku,
  p.name                       as product_name,
  p.status                     as product_status,
  mp.manufacturer_sku,
  mp.manufacturer_description,
  mp.current_unit_cost,
  base.unit_cost               as base_unit_cost,
  mp.currency,
  mp.moq,
  mp.order_multiple,
  mp.lead_time_days,
  mp.active,
  (p.preferred_manufacturer_id = mp.manufacturer_id) as is_preferred,
  base.effective_date          as cost_effective_date,
  base.expiration_date         as cost_expiration_date,
  (select count(*) from public.manufacturer_cost_history h
     where h.manufacturer_product_id = mp.id and h.effective_to is null and h.active) as active_band_count,
  (select max(h.created_at) from public.manufacturer_cost_history h
     where h.manufacturer_product_id = mp.id) as last_cost_update,
  mp.notes,
  mp.created_at,
  mp.updated_at
from public.manufacturer_products mp
join public.manufacturers m on m.id = mp.manufacturer_id
join public.products p on p.id = mp.product_id
left join lateral (
  select unit_cost, effective_date, expiration_date
  from public.manufacturer_cost_history h
  where h.manufacturer_product_id = mp.id and h.min_quantity = 1
    and h.effective_to is null and h.active
  order by h.effective_date desc, h.created_at desc
  limit 1
) base on true;

revoke all on public.manufacturer_product_costs from anon;
grant select on public.manufacturer_product_costs to authenticated;

comment on view public.manufacturer_product_costs is
  'Owner/Admin manufacturer-cost surface. security_invoker inherits admin-only base RLS; reps get zero rows.';

-- ---- manufacturer_cost_bands : current (open, active) quantity tiers ---------
create or replace view public.manufacturer_cost_bands
  with (security_invoker = true) as
select
  h.id,
  h.manufacturer_product_id,
  mp.manufacturer_id,
  mp.product_id,
  p.sku,
  p.name                       as product_name,
  h.min_quantity,
  h.max_quantity,
  h.unit_cost,
  h.currency,
  h.effective_date,
  h.expiration_date,
  h.previous_cost,
  h.source,
  h.reason,
  h.created_at
from public.manufacturer_cost_history h
join public.manufacturer_products mp on mp.id = h.manufacturer_product_id
join public.products p on p.id = mp.product_id
where h.effective_to is null and h.active;

revoke all on public.manufacturer_cost_bands from anon;
grant select on public.manufacturer_cost_bands to authenticated;

comment on view public.manufacturer_cost_bands is
  'Owner/Admin view of current (open) manufacturer quantity-cost tiers. Admin-only via inherited RLS.';
