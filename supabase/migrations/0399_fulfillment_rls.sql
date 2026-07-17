-- ============================================================================
-- Aurum Supply House · 0399 · Fulfillment · RLS (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Locks down the three new base tables. Consistent with the sensitive-table
-- convention (0210/0350): all WRITES happen only through the SECURITY DEFINER
-- RPCs in 0397 (which enforce app.is_admin()); the API roles get NO direct
-- insert/update/delete grant. Reads are book-scoped:
--   • Owner/Admin: full access (app.is_admin()).
--   • Sales Rep:   SELECT only, scoped to their own book via app.can_access_invoice.
-- Nothing here weakens any existing policy, mask, or role protection.
-- ============================================================================

-- ---- order_line_fulfillment -------------------------------------------------
alter table public.order_line_fulfillment enable row level security;

drop policy if exists order_line_fulfillment_admin_all on public.order_line_fulfillment;
create policy order_line_fulfillment_admin_all on public.order_line_fulfillment for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists order_line_fulfillment_rep_select on public.order_line_fulfillment;
create policy order_line_fulfillment_rep_select on public.order_line_fulfillment for select
  using (app.is_staff() and app.can_access_invoice(invoice_id));

revoke all on public.order_line_fulfillment from anon;
grant select on public.order_line_fulfillment to authenticated;

-- ---- order_shipments --------------------------------------------------------
alter table public.order_shipments enable row level security;

drop policy if exists order_shipments_admin_all on public.order_shipments;
create policy order_shipments_admin_all on public.order_shipments for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists order_shipments_rep_select on public.order_shipments;
create policy order_shipments_rep_select on public.order_shipments for select
  using (app.is_staff() and app.can_access_invoice(invoice_id));

revoke all on public.order_shipments from anon;
grant select on public.order_shipments to authenticated;

-- ---- order_shipment_items ---------------------------------------------------
alter table public.order_shipment_items enable row level security;

drop policy if exists order_shipment_items_admin_all on public.order_shipment_items;
create policy order_shipment_items_admin_all on public.order_shipment_items for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists order_shipment_items_rep_select on public.order_shipment_items;
create policy order_shipment_items_rep_select on public.order_shipment_items for select
  using (app.is_staff() and app.can_access_invoice(invoice_id));

revoke all on public.order_shipment_items from anon;
grant select on public.order_shipment_items to authenticated;

-- Note: no insert/update/delete grant to authenticated on any of the three
-- tables. Every write is mediated by app.set_line_fulfillment_status /
-- app.create_shipment / app.void_shipment (Owner/Admin gated, audited), and the
-- append-only locks (0396) reject any out-of-band UPDATE/DELETE.
