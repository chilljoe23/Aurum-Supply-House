-- ============================================================================
-- Aurum Supply House · 0397 · Fulfillment · RPCs (ADDITIVE)
-- ----------------------------------------------------------------------------
-- All writes go through SECURITY DEFINER functions in schema app, reached only
-- via thin public wrappers that bind auth.uid(). Every function is Owner/Admin
-- gated (app.is_admin()), row-locks the order, validates deterministically, and
-- records an activity_log entry. Nothing here can touch an invoice's financial
-- columns — the mutations are confined to the new fulfillment tables.
--
-- Grant convention (mirrors 0394): public wrappers are revoked from public/anon
-- and granted to authenticated (body still enforces the role gate); the app.*
-- functions are revoked from everyone (reachable only through the wrapper).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Access helper — can the caller reach this shipment? (definer; bypasses
--     base-table RLS to resolve the parent invoice, then defers to the existing
--     app.can_access_invoice book-scope check.)
-- ---------------------------------------------------------------------------
create or replace function app.can_access_shipment(p_shipment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.order_shipments s
    where s.id = p_shipment and app.can_access_invoice(s.invoice_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 1 · Set a line's operational fulfillment status.
--     Only the manually-settable states are accepted (the enum guarantees this).
--     Cancelling is refused once anything has shipped on the line — that requires
--     an explicit reversal (void the shipment first), per the business rules.
-- ---------------------------------------------------------------------------
create or replace function app.set_line_fulfillment_status(
  p_item uuid, p_status fulfillment_op_status, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_item     record;
  v_shipped  numeric(14,4);
  v_prev     fulfillment_op_status;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may change fulfillment status.' using errcode = '42501';
  end if;

  select ii.id, ii.invoice_id, ii.sku, ii.quantity, inv.status as invoice_status, inv.invoice_number
    into v_item
    from public.invoice_items ii
    join public.invoices inv on inv.id = ii.invoice_id
   where ii.id = p_item
   for update of inv;
  if v_item.id is null then
    raise exception 'Order line not found.';
  end if;
  if not app.can_access_invoice(v_item.invoice_id) then
    raise exception 'You do not have access to this order.' using errcode = '42501';
  end if;

  -- Finalized shipped quantity on this line (voided shipments excluded).
  select coalesce(sum(si.quantity_shipped), 0) into v_shipped
    from public.order_shipment_items si
    join public.order_shipments sh on sh.id = si.shipment_id
   where si.invoice_item_id = p_item and sh.status = 'finalized';

  if p_status = 'cancelled' and v_shipped > 0 then
    raise exception 'Line % has shipped quantity and cannot be cancelled. Void its shipment(s) first.',
      v_item.sku;
  end if;

  select operational_status into v_prev
    from public.order_line_fulfillment where invoice_item_id = p_item;

  insert into public.order_line_fulfillment (invoice_item_id, invoice_id, operational_status, updated_by)
  values (p_item, v_item.invoice_id, p_status, p_actor)
  on conflict (invoice_item_id)
    do update set operational_status = excluded.operational_status,
                  updated_by = excluded.updated_by,
                  updated_at = now();

  perform app.record_activity(
    'invoice', v_item.invoice_id, 'line_status_changed',
    'Fulfillment status for ' || v_item.sku || ' set to ' || p_status::text,
    jsonb_build_object(
      'invoice_item_id', p_item,
      'sku',             v_item.sku,
      'from_status',     coalesce(v_prev::text, 'not_yet_shipped'),
      'to_status',       p_status::text
    ));

  return jsonb_build_object('invoice_item_id', p_item, 'operational_status', p_status::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 · Create a shipment atomically.
--     p_lines is a jsonb array of objects:
--       { "invoice_item_id": uuid, "quantity": number,
--         "lot_number"?: text, "manufacturing_date"?: date,
--         "expiration_date"?: date, "retest_date"?: date }
--     Lot/date fields, when omitted, snapshot from the invoice line's currently
--     assigned lot. Nothing here mutates invoice_items — lot ASSIGNMENT stays in
--     the existing guarded app.assign_invoice_lot workflow; this only SNAPSHOTS.
-- ---------------------------------------------------------------------------
create or replace function app.create_shipment(
  p_invoice          uuid,
  p_shipment_date    date,
  p_carrier          text,
  p_service          text,
  p_tracking_number  text,
  p_tracking_url     text,
  p_notes            text,
  p_lines            jsonb,
  p_actor            uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv        record;
  v_num        text;
  v_ship       uuid;
  v_line       jsonb;
  v_item       record;
  v_qty        numeric(14,4);
  v_already    numeric(14,4);
  v_op         fulfillment_op_status;
  v_lot        text;
  v_mfg        date;
  v_exp        date;
  v_retest     date;
  v_count      int := 0;
  v_totalqty   numeric(14,4) := 0;
  v_hastrack   boolean := false;
  v_lots       text[] := array[]::text[];
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may create shipments.' using errcode = '42501';
  end if;

  -- Row-lock the order so two concurrent shipment requests are serialized and
  -- cannot both pass the remaining-quantity check (no over-ship race).
  select * into v_inv from public.invoices where id = p_invoice for update;
  if v_inv.id is null then
    raise exception 'Order not found.';
  end if;
  if not app.can_access_invoice(p_invoice) then
    raise exception 'You do not have access to this order.' using errcode = '42501';
  end if;

  -- Eligible only once issued: sent (Issued) / partial / paid. Never draft/void.
  -- A paid order is NOT automatically shipped; shipping is an independent axis.
  if v_inv.status not in ('sent','partial','paid') then
    raise exception 'Only issued, partially-paid, or paid orders can ship (status %).', v_inv.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A shipment needs at least one line with a quantity.';
  end if;

  v_num := app.next_shipment_number();

  insert into public.order_shipments (
    invoice_id, shipment_number, shipment_date, carrier, service,
    tracking_number, tracking_url, notes, status, created_by)
  values (
    p_invoice, v_num, coalesce(p_shipment_date, current_date),
    nullif(btrim(coalesce(p_carrier,'')), ''),
    nullif(btrim(coalesce(p_service,'')), ''),
    nullif(btrim(coalesce(p_tracking_number,'')), ''),
    nullif(btrim(coalesce(p_tracking_url,'')), ''),
    nullif(btrim(coalesce(p_notes,'')), ''),
    'finalized', p_actor)
  returning id into v_ship;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- Quantity: strictly positive; zero/negative rejected here.
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each shipped quantity must be greater than zero.';
    end if;

    select ii.id, ii.invoice_id, ii.sku, ii.product_name, ii.quantity,
           ii.lot_number, ii.manufacturing_date, ii.expiration_date, ii.retest_date
      into v_item
      from public.invoice_items ii
     where ii.id = (v_line->>'invoice_item_id')::uuid;
    if v_item.id is null or v_item.invoice_id <> p_invoice then
      raise exception 'Shipment line does not belong to this order.';
    end if;

    -- Cancelled lines may not ship without an explicit reversal.
    select operational_status into v_op
      from public.order_line_fulfillment where invoice_item_id = v_item.id;
    if v_op = 'cancelled' then
      raise exception 'Line % is cancelled and cannot be shipped.', v_item.sku;
    end if;

    -- Already-shipped (finalized) for this line, then enforce no over-ship.
    select coalesce(sum(si.quantity_shipped), 0) into v_already
      from public.order_shipment_items si
      join public.order_shipments sh on sh.id = si.shipment_id
     where si.invoice_item_id = v_item.id and sh.status = 'finalized';

    if v_already + v_qty > v_item.quantity then
      raise exception 'Cannot ship % of %; only % remaining (ordered %, already shipped %).',
        v_qty, v_item.sku, (v_item.quantity - v_already), v_item.quantity, v_already;
    end if;

    -- Lot/date snapshot: explicit values win, else fall back to the line's lot.
    v_lot    := coalesce(nullif(btrim(coalesce(v_line->>'lot_number','')), ''), v_item.lot_number);
    v_mfg    := coalesce((v_line->>'manufacturing_date')::date, v_item.manufacturing_date);
    v_exp    := coalesce((v_line->>'expiration_date')::date,    v_item.expiration_date);
    v_retest := coalesce((v_line->>'retest_date')::date,        v_item.retest_date);

    insert into public.order_shipment_items (
      shipment_id, invoice_id, invoice_item_id, sku, product_name,
      quantity_shipped, lot_number, manufacturing_date, expiration_date, retest_date)
    values (
      v_ship, p_invoice, v_item.id, v_item.sku, v_item.product_name,
      v_qty, v_lot, v_mfg, v_exp, v_retest);

    v_count    := v_count + 1;
    v_totalqty := v_totalqty + v_qty;
    if v_lot is not null then v_lots := v_lots || v_lot; end if;
  end loop;

  if nullif(btrim(coalesce(p_tracking_number,'')), '') is not null then
    v_hastrack := true;
  end if;

  -- Audit trail — created, tracking, lots, finalized (non-sensitive metadata only).
  perform app.record_activity(
    'invoice', p_invoice, 'shipment_created',
    'Shipment ' || v_num || ' created (' || v_count || ' line(s))',
    jsonb_build_object(
      'shipment_id', v_ship, 'shipment_number', v_num,
      'shipment_date', coalesce(p_shipment_date, current_date),
      'carrier', nullif(btrim(coalesce(p_carrier,'')), ''),
      'service', nullif(btrim(coalesce(p_service,'')), ''),
      'line_count', v_count, 'total_quantity', v_totalqty));

  if v_hastrack then
    perform app.record_activity(
      'invoice', p_invoice, 'shipment_tracking_added',
      'Tracking added to shipment ' || v_num,
      jsonb_build_object('shipment_id', v_ship, 'shipment_number', v_num,
        'tracking_number', nullif(btrim(coalesce(p_tracking_number,'')), '')));
  end if;

  if array_length(v_lots, 1) is not null then
    perform app.record_activity(
      'invoice', p_invoice, 'shipment_lot_included',
      'Lot(s) recorded on shipment ' || v_num,
      jsonb_build_object('shipment_id', v_ship, 'shipment_number', v_num,
        'lot_numbers', to_jsonb(v_lots)));
  end if;

  perform app.record_activity(
    'invoice', p_invoice, 'shipment_finalized',
    'Shipment ' || v_num || ' finalized',
    jsonb_build_object('shipment_id', v_ship, 'shipment_number', v_num));

  return jsonb_build_object('shipment_id', v_ship, 'shipment_number', v_num,
    'line_count', v_count, 'total_quantity', v_totalqty);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3 · Void a shipment (audited correction; append-only preserved).
--     The row is never deleted; status flips to 'void' so its quantities stop
--     counting toward quantity_shipped, restoring the remaining balance.
-- ---------------------------------------------------------------------------
create or replace function app.void_shipment(p_shipment uuid, p_reason text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sh      record;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may void shipments.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A void reason is required.';
  end if;

  select s.*, i.id as inv_id into v_sh
    from public.order_shipments s
    join public.invoices i on i.id = s.invoice_id
   where s.id = p_shipment
   for update of s;
  if v_sh.id is null then
    raise exception 'Shipment not found.';
  end if;
  if not app.can_access_invoice(v_sh.invoice_id) then
    raise exception 'You do not have access to this order.' using errcode = '42501';
  end if;
  if v_sh.status <> 'finalized' then
    raise exception 'Shipment % is already %.', v_sh.shipment_number, v_sh.status;
  end if;

  perform set_config('app.allow_shipment_void', 'on', true);
  update public.order_shipments
     set status = 'void', voided_reason = v_reason, updated_at = now()
   where id = p_shipment;
  perform set_config('app.allow_shipment_void', 'off', true);

  perform app.record_activity(
    'invoice', v_sh.invoice_id, 'shipment_voided',
    'Shipment ' || v_sh.shipment_number || ' voided',
    jsonb_build_object('shipment_id', p_shipment, 'shipment_number', v_sh.shipment_number,
      'reason', v_reason));

  return jsonb_build_object('shipment_id', p_shipment, 'shipment_number', v_sh.shipment_number, 'status', 'void');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4 · Thin public wrappers (bind the caller's identity) + grants.
-- ---------------------------------------------------------------------------
create or replace function public.set_line_fulfillment_status(p_item uuid, p_status fulfillment_op_status)
returns jsonb language sql security definer set search_path = public as $$
  select app.set_line_fulfillment_status(p_item, p_status, auth.uid());
$$;

create or replace function public.create_shipment(
  p_invoice uuid, p_shipment_date date, p_carrier text, p_service text,
  p_tracking_number text, p_tracking_url text, p_notes text, p_lines jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select app.create_shipment(p_invoice, p_shipment_date, p_carrier, p_service,
    p_tracking_number, p_tracking_url, p_notes, p_lines, auth.uid());
$$;

create or replace function public.void_shipment(p_shipment uuid, p_reason text)
returns jsonb language sql security definer set search_path = public as $$
  select app.void_shipment(p_shipment, p_reason, auth.uid());
$$;

revoke all on function public.set_line_fulfillment_status(uuid, fulfillment_op_status) from public, anon;
revoke all on function public.create_shipment(uuid, date, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.void_shipment(uuid, text) from public, anon;
grant execute on function public.set_line_fulfillment_status(uuid, fulfillment_op_status) to authenticated;
grant execute on function public.create_shipment(uuid, date, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.void_shipment(uuid, text) to authenticated;

revoke all on function app.set_line_fulfillment_status(uuid, fulfillment_op_status, uuid) from public, anon, authenticated;
revoke all on function app.create_shipment(uuid, date, text, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function app.void_shipment(uuid, text, uuid) from public, anon, authenticated;
