-- ============================================================================
-- Aurum Supply House · 0340 · M6 · Purchase-order views (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Purchasing is Owner/Admin-only, so every view is security_invoker = true and
-- inherits the admin-only base-table RLS (0350). A Sales Rep querying any of them
-- — directly, via a join, or via a document route — gets ZERO rows and never a
-- cost column. (Same inheritance idiom as pricing_item_margins, 0150 / 0290.)
-- ============================================================================

-- ---- v_purchase_orders : list + detail header, with manufacturer + rollups ---
create or replace view public.v_purchase_orders
  with (security_invoker = true) as
select
  po.id,
  po.po_number,
  po.manufacturer_id,
  m.name                       as manufacturer_name,
  m.status                     as manufacturer_status,
  po.status,
  po.currency,
  po.subtotal,
  po.shipping,
  po.fees,
  po.tax,
  po.total,
  po.deposit_amount,
  po.amount_paid,
  po.balance_due,
  po.payment_terms,
  po.expected_date,
  po.notes,
  po.sent_at,
  po.confirmed_at,
  po.received_at,
  po.created_by,
  po.created_at,
  po.updated_at,
  (select count(*)        from public.purchase_order_items i where i.purchase_order_id = po.id) as line_count,
  (select sum(i.quantity) from public.purchase_order_items i where i.purchase_order_id = po.id) as total_quantity,
  (select string_agg(distinct s.tracking_number, ', ')
     from public.purchase_order_shipments s
    where s.purchase_order_id = po.id and s.tracking_number is not null)                        as tracking_numbers,
  (select min(s.expected_arrival_date)
     from public.purchase_order_shipments s where s.purchase_order_id = po.id)                  as next_expected_arrival
from public.purchase_orders po
left join public.manufacturers m on m.id = po.manufacturer_id;

revoke all on public.v_purchase_orders from anon;
grant select on public.v_purchase_orders to authenticated;

comment on view public.v_purchase_orders is
  'Owner/Admin purchase-order list + header. security_invoker inherits admin-only base RLS; reps get zero rows.';

-- ---- v_purchase_order_items : line snapshot with a composed description -------
create or replace view public.v_purchase_order_items
  with (security_invoker = true) as
select
  i.id,
  i.purchase_order_id,
  i.product_id,
  i.sku,
  i.name                       as product_name,
  i.strength,
  i.pack_size,
  concat_ws(' · ', i.name, nullif(i.strength,''), nullif(i.pack_size,'')) as description,
  i.manufacturer_id,
  i.manufacturer_product_id,
  i.manufacturer_cost_history_id,
  i.manufacturer_sku,
  i.manufacturer_description,
  i.currency,
  i.quantity,
  i.unit_cost,
  i.line_total,
  i.resolved_cost_source,
  i.resolved_tier_min,
  i.resolved_tier_max,
  i.moq,
  i.order_multiple,
  i.lead_time_days,
  i.cost_reason,
  i.received_cost_logged,
  i.notes,
  i.created_by,
  i.created_at,
  coalesce((select sum(r.quantity_received) from public.purchase_order_receipts r
             where r.purchase_order_item_id = i.id), 0) as quantity_received
from public.purchase_order_items i;

revoke all on public.v_purchase_order_items from anon;
grant select on public.v_purchase_order_items to authenticated;

-- ---- v_manufacturer_payments : PO payment ledger -----------------------------
create or replace view public.v_manufacturer_payments
  with (security_invoker = true) as
select
  mp.id,
  mp.purchase_order_id,
  po.po_number,
  po.manufacturer_id,
  m.name          as manufacturer_name,
  mp.type,
  mp.amount,
  (case when mp.type = 'refund_credit' then -mp.amount else mp.amount end) as signed_amount,
  mp.payment_date,
  mp.method,
  mp.reference,
  mp.notes,
  mp.created_by,
  mp.created_at
from public.manufacturer_payments mp
join public.purchase_orders po on po.id = mp.purchase_order_id
left join public.manufacturers m on m.id = po.manufacturer_id;

revoke all on public.v_manufacturer_payments from anon;
grant select on public.v_manufacturer_payments to authenticated;

comment on view public.v_manufacturer_payments is
  'Owner/Admin manufacturer payment ledger. Admin-only via inherited base RLS.';
