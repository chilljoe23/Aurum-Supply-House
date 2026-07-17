-- ============================================================================
-- Aurum Supply House · 0398 · Fulfillment · Views (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Read surfaces for the app. Each is row-scoped exactly like v_orders /
-- v_order_items (security_invoker = false, security_barrier = true, filtered by
-- app.can_access_invoice) and exposes NO cost / profit / margin / commission
-- column — fulfillment is a customer-operational surface, safe for any staff who
-- can see the order. quantity_shipped is DERIVED from finalized shipment items.
--
-- Exact derivation rules (single source of truth):
--   Per line (quantity-authoritative):
--     quantity_shipped = Σ finalized order_shipment_items.quantity_shipped
--     quantity_remaining = quantity_ordered − quantity_shipped   (never negative)
--     fulfillment_status =
--       shipped == 0            → operational_status
--                                 (not_yet_shipped|in_production|ready_to_ship|
--                                  backordered|cancelled)
--       0 < shipped < ordered   → partially_shipped
--       shipped == ordered      → shipped
--   Per order (kept separate from payment/invoice status):
--     cancelled        → every line is cancelled
--     fully_shipped    → every non-cancelled line is shipped
--     partially_shipped→ something has shipped and shippable qty still remains
--     in_progress      → nothing shipped yet, but a line is in production /
--                        ready / backordered (or partially shipped)
--     not_started      → nothing shipped and no line in production/ready
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Per-line fulfillment surface.
-- ---------------------------------------------------------------------------
drop view if exists public.v_order_fulfillment_lines;
create view public.v_order_fulfillment_lines
  with (security_invoker = false, security_barrier = true)
as
select
  ii.id                                                   as invoice_item_id,
  ii.invoice_id,
  ii.sku,
  ii.product_name,
  ii.strength,
  ii.pack_size,
  ii.quantity                                             as quantity_ordered,
  coalesce(s.qty_shipped, 0)                              as quantity_shipped,
  ii.quantity - coalesce(s.qty_shipped, 0)                as quantity_remaining,
  coalesce(f.operational_status, 'not_yet_shipped'::fulfillment_op_status)
                                                          as operational_status,
  case
    when coalesce(s.qty_shipped, 0) <= 0
      then coalesce(f.operational_status, 'not_yet_shipped'::fulfillment_op_status)::text
    when coalesce(s.qty_shipped, 0) >= ii.quantity
      then 'shipped'
    else 'partially_shipped'
  end                                                     as fulfillment_status,
  ii.lot_number,
  ii.manufacturing_date,
  ii.expiration_date,
  ii.retest_date,
  s.latest_shipment_date,
  s.latest_tracking_number,
  ii.created_at
from public.invoice_items ii
left join public.order_line_fulfillment f on f.invoice_item_id = ii.id
left join (
  select
    si.invoice_item_id,
    sum(si.quantity_shipped)                                            as qty_shipped,
    max(sh.shipment_date)                                              as latest_shipment_date,
    (array_agg(sh.tracking_number order by sh.shipment_date desc nulls last)
       filter (where sh.tracking_number is not null))[1]              as latest_tracking_number
  from public.order_shipment_items si
  join public.order_shipments sh on sh.id = si.shipment_id
  where sh.status = 'finalized'
  group by si.invoice_item_id
) s on s.invoice_item_id = ii.id
where app.can_access_invoice(ii.invoice_id);

revoke all on public.v_order_fulfillment_lines from anon;
grant select on public.v_order_fulfillment_lines to authenticated;
comment on view public.v_order_fulfillment_lines is
  'Per-line fulfillment: ordered/shipped/remaining + derived status. Row-scoped; no cost/profit columns.';

-- ---------------------------------------------------------------------------
-- 2 · Per-order fulfillment summary (derived; separate from payment status).
-- ---------------------------------------------------------------------------
drop view if exists public.v_order_fulfillment_summary;
create view public.v_order_fulfillment_summary
  with (security_invoker = false, security_barrier = true)
as
select
  agg.invoice_id,
  agg.line_count,
  agg.total_ordered,
  agg.total_shipped,
  agg.shippable_remaining,
  agg.shipment_count,
  case
    when agg.line_count = 0 then 'not_started'
    when agg.cancelled_lines = agg.line_count then 'cancelled'
    when agg.shipped_lines = agg.line_count - agg.cancelled_lines then 'fully_shipped'
    when agg.total_shipped > 0 and agg.shippable_remaining > 0 then 'partially_shipped'
    when agg.partially_lines > 0 or agg.active_lines > 0 then 'in_progress'
    else 'not_started'
  end as fulfillment_status
from (
  select
    l.invoice_id,
    count(*)                                                                as line_count,
    coalesce(sum(l.quantity_ordered), 0)                                   as total_ordered,
    coalesce(sum(l.quantity_shipped), 0)                                   as total_shipped,
    coalesce(sum(case when l.operational_status = 'cancelled' then 0
                      else l.quantity_remaining end), 0)                   as shippable_remaining,
    count(*) filter (where l.fulfillment_status = 'cancelled')             as cancelled_lines,
    count(*) filter (where l.fulfillment_status = 'shipped')               as shipped_lines,
    count(*) filter (where l.fulfillment_status = 'partially_shipped')     as partially_lines,
    count(*) filter (where l.fulfillment_status
                       in ('in_production','ready_to_ship','backordered')) as active_lines,
    (select count(*) from public.order_shipments sh
      where sh.invoice_id = l.invoice_id and sh.status = 'finalized')      as shipment_count
  from public.v_order_fulfillment_lines l
  group by l.invoice_id
) agg;

revoke all on public.v_order_fulfillment_summary from anon;
grant select on public.v_order_fulfillment_summary to authenticated;
comment on view public.v_order_fulfillment_summary is
  'Per-order derived fulfillment status + totals. Independent of financial invoice_status. Row-scoped.';

-- ---------------------------------------------------------------------------
-- 3 · Shipment header surface.
-- ---------------------------------------------------------------------------
drop view if exists public.v_order_shipments;
create view public.v_order_shipments
  with (security_invoker = false, security_barrier = true)
as
select
  sh.id,
  sh.invoice_id,
  i.invoice_number,
  sh.shipment_number,
  sh.shipment_date,
  sh.carrier,
  sh.service,
  sh.tracking_number,
  sh.tracking_url,
  sh.notes,
  sh.status,
  sh.voided_reason,
  sh.created_by,
  p.full_name                                             as created_by_name,
  sh.created_at,
  (select count(*) from public.order_shipment_items si where si.shipment_id = sh.id)               as item_count,
  (select coalesce(sum(si.quantity_shipped), 0) from public.order_shipment_items si
     where si.shipment_id = sh.id)                                                                   as total_quantity
from public.order_shipments sh
join public.invoices i on i.id = sh.invoice_id
left join public.profiles p on p.id = sh.created_by
where app.can_access_invoice(sh.invoice_id);

revoke all on public.v_order_shipments from anon;
grant select on public.v_order_shipments to authenticated;
comment on view public.v_order_shipments is
  'Shipment header history per order. Row-scoped; no financial columns.';

-- ---------------------------------------------------------------------------
-- 4 · Shipment line-item surface (lot/date snapshots; never any pricing).
-- ---------------------------------------------------------------------------
drop view if exists public.v_order_shipment_items;
create view public.v_order_shipment_items
  with (security_invoker = false, security_barrier = true)
as
select
  si.id,
  si.shipment_id,
  si.invoice_id,
  si.invoice_item_id,
  si.sku,
  si.product_name,
  si.quantity_shipped,
  si.lot_number,
  si.manufacturing_date,
  si.expiration_date,
  si.retest_date,
  si.created_at
from public.order_shipment_items si
where app.can_access_invoice(si.invoice_id);

revoke all on public.v_order_shipment_items from anon;
grant select on public.v_order_shipment_items to authenticated;
comment on view public.v_order_shipment_items is
  'Per-shipment line quantities with lot/date snapshots. Row-scoped; never carries price or cost.';
