-- ============================================================================
-- Aurum Supply House · 0330 · M6 · Purchase-order transactional RPCs (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Every PO mutation flows through a SECURITY DEFINER app.* function fronted by an
-- admin-checked public.* wrapper (mirrors 0200 / 0280). Purchasing is Owner/Admin
-- only, so EVERY wrapper requires app.is_admin(). Each function is one transaction:
-- any RAISE rolls the whole thing back (atomic save / send / payment / receive).
--
--   save_po_draft            create/replace a DRAFT PO; resolves each line's cost
--                            server-side via app.resolve_manufacturer_cost and
--                            snapshots the full provenance onto the line.
--   send_po                  draft → sent; allocates the PO number.
--   transition_po_status     validated forward status move (+ optional note).
--   void_po                  reason-required cancel of a pre-receipt PO.
--   record_manufacturer_payment  deposit / balance / additional / refund_credit.
--   add_po_attachment        register a private-storage document.
--   add_po_shipment          carrier / tracking / dates.
--   receive_po_line          per-line goods receipt (qty + optional lot).
--   delete_po_draft          discard a draft (never an issued PO).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app.save_po_draft — create or replace a draft PO with per-line cost snapshots.
-- Cost is ALWAYS resolved server-side from the manufacturer cost foundation; a
-- manual cost (+ reason) is permitted ONLY when the resolver cannot resolve.
-- Never returns zero, never falls back to a customer selling price.
-- ----------------------------------------------------------------------------
create or replace function app.save_po_draft(
  p_po            uuid,          -- null → create
  p_manufacturer  uuid,
  p_currency      char(3),
  p_shipping      numeric,
  p_fees          numeric,
  p_tax           numeric,
  p_expected_date date,
  p_payment_terms text,
  p_notes         text,
  p_lines         jsonb,         -- [{product_id, quantity, manual_cost?, manual_reason?}]
  p_actor         uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid := p_po;
  v_cur char(3) := coalesce(p_currency, 'USD');
  v_mfr record;
  v_snapshot jsonb;
  r jsonb;
  v_pid uuid;
  v_qty numeric(14,4);
  v_manual numeric(14,4);
  v_reason text;
  v_prod record;
  v_res jsonb;
  v_resolved boolean;
  v_unit numeric(14,4);
  v_source text;
  v_mpid uuid;
  v_chid uuid;
  v_tmin int;
  v_tmax int;
  v_moq int;
  v_om int;
  v_lt int;
  v_mfr_sku text;
  v_mfr_desc text;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may manage purchase orders.' using errcode = '42501';
  end if;

  select id, name, contact_name, email, phone, address, status
    into v_mfr from public.manufacturers where id = p_manufacturer;
  if v_mfr.id is null then raise exception 'Manufacturer not found.'; end if;
  if v_mfr.status <> 'active' then
    raise exception 'Purchase orders can only be created for active manufacturers.';
  end if;

  v_snapshot := jsonb_build_object(
    'name', v_mfr.name,
    'contact_name', v_mfr.contact_name,
    'email', v_mfr.email,
    'phone', v_mfr.phone,
    'address', coalesce(v_mfr.address, '{}'::jsonb)
  );

  if v_id is null then
    insert into public.purchase_orders(
      po_number, manufacturer_id, manufacturer_snapshot, status, currency,
      shipping, fees, tax, expected_date, payment_terms, notes, created_by)
    values (
      'PODRAFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
      p_manufacturer, v_snapshot, 'draft', v_cur,
      coalesce(p_shipping,0), coalesce(p_fees,0), coalesce(p_tax,0),
      p_expected_date, nullif(btrim(p_payment_terms),''), nullif(btrim(p_notes),''), p_actor)
    returning id into v_id;
  else
    perform 1 from public.purchase_orders where id = v_id and status = 'draft';
    if not found then
      raise exception 'Purchase order not found or is no longer a draft.' using errcode = '42501';
    end if;
    update public.purchase_orders set
      manufacturer_id = p_manufacturer, manufacturer_snapshot = v_snapshot,
      currency = v_cur, shipping = coalesce(p_shipping,0), fees = coalesce(p_fees,0),
      tax = coalesce(p_tax,0), expected_date = p_expected_date,
      payment_terms = nullif(btrim(p_payment_terms),''), notes = nullif(btrim(p_notes),'')
    where id = v_id;
    delete from public.purchase_order_items where purchase_order_id = v_id;
  end if;

  -- ---- Line items: snapshot product + resolve manufacturer cost server-side --
  for r in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pid    := nullif(r->>'product_id','')::uuid;
    v_qty    := coalesce(nullif(r->>'quantity','')::numeric, 0);
    v_manual := nullif(r->>'manual_cost','')::numeric;
    v_reason := nullif(btrim(r->>'manual_reason'),'');

    if v_pid is null then raise exception 'Each line item requires a product.'; end if;
    if v_qty <= 0 then raise exception 'Each line item requires a quantity greater than zero.'; end if;

    select id, sku, name, strength, pack_size, status into v_prod
      from public.products where id = v_pid;
    if v_prod.id is null then raise exception 'Product % not found.', v_pid; end if;
    if v_prod.status <> 'active' then
      raise exception 'Product % (%) is not active and cannot be purchased.', v_prod.sku, v_prod.name;
    end if;

    v_res := app.resolve_manufacturer_cost(p_manufacturer, v_pid, v_qty, v_cur, current_date);
    v_resolved := (v_res->>'resolved')::boolean;

    -- Terms / relationship (present even when a cost did not resolve).
    v_mpid := nullif(v_res->>'manufacturer_product_id','')::uuid;
    v_moq  := nullif(v_res->>'moq','')::int;
    v_om   := nullif(v_res->>'order_multiple','')::int;
    v_lt   := nullif(v_res->>'lead_time_days','')::int;

    if v_manual is not null then
      -- Authorized manual cost — permitted ONLY as a fallback with a reason.
      if v_manual <= 0 then raise exception 'A manual unit cost must be greater than zero.'; end if;
      if v_reason is null then raise exception 'A manual unit cost requires a reason.'; end if;
      v_unit := v_manual;
      v_source := 'manual';
      v_chid := null; v_tmin := null; v_tmax := null;
    else
      if not v_resolved then
        raise exception 'No manufacturer cost resolved for % (qty %): %. Enter an authorized manual cost with a reason, or fix the cost file.',
          v_prod.sku, v_qty, coalesce(v_res->>'warning','unresolved');
      end if;
      v_unit  := (v_res->>'unit_cost')::numeric;
      v_source := v_res->>'source';
      v_chid  := nullif(v_res->>'cost_history_id','')::uuid;
      v_tmin  := nullif(v_res->>'tier_min_quantity','')::int;
      v_tmax  := nullif(v_res->>'tier_max_quantity','')::int;
    end if;

    -- Manufacturer SKU / description snapshot from the relationship (if any).
    v_mfr_sku := null; v_mfr_desc := null;
    if v_mpid is not null then
      select manufacturer_sku, manufacturer_description into v_mfr_sku, v_mfr_desc
        from public.manufacturer_products where id = v_mpid;
    end if;

    insert into public.purchase_order_items(
      purchase_order_id, product_id, sku, name, strength, pack_size,
      manufacturer_id, manufacturer_product_id, manufacturer_cost_history_id,
      manufacturer_sku, manufacturer_description, currency,
      quantity, unit_cost, resolved_cost_source, resolved_tier_min, resolved_tier_max,
      moq, order_multiple, lead_time_days, cost_reason, notes, created_by)
    values (
      v_id, v_pid, v_prod.sku, v_prod.name, v_prod.strength, v_prod.pack_size,
      p_manufacturer, v_mpid, v_chid,
      v_mfr_sku, v_mfr_desc, v_cur,
      v_qty, v_unit, v_source, v_tmin, v_tmax,
      v_moq, v_om, v_lt, v_reason, nullif(btrim(r->>'notes'),''), p_actor);
  end loop;

  -- Recompute the header total from the (trigger-maintained) subtotal + charges.
  update public.purchase_orders po set
     total       = po.subtotal + po.shipping + po.fees + po.tax,
     balance_due = (po.subtotal + po.shipping + po.fees + po.tax) - po.amount_paid
   where id = v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.send_po — allocate the PO number, draft → sent.
-- ----------------------------------------------------------------------------
create or replace function app.send_po(p_po uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v record; v_number text; v_items int;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may send purchase orders.' using errcode = '42501';
  end if;

  select * into v from public.purchase_orders where id = p_po;
  if v.id is null then raise exception 'Purchase order not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft purchase orders can be sent (status %).', v.status; end if;
  if v.manufacturer_id is null then raise exception 'A purchase order needs a manufacturer before it can be sent.'; end if;

  select count(*) into v_items from public.purchase_order_items where purchase_order_id = p_po;
  if v_items = 0 then raise exception 'A purchase order needs at least one line item before it can be sent.'; end if;

  v_number := app.next_po_number();

  update public.purchase_orders
     set po_number = v_number, status = 'sent', sent_at = now()
   where id = p_po and status = 'draft';
  if not found then
    raise exception 'Purchase order % is no longer a draft and cannot be sent.', p_po;
  end if;

  perform app.record_activity('purchase_order', p_po, 'sent',
    'Purchase order ' || v_number || ' sent', jsonb_build_object('manufacturer_id', v.manufacturer_id));
  return v_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.transition_po_status — validated forward status move with optional note.
-- The state-machine trigger (0320) enforces which transitions are legal; here we
-- also stamp the workflow timestamps and annotate the history row.
-- ----------------------------------------------------------------------------
create or replace function app.transition_po_status(p_po uuid, p_to po_status, p_note text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may advance a purchase order.' using errcode = '42501';
  end if;
  if p_to = 'void' then
    raise exception 'Use void_po (a reason is required) to cancel a purchase order.';
  end if;
  if p_to = 'draft' then
    raise exception 'A purchase order cannot return to draft.';
  end if;

  select * into v from public.purchase_orders where id = p_po;
  if v.id is null then raise exception 'Purchase order not found.'; end if;
  if v.status = p_to then raise exception 'Purchase order is already %.', p_to; end if;

  update public.purchase_orders
     set status       = p_to,
         confirmed_at = case when p_to = 'confirmed' and confirmed_at is null then now() else confirmed_at end,
         received_at  = case when p_to = 'received'  and received_at  is null then now() else received_at  end
   where id = p_po;

  -- Annotate the history row the log trigger just wrote for this transition.
  if nullif(btrim(p_note),'') is not null then
    update public.purchase_order_status_history sh
       set note = p_note
     where sh.purchase_order_id = p_po and sh.to_status = p_to
       and sh.created_at = (select max(created_at) from public.purchase_order_status_history
                             where purchase_order_id = p_po and to_status = p_to);
  end if;

  perform app.record_activity('purchase_order', p_po, 'status_changed',
    'Purchase order ' || v.po_number || ' → ' || p_to,
    jsonb_build_object('from', v.status, 'to', p_to));
end;
$$;

-- ----------------------------------------------------------------------------
-- app.void_po — reason-required cancel of a pre-receipt purchase order.
-- ----------------------------------------------------------------------------
create or replace function app.void_po(p_po uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may void purchase orders.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required to void a purchase order.';
  end if;

  select * into v from public.purchase_orders where id = p_po;
  if v.id is null then raise exception 'Purchase order not found.'; end if;
  if v.status = 'void' then raise exception 'Purchase order is already void.'; end if;
  if v.status = 'draft' then raise exception 'Delete the draft instead of voiding it.'; end if;
  -- (received / closed are rejected by the transition state-machine trigger.)

  update public.purchase_orders set status = 'void' where id = p_po;

  update public.purchase_order_status_history sh
     set note = p_reason
   where sh.purchase_order_id = p_po and sh.to_status = 'void'
     and sh.created_at = (select max(created_at) from public.purchase_order_status_history
                           where purchase_order_id = p_po and to_status = 'void');

  perform app.record_activity('purchase_order', p_po, 'voided',
    'Purchase order ' || v.po_number || ' voided',
    jsonb_build_object('manufacturer_id', v.manufacturer_id, 'reason', p_reason));
end;
$$;

-- ----------------------------------------------------------------------------
-- app.record_manufacturer_payment — append a payment to the PO ledger. Guards
-- (overpayment / duplicate, 0320) fire on insert; the rollup trigger (0050)
-- recomputes amount_paid / balance_due.
-- ----------------------------------------------------------------------------
create or replace function app.record_manufacturer_payment(
  p_po uuid, p_type manufacturer_payment_type, p_amount numeric, p_date date,
  p_method payment_method, p_reference text, p_notes text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may record manufacturer payments.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment amount must be greater than zero.';
  end if;

  select * into v from public.purchase_orders where id = p_po;
  if v.id is null then raise exception 'Purchase order not found.'; end if;
  if v.status = 'draft' then raise exception 'Send the purchase order before recording a manufacturer payment.'; end if;
  if v.status = 'void'  then raise exception 'Cannot record a payment against a void purchase order.'; end if;
  if v.status = 'closed' then raise exception 'This purchase order is closed.'; end if;

  insert into public.manufacturer_payments(
    purchase_order_id, type, amount, payment_date, method, reference, notes, created_by)
  values (p_po, coalesce(p_type,'deposit'), p_amount, coalesce(p_date, current_date),
          coalesce(p_method,'wire'), nullif(btrim(p_reference),''), nullif(btrim(p_notes),''), p_actor)
  returning id into v_id;

  perform app.record_activity('purchase_order', p_po, 'payment_recorded',
    'Manufacturer payment recorded on ' || v.po_number,
    jsonb_build_object('type', coalesce(p_type,'deposit')));
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.add_po_attachment — register a private-storage document on a PO.
-- The file itself lives in the private 'po-attachments' bucket; only the path
-- is stored (never a public URL).
-- ----------------------------------------------------------------------------
create or replace function app.add_po_attachment(
  p_po uuid, p_type po_attachment_type, p_filename text, p_storage_path text,
  p_file_type text, p_size bigint, p_note text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_exists boolean;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may add purchase-order attachments.' using errcode = '42501';
  end if;
  select true into v_exists from public.purchase_orders where id = p_po;
  if not coalesce(v_exists,false) then raise exception 'Purchase order not found.'; end if;
  if coalesce(btrim(p_filename),'') = '' or coalesce(btrim(p_storage_path),'') = '' then
    raise exception 'An attachment requires a filename and a storage path.';
  end if;

  insert into public.purchase_order_attachments(
    purchase_order_id, type, filename, storage_path, file_type, size_bytes, note, uploaded_by)
  values (p_po, coalesce(p_type,'other'), btrim(p_filename), btrim(p_storage_path),
          nullif(btrim(p_file_type),''), p_size, nullif(btrim(p_note),''), p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.add_po_shipment — carrier / tracking / dates for a PO.
-- ----------------------------------------------------------------------------
create or replace function app.add_po_shipment(
  p_po uuid, p_carrier text, p_tracking text, p_ship_date date,
  p_expected_arrival date, p_received_date date, p_notes text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_exists boolean;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may add tracking to a purchase order.' using errcode = '42501';
  end if;
  select true into v_exists from public.purchase_orders where id = p_po;
  if not coalesce(v_exists,false) then raise exception 'Purchase order not found.'; end if;

  insert into public.purchase_order_shipments(
    purchase_order_id, carrier, tracking_number, ship_date, expected_arrival_date, received_date, notes, created_by)
  values (p_po, nullif(btrim(p_carrier),''), nullif(btrim(p_tracking),''), p_ship_date,
          p_expected_arrival, p_received_date, nullif(btrim(p_notes),''), p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.receive_po_line — record a per-line goods receipt (qty + optional lot).
-- Does not itself advance status; the operator moves the PO to received/closed.
-- ----------------------------------------------------------------------------
create or replace function app.receive_po_line(
  p_item uuid, p_quantity numeric, p_received_date date, p_lot text,
  p_notes text, p_shipment uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may receive purchase-order lines.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A received quantity must be greater than zero.';
  end if;

  select i.id, i.purchase_order_id into v
    from public.purchase_order_items i where i.id = p_item;
  if v.id is null then raise exception 'Purchase-order line not found.'; end if;

  insert into public.purchase_order_receipts(
    purchase_order_id, purchase_order_item_id, shipment_id, quantity_received,
    received_date, lot_number, notes, received_by)
  values (v.purchase_order_id, p_item, p_shipment, p_quantity,
          coalesce(p_received_date, current_date), nullif(btrim(p_lot),''), nullif(btrim(p_notes),''), p_actor)
  returning id into v_id;

  -- NB: we intentionally do NOT touch purchase_order_items here — its lock freezes
  -- the cost snapshot once the PO is sent. Received quantity is derived from the
  -- receipts ledger (v_purchase_order_items.quantity_received).
  return v_id;
end;
$$;

-- ============================================================================
-- PUBLIC admin-checked wrappers (bind auth.uid() as actor; only these are
-- exposed to PostgREST). Purchasing is Owner/Admin-only end to end.
-- ============================================================================
create or replace function public.save_po_draft(
  p_po uuid, p_manufacturer uuid, p_currency text, p_shipping numeric, p_fees numeric,
  p_tax numeric, p_expected_date date, p_payment_terms text, p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.save_po_draft(p_po, p_manufacturer, coalesce(p_currency,'USD')::char(3),
    p_shipping, p_fees, p_tax, p_expected_date, p_payment_terms, p_notes, p_lines, auth.uid());
end; $$;

create or replace function public.send_po(p_po uuid)
returns text language plpgsql security definer set search_path = public as $$
begin return app.send_po(p_po, auth.uid()); end; $$;

create or replace function public.transition_po_status(p_po uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.transition_po_status(p_po, p_to::po_status, p_note, auth.uid()); end; $$;

create or replace function public.void_po(p_po uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.void_po(p_po, p_reason, auth.uid()); end; $$;

create or replace function public.record_manufacturer_payment(
  p_po uuid, p_type text, p_amount numeric, p_date date, p_method text, p_reference text, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.record_manufacturer_payment(p_po, coalesce(p_type,'deposit')::manufacturer_payment_type,
    p_amount, p_date, coalesce(p_method,'wire')::payment_method, p_reference, p_notes, auth.uid());
end; $$;

create or replace function public.add_po_attachment(
  p_po uuid, p_type text, p_filename text, p_storage_path text, p_file_type text, p_size bigint, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.add_po_attachment(p_po, coalesce(p_type,'other')::po_attachment_type,
    p_filename, p_storage_path, p_file_type, p_size, p_note, auth.uid());
end; $$;

create or replace function public.add_po_shipment(
  p_po uuid, p_carrier text, p_tracking text, p_ship_date date,
  p_expected_arrival date, p_received_date date, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.add_po_shipment(p_po, p_carrier, p_tracking, p_ship_date, p_expected_arrival, p_received_date, p_notes, auth.uid());
end; $$;

create or replace function public.receive_po_line(
  p_item uuid, p_quantity numeric, p_received_date date, p_lot text, p_notes text, p_shipment uuid
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.receive_po_line(p_item, p_quantity, p_received_date, p_lot, p_notes, p_shipment, auth.uid());
end; $$;

create or replace function public.delete_po_draft(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may manage purchase orders.' using errcode = '42501'; end if;
  select id, status into v from public.purchase_orders where id = p_po;
  if v.id is null then raise exception 'Purchase order not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft purchase orders can be deleted. Void issued POs instead.'; end if;
  delete from public.purchase_orders where id = p_po and status = 'draft';
end; $$;

revoke all on function
  public.save_po_draft(uuid,uuid,text,numeric,numeric,numeric,date,text,text,jsonb),
  public.send_po(uuid),
  public.transition_po_status(uuid,text,text),
  public.void_po(uuid,text),
  public.record_manufacturer_payment(uuid,text,numeric,date,text,text,text),
  public.add_po_attachment(uuid,text,text,text,text,bigint,text),
  public.add_po_shipment(uuid,text,text,date,date,date,text),
  public.receive_po_line(uuid,numeric,date,text,text,uuid),
  public.delete_po_draft(uuid)
from public, anon;

grant execute on function
  public.save_po_draft(uuid,uuid,text,numeric,numeric,numeric,date,text,text,jsonb),
  public.send_po(uuid),
  public.transition_po_status(uuid,text,text),
  public.void_po(uuid,text),
  public.record_manufacturer_payment(uuid,text,numeric,date,text,text,text),
  public.add_po_attachment(uuid,text,text,text,text,bigint,text),
  public.add_po_shipment(uuid,text,text,date,date,date,text),
  public.receive_po_line(uuid,numeric,date,text,text,uuid),
  public.delete_po_draft(uuid)
to authenticated;
