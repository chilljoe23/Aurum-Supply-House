-- ============================================================================
-- Aurum Supply House · 0360 · M6 · Invoice lot numbers (ADDITIVE)
-- ----------------------------------------------------------------------------
-- The lot columns already exist on invoice_items (0060: lot_number,
-- manufacturing_date, expiration_date, retest_date, coa_path) — this migration
-- SURFACES them without creating duplicates:
--   1. v_order_items exposes lot_number + the three lot dates (NEVER coa_path —
--      the COA storage path is not exposed through any read surface).
--   2. app.save_order_draft persists per-line lot fields for DRAFT invoices, so
--      the order builder / draft edit can capture a lot; it is frozen when the
--      invoice is issued (the existing item lock).
--   3. app.assign_invoice_lot is a narrowly-scoped, audited RPC to set a lot on
--      an ALREADY-ISSUED invoice line without weakening general immutability:
--      the item lock is relaxed ONLY for a lot-only change guarded by a
--      transaction-local flag this RPC sets; every non-lot column must be
--      unchanged or the update is rejected.
-- ============================================================================

-- ---- 1 · v_order_items + lot fields (coa_path deliberately excluded) ---------
-- ADDITIVE: the 20 columns defined in 0210 are kept in their EXACT original
-- position (id … line_gross_profit) so CREATE OR REPLACE VIEW does not see a
-- column rename (PostgreSQL rejects reordering/renaming existing view columns —
-- SQLSTATE 42P16). The four lot fields are APPENDED at the end. coa_path stays
-- excluded from every read surface.
create or replace view public.v_order_items
  with (security_invoker = false, security_barrier = true)
as
select
  ii.id,
  ii.invoice_id,
  ii.product_id,
  ii.sku,
  ii.product_name,
  ii.strength,
  ii.pack_size,
  ii.manufacturer_name,
  ii.quantity,
  ii.unit_price,
  ii.line_subtotal,
  ii.price_overridden,
  ii.original_unit_price,
  ii.price_source,
  ii.price_source_sheet,
  ii.manual_reason,
  ii.created_at,
  -- Internal cost — masked for non-admins.
  case when app.is_admin() then ii.unit_true_cost    end as unit_true_cost,
  case when app.is_admin() then ii.line_true_cost    end as line_true_cost,
  case when app.is_admin() then ii.line_gross_profit end as line_gross_profit,
  -- Lot annotation appended AFTER the existing 0210 columns (coa_path excluded).
  ii.lot_number,
  ii.manufacturing_date,
  ii.expiration_date,
  ii.retest_date
from public.invoice_items ii
where app.can_access_invoice(ii.invoice_id);

revoke all on public.v_order_items from anon;
grant select on public.v_order_items to authenticated;
comment on view public.v_order_items is
  'Staff order line-item surface. Exposes lot number + lot dates (never coa_path); masks true cost / GP for non-admins.';

-- ---- 2 · Relax the item lock ONLY for a guarded lot-only update --------------
-- Replaces app.enforce_invoice_items_lock (0060) additively. General immutability
-- is unchanged: a non-draft invoice's lines stay frozen. The single sanctioned
-- exception is a lot-only annotation via app.assign_invoice_lot, which sets a
-- transaction-local guard AND leaves every non-lot column identical.
create or replace function app.enforce_invoice_items_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status invoice_status;
begin
  select status into v_status from public.invoices
    where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is null or v_status = 'draft' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and current_setting('app.allow_lot_update', true) = 'on'
     and new.invoice_id          is not distinct from old.invoice_id
     and new.product_id          is not distinct from old.product_id
     and new.sku                 is not distinct from old.sku
     and new.product_name        is not distinct from old.product_name
     and new.strength            is not distinct from old.strength
     and new.pack_size           is not distinct from old.pack_size
     and new.manufacturer_name   is not distinct from old.manufacturer_name
     and new.quantity            is not distinct from old.quantity
     and new.unit_price          is not distinct from old.unit_price
     and new.unit_true_cost      is not distinct from old.unit_true_cost
     and new.price_overridden    is not distinct from old.price_overridden
     and new.original_unit_price is not distinct from old.original_unit_price
     and new.line_subtotal       is not distinct from old.line_subtotal
     and new.line_true_cost      is not distinct from old.line_true_cost
     and new.line_gross_profit   is not distinct from old.line_gross_profit
     and new.price_source        is not distinct from old.price_source
     and new.price_source_sheet  is not distinct from old.price_source_sheet
     and new.manual_reason       is not distinct from old.manual_reason
  then
    return new;  -- lot-only annotation permitted
  end if;

  raise exception 'Cannot modify line items of a % invoice. Void and reissue instead.', v_status;
end;
$$;

