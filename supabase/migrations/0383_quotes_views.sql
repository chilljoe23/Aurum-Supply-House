-- ============================================================================
-- Aurum Supply House · 0383 · Quotes · Staff read surfaces (ADDITIVE)
-- ----------------------------------------------------------------------------
-- The staff read surface for quotes. Row-scoped like v_orders (0210): admins see
-- all; reps see only quotes they own or for clients in their book. There is NO
-- cost/profit column to mask — a quote never stores any — so these views expose
-- only customer-facing money plus the internal price-resolution provenance
-- (price_source / manual_reason), which is intentionally shown to staff but never
-- placed on the customer document (that comes from the separate quote view model).
-- ============================================================================

-- ---- v_quotes : list + detail header, with a computed expiry flag + order link
create or replace view public.v_quotes
  with (security_invoker = false, security_barrier = true)
as
select
  q.id,
  q.quote_number,
  q.status,
  -- Deterministic "is this sent quote past its expiration date right now?" flag.
  (q.status = 'sent' and q.expiration_date is not null and q.expiration_date < current_date) as is_expired,
  q.client_id,
  coalesce(q.client_snapshot->>'company_name', c.company_name) as company_name,
  q.client_snapshot,   -- customer's own data (name/addresses/terms) for the document
  q.sales_rep_id,
  q.sales_rep_name,
  q.pricing_sheet_id,
  q.pricing_sheet_name,
  q.currency,
  q.subtotal,
  q.discount,
  q.shipping,
  q.fees,
  q.tax_rate,
  q.tax_amount,
  q.total,
  q.payment_terms,
  q.customer_reference,
  q.quote_date,
  q.expiration_date,
  q.notes,
  q.sent_at,
  q.accepted_at,
  q.declined_at,
  q.expired_at,
  q.voided_at,
  q.converted_at,
  q.converted_order_id,
  inv.invoice_number as converted_order_number,
  q.created_at,
  q.updated_at,
  (select count(*) from public.quote_items i where i.quote_id = q.id) as line_count
from public.quotes q
left join public.clients c  on c.id = q.client_id
left join public.invoices inv on inv.id = q.converted_order_id
where app.is_staff()
  and ( app.is_admin()
     or q.sales_rep_id = auth.uid()
     or q.client_id in (select app.rep_client_ids()) );

revoke all on public.v_quotes from anon;
grant select on public.v_quotes to authenticated;
comment on view public.v_quotes is
  'Staff quote surface. Row-scoped (admins all, reps own book). No cost/profit columns exist on a quote.';

-- ---- v_quote_items : line snapshot with a composed description ---------------
create or replace view public.v_quote_items
  with (security_invoker = false, security_barrier = true)
as
select
  i.id,
  i.quote_id,
  i.product_id,
  i.sku,
  i.product_name,
  i.strength,
  i.pack_size,
  i.manufacturer_name,
  concat_ws(' · ', i.product_name, nullif(i.strength,''), nullif(i.pack_size,'')) as description,
  i.currency,
  i.quantity,
  i.unit_price,
  app.money_round(i.quantity * i.unit_price, 4) as line_subtotal,
  i.price_source,
  i.price_source_sheet,
  i.price_overridden,
  i.original_unit_price,
  i.manual_reason,
  i.created_at
from public.quote_items i
where app.can_access_quote(i.quote_id);

revoke all on public.v_quote_items from anon;
grant select on public.v_quote_items to authenticated;
comment on view public.v_quote_items is
  'Staff quote line-item surface. Exposes selling price + resolution provenance; no cost exists to mask.';