-- ---- 3 · app.save_order_draft — persist per-line lot fields (draft only) -----
-- Redefines the 0200 function additively. Body is identical except each line may
-- now carry lot_number / manufacturing_date / expiration_date / retest_date /
-- coa_path, snapshotted onto the draft line. Signature is unchanged (p_lines is
-- jsonb), so the generated types and the public wrapper need no change.
create or replace function app.save_order_draft(
  p_invoice     uuid,
  p_client      uuid,
  p_selected_model uuid,
  p_currency    char(3),
  p_shipping    numeric,
  p_fees        numeric,
  p_tax_rate    numeric,
  p_discount    numeric,
  p_notes       text,
  p_lines       jsonb,
  p_actor       uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_invoice;
  v_is_admin boolean := app.is_admin();
  v_client record;
  v_rep uuid;
  v_rep_name text;
  v_sheet uuid;
  v_sheet_name text;
  v_snapshot jsonb;
  v_cur char(3) := coalesce(p_currency, 'USD');
  r jsonb;
  v_pid uuid;
  v_qty numeric(14,4);
  v_manual numeric(14,4);
  v_reason text;
  v_prod record;
  v_res jsonb;
  v_unit numeric(14,4);
  v_source text;
  v_source_sheet text;
  v_overridden boolean;
  v_original numeric(14,4);
  v_subtotal numeric(14,4);
  v_lot text;
  v_mfg date;
  v_exp date;
  v_retest date;
  v_coa text;
begin
  if not app.is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select id, company_name, primary_contact_name, email, phone, payment_terms,
         billing_address, shipping_address, assigned_rep_id, default_pricing_sheet_id, status
    into v_client
    from public.clients where id = p_client;
  if v_client.id is null then
    raise exception 'Client not found.';
  end if;
  if not v_is_admin and v_client.assigned_rep_id is distinct from p_actor then
    raise exception 'You may only create orders for clients in your own book.' using errcode = '42501';
  end if;
  if v_client.status <> 'active' then
    raise exception 'Orders can only be created for active clients.';
  end if;

  v_rep := coalesce(v_client.assigned_rep_id, p_actor);
  select full_name into v_rep_name from public.profiles where id = v_rep;

  v_sheet := coalesce(p_selected_model, v_client.default_pricing_sheet_id);
  if v_sheet is not null then
    select name into v_sheet_name from public.pricing_sheets
      where id = v_sheet and status = 'active';
    if v_sheet_name is null then
      raise exception 'Selected pricing model is not active or does not exist.';
    end if;
  end if;

  v_snapshot := jsonb_build_object(
    'company_name', v_client.company_name,
    'primary_contact_name', v_client.primary_contact_name,
    'email', v_client.email,
    'phone', v_client.phone,
    'payment_terms', v_client.payment_terms,
    'billing_address', coalesce(v_client.billing_address, '{}'::jsonb),
    'shipping_address', coalesce(v_client.shipping_address, '{}'::jsonb)
  );

  if v_id is null then
    insert into public.invoices(
      invoice_number, client_id, client_snapshot, sales_rep_id, sales_rep_name,
      pricing_sheet_id, pricing_sheet_name, status, currency,
      shipping, fees, tax_rate, discount, notes, created_by)
    values (
      'DRAFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
      p_client, v_snapshot, v_rep, v_rep_name,
      v_sheet, v_sheet_name, 'draft', v_cur,
      coalesce(p_shipping,0), coalesce(p_fees,0), coalesce(p_tax_rate,0),
      coalesce(p_discount,0), p_notes, p_actor)
    returning id into v_id;
  else
    perform 1 from public.invoices
      where id = v_id and status = 'draft'
        and (v_is_admin or sales_rep_id = p_actor);
    if not found then
      raise exception 'Order not found, not a draft, or not yours to edit.' using errcode = '42501';
    end if;
    update public.invoices set
      client_id = p_client, client_snapshot = v_snapshot,
      sales_rep_id = v_rep, sales_rep_name = v_rep_name,
      pricing_sheet_id = v_sheet, pricing_sheet_name = v_sheet_name,
      currency = v_cur, shipping = coalesce(p_shipping,0), fees = coalesce(p_fees,0),
      tax_rate = coalesce(p_tax_rate,0), discount = coalesce(p_discount,0), notes = p_notes
    where id = v_id;
    delete from public.invoice_items where invoice_id = v_id;
    perform app.record_activity('invoice', v_id, 'draft_updated',
      'Draft updated', jsonb_build_object('client_id', p_client));
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pid    := nullif(r->>'product_id','')::uuid;
    v_qty    := coalesce(nullif(r->>'quantity','')::numeric, 0);
    v_manual := nullif(r->>'manual_price','')::numeric;
    v_reason := nullif(btrim(r->>'manual_reason'),'');
    v_lot    := nullif(btrim(r->>'lot_number'),'');
    v_mfg    := nullif(r->>'manufacturing_date','')::date;
    v_exp    := nullif(r->>'expiration_date','')::date;
    v_retest := nullif(r->>'retest_date','')::date;
    v_coa    := nullif(btrim(r->>'coa_path'),'');

    if v_pid is null then raise exception 'Each line item requires a product.'; end if;
    if v_qty <= 0 then raise exception 'Each line item requires a quantity greater than zero.'; end if;

    select id, sku, name, strength, pack_size, manufacturer_id, current_true_cost, status
      into v_prod from public.products where id = v_pid;
    if v_prod.id is null then raise exception 'Product % not found.', v_pid; end if;
    if v_prod.status <> 'active' then
      raise exception 'Product % (%) is not active and cannot be ordered.', v_prod.sku, v_prod.name;
    end if;

    v_res := app.resolve_price(p_client, v_pid, v_qty, v_cur, p_selected_model, current_date, null, null);

    if v_manual is not null then
      if not v_is_admin then
        raise exception 'Only Owners and Admins may apply a manual price override.' using errcode = '42501';
      end if;
      if v_manual <= 0 then raise exception 'A manual price must be greater than zero.'; end if;
      if v_reason is null then raise exception 'A manual price override requires a reason.'; end if;
      v_unit := v_manual;
      v_source := 'manual';
      v_source_sheet := null;
      v_overridden := true;
      v_original := case when (v_res->>'resolved')::boolean then (v_res->>'price')::numeric else null end;
    else
      if not (v_res->>'resolved')::boolean then
        raise exception 'No price could be resolved for % (qty %). Set a model price, a client override, or an authorized manual price.',
          v_prod.sku, v_qty;
      end if;
      v_unit := (v_res->>'price')::numeric;
      v_source := v_res->>'source';
      v_source_sheet := v_res->>'pricing_sheet_name';
      v_overridden := false;
      v_original := null;
    end if;

    insert into public.invoice_items(
      invoice_id, product_id, sku, product_name, strength, pack_size, manufacturer_name,
      quantity, unit_price, unit_true_cost, price_overridden, original_unit_price,
      price_source, price_source_sheet, manual_reason,
      lot_number, manufacturing_date, expiration_date, retest_date, coa_path)
    values (
      v_id, v_pid, v_prod.sku, v_prod.name, v_prod.strength, v_prod.pack_size,
      (select name from public.manufacturers where id = v_prod.manufacturer_id),
      v_qty, v_unit, coalesce(v_prod.current_true_cost,0), v_overridden, v_original,
      v_source, v_source_sheet, v_reason,
      v_lot, v_mfg, v_exp, v_retest, v_coa);
  end loop;

  perform app.recalc_invoice(v_id);

  select subtotal into v_subtotal from public.invoices where id = v_id;
  if coalesce(p_discount,0) > coalesce(v_subtotal,0) then
    raise exception 'Discount (%) cannot exceed the product subtotal (%).', p_discount, v_subtotal;
  end if;

  return v_id;
end;
$$;

-- ---- 4 · app.assign_invoice_lot — audited post-issue lot assignment ----------
create or replace function app.assign_invoice_lot(
  p_item uuid, p_lot text, p_mfg date, p_exp date, p_retest date, p_coa text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may assign a lot number.' using errcode = '42501';
  end if;
  select ii.id, ii.invoice_id, i.invoice_number, i.status
    into v
    from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
   where ii.id = p_item;
  if v.id is null then raise exception 'Invoice line not found.'; end if;

  -- Transaction-local guard the item-lock trigger checks. A lot-only change on
  -- an issued invoice is the sole sanctioned exception to line immutability.
  perform set_config('app.allow_lot_update', 'on', true);
  update public.invoice_items set
    lot_number         = nullif(btrim(p_lot),''),
    manufacturing_date = p_mfg,
    expiration_date    = p_exp,
    retest_date        = p_retest,
    coa_path           = coalesce(nullif(btrim(p_coa),''), coa_path)
  where id = p_item;
  perform set_config('app.allow_lot_update', 'off', true);

  perform app.record_activity('invoice', v.invoice_id, 'lot_assigned',
    'Lot assigned on ' || coalesce(v.invoice_number, 'invoice'),
    jsonb_build_object('item_id', p_item, 'lot_number', nullif(btrim(p_lot),'')));
end;
$$;

create or replace function public.assign_invoice_lot(
  p_item uuid, p_lot text, p_manufacturing_date date, p_expiration_date date,
  p_retest_date date, p_coa_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.assign_invoice_lot(p_item, p_lot, p_manufacturing_date, p_expiration_date,
    p_retest_date, p_coa_path, auth.uid());
end; $$;

revoke all on function public.assign_invoice_lot(uuid,text,date,date,date,text) from public, anon;
grant execute on function public.assign_invoice_lot(uuid,text,date,date,date,text) to authenticated;
