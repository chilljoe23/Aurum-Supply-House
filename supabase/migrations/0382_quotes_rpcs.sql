-- ============================================================================
-- Aurum Supply House · 0382 · Quotes · Transactional RPCs (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Every quote mutation flows through a SECURITY DEFINER app.* function fronted by
-- a permission-checked public.* wrapper (mirrors 0200 / 0330). Each function is a
-- single transaction: any RAISE rolls the whole thing back (atomic save / send /
-- transition / duplicate / convert). Prices are ALWAYS resolved server-side via
-- app.resolve_price; a quote never stores or exposes true cost.
--
--   save_quote_draft        staff  create/replace a DRAFT quote + its line items
--   send_quote              admin  allocate QTE number, set expiry, draft → sent
--   transition_quote_status admin  accept | decline | mark expired (+ note)
--   void_quote              admin  reason-required void of a draft/sent quote
--   duplicate_quote         staff  copy a quote into a fresh DRAFT (re-resolve/retain)
--   convert_quote_to_order  staff  accepted quote → draft order (idempotent, atomic)
--   delete_quote_draft      staff  discard a draft (never an issued quote)
--   expire_quotes           admin  deterministic sweep of past-expiry sent quotes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app.save_quote_draft — create or replace a draft quote with snapshots. Price is
-- resolved server-side; a manual override is Owner/Admin-only and requires a
-- reason. Never returns zero, never falls back to cost.
-- ----------------------------------------------------------------------------
create or replace function app.save_quote_draft(
  p_quote          uuid,        -- null → create
  p_client         uuid,
  p_selected_model uuid,        -- explicitly chosen model (null → client default)
  p_currency       char(3),
  p_shipping       numeric,
  p_fees           numeric,
  p_tax_rate       numeric,
  p_discount       numeric,
  p_payment_terms  payment_terms,
  p_customer_reference text,
  p_quote_date     date,
  p_expiration_date date,
  p_notes          text,
  p_lines          jsonb,       -- [{product_id, quantity, manual_price?, manual_reason?}]
  p_actor          uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_quote;
  v_is_admin boolean := app.is_admin();
  v_client record;
  v_rep uuid;
  v_rep_name text;
  v_sheet uuid;
  v_sheet_name text;
  v_terms payment_terms;
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
begin
  if not app.is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Client must exist; reps may only quote for clients in their own book.
  select id, company_name, primary_contact_name, email, phone, payment_terms,
         billing_address, shipping_address, assigned_rep_id, default_pricing_sheet_id, status
    into v_client from public.clients where id = p_client;
  if v_client.id is null then raise exception 'Client not found.'; end if;
  if not v_is_admin and v_client.assigned_rep_id is distinct from p_actor then
    raise exception 'You may only create quotes for clients in your own book.' using errcode = '42501';
  end if;
  if v_client.status <> 'active' then
    raise exception 'Quotes can only be created for active clients.';
  end if;

  -- Representative is derived from the client (a rep can never reassign a quote).
  v_rep := coalesce(v_client.assigned_rep_id, p_actor);
  select full_name into v_rep_name from public.profiles where id = v_rep;

  -- Effective pricing model (header snapshot). Explicit selection wins; else the
  -- client's assigned/default model. Must be an active sheet.
  v_sheet := coalesce(p_selected_model, v_client.default_pricing_sheet_id);
  if v_sheet is not null then
    select name into v_sheet_name from public.pricing_sheets where id = v_sheet and status = 'active';
    if v_sheet_name is null then
      raise exception 'Selected pricing model is not active or does not exist.';
    end if;
  end if;

  v_terms := coalesce(p_payment_terms, v_client.payment_terms, 'net_30');

  -- Client snapshot frozen onto the quote (name, contact, addresses, chosen terms).
  v_snapshot := jsonb_build_object(
    'company_name', v_client.company_name,
    'primary_contact_name', v_client.primary_contact_name,
    'email', v_client.email,
    'phone', v_client.phone,
    'payment_terms', v_terms,
    'billing_address', coalesce(v_client.billing_address, '{}'::jsonb),
    'shipping_address', coalesce(v_client.shipping_address, '{}'::jsonb)
  );

  if v_id is null then
    insert into public.quotes(
      quote_number, client_id, client_snapshot, sales_rep_id, sales_rep_name,
      pricing_sheet_id, pricing_sheet_name, status, currency,
      shipping, fees, tax_rate, discount, payment_terms, customer_reference,
      quote_date, expiration_date, notes, created_by)
    values (
      'QDRAFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
      p_client, v_snapshot, v_rep, v_rep_name,
      v_sheet, v_sheet_name, 'draft', v_cur,
      coalesce(p_shipping,0), coalesce(p_fees,0), coalesce(p_tax_rate,0), coalesce(p_discount,0),
      v_terms, nullif(btrim(p_customer_reference),''),
      coalesce(p_quote_date, current_date), p_expiration_date, p_notes, p_actor)
    returning id into v_id;
  else
    perform 1 from public.quotes
      where id = v_id and status = 'draft' and (v_is_admin or sales_rep_id = p_actor);
    if not found then
      raise exception 'Quote not found, not a draft, or not yours to edit.' using errcode = '42501';
    end if;
    update public.quotes set
      client_id = p_client, client_snapshot = v_snapshot,
      sales_rep_id = v_rep, sales_rep_name = v_rep_name,
      pricing_sheet_id = v_sheet, pricing_sheet_name = v_sheet_name,
      currency = v_cur, shipping = coalesce(p_shipping,0), fees = coalesce(p_fees,0),
      tax_rate = coalesce(p_tax_rate,0), discount = coalesce(p_discount,0),
      payment_terms = v_terms, customer_reference = nullif(btrim(p_customer_reference),''),
      quote_date = coalesce(p_quote_date, current_date), expiration_date = p_expiration_date, notes = p_notes
    where id = v_id;
    delete from public.quote_items where quote_id = v_id;
    perform app.record_activity('quote', v_id, 'draft_updated',
      'Draft updated', jsonb_build_object('client_id', p_client));
  end if;

  -- ---- Line items: snapshot product + resolve price server-side (no cost) -----
  for r in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pid    := nullif(r->>'product_id','')::uuid;
    v_qty    := coalesce(nullif(r->>'quantity','')::numeric, 0);
    v_manual := nullif(r->>'manual_price','')::numeric;
    v_reason := nullif(btrim(r->>'manual_reason'),'');

    if v_pid is null then raise exception 'Each line item requires a product.'; end if;
    if v_qty <= 0 then raise exception 'Each line item requires a quantity greater than zero.'; end if;

    select id, sku, name, strength, pack_size, manufacturer_id, status
      into v_prod from public.products where id = v_pid;
    if v_prod.id is null then raise exception 'Product % not found.', v_pid; end if;
    if v_prod.status <> 'active' then
      raise exception 'Product % (%) is not active and cannot be quoted.', v_prod.sku, v_prod.name;
    end if;

    -- Always resolve the catalog price (so an override records what it replaced).
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

    insert into public.quote_items(
      quote_id, product_id, sku, product_name, strength, pack_size, manufacturer_name,
      currency, quantity, unit_price, price_source, price_source_sheet,
      price_overridden, original_unit_price, manual_reason)
    values (
      v_id, v_pid, v_prod.sku, v_prod.name, v_prod.strength, v_prod.pack_size,
      (select name from public.manufacturers where id = v_prod.manufacturer_id),
      v_cur, v_qty, v_unit, v_source, v_source_sheet, v_overridden, v_original, v_reason);
  end loop;

  perform app.recalc_quote(v_id);

  -- A discount may not exceed the product subtotal.
  select subtotal into v_subtotal from public.quotes where id = v_id;
  if coalesce(p_discount,0) > coalesce(v_subtotal,0) then
    raise exception 'Discount (%) cannot exceed the product subtotal (%).', p_discount, v_subtotal;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.send_quote — allocate the QTE number, set the expiry window, draft → sent.
-- ----------------------------------------------------------------------------
create or replace function app.send_quote(p_quote uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v record; v_number text; v_items int; v_days int; v_expiry date;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may send quotes.' using errcode = '42501';
  end if;

  select * into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft quotes can be sent (status %).', v.status; end if;
  if v.client_id is null then raise exception 'A quote needs a client before it can be sent.'; end if;

  select count(*) into v_items from public.quote_items where quote_id = p_quote;
  if v_items = 0 then raise exception 'A quote needs at least one line item before it can be sent.'; end if;

  -- Derive the expiry window from settings when the drafter left it blank.
  v_expiry := v.expiration_date;
  if v_expiry is null then
    select quote_expiration_days into v_days from public.app_settings where id = true;
    if coalesce(v_days,0) > 0 then
      v_expiry := coalesce(v.quote_date, current_date) + v_days;
    end if;
  end if;

  v_number := app.next_quote_number();

  update public.quotes
     set quote_number = v_number, expiration_date = v_expiry, status = 'sent'
   where id = p_quote and status = 'draft';
  if not found then
    raise exception 'Quote % is no longer a draft and cannot be sent.', p_quote;
  end if;

  return v_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.transition_quote_status — accept | decline | mark expired (+ optional note).
-- The state-machine trigger (0381) enforces legality; timestamps are stamped by
-- the log trigger. void / convert have their own reason-/atomicity-bearing paths.
-- ----------------------------------------------------------------------------
create or replace function app.transition_quote_status(p_quote uuid, p_to quote_status, p_note text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may advance a quote.' using errcode = '42501';
  end if;
  if p_to not in ('accepted','declined','expired') then
    raise exception 'Use send_quote, void_quote, or convert_quote_to_order for that transition.';
  end if;

  select * into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;
  if v.status = p_to then raise exception 'Quote is already %.', p_to; end if;

  update public.quotes set status = p_to where id = p_quote;

  if nullif(btrim(p_note),'') is not null then
    update public.quote_status_history sh
       set note = p_note
     where sh.quote_id = p_quote and sh.to_status = p_to
       and sh.created_at = (select max(created_at) from public.quote_status_history
                             where quote_id = p_quote and to_status = p_to);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.void_quote — reason-required void of a draft or sent quote.
-- ----------------------------------------------------------------------------
create or replace function app.void_quote(p_quote uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may void quotes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required to void a quote.';
  end if;

  select * into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;
  if v.status not in ('draft','sent') then
    raise exception 'Only draft or sent quotes can be voided (status %).', v.status;
  end if;

  update public.quotes set status = 'void' where id = p_quote;

  update public.quote_status_history sh
     set note = p_reason
   where sh.quote_id = p_quote and sh.to_status = 'void'
     and sh.created_at = (select max(created_at) from public.quote_status_history
                           where quote_id = p_quote and to_status = 'void');
end;
$$;

-- ----------------------------------------------------------------------------
-- app.duplicate_quote — copy a quote into a fresh DRAFT. Re-resolves prices by
-- default; p_retain keeps the quoted selling prices. Never mutates the original,
-- never reuses the quote number, never returns a zero price.
-- ----------------------------------------------------------------------------
create or replace function app.duplicate_quote(p_quote uuid, p_retain boolean, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v record; v_new uuid; li record; v_res jsonb; v_resolved boolean;
  v_unit numeric(14,4); v_source text; v_sheet text; v_original numeric(14,4);
  v_days int; v_expiry date;
begin
  if not app.is_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not app.can_access_quote(p_quote) then
    raise exception 'You may only duplicate quotes in your own book.' using errcode = '42501';
  end if;

  select * into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;

  select quote_expiration_days into v_days from public.app_settings where id = true;
  v_expiry := case when coalesce(v_days,0) > 0 then current_date + v_days else null end;

  insert into public.quotes(
    quote_number, client_id, client_snapshot, sales_rep_id, sales_rep_name,
    pricing_sheet_id, pricing_sheet_name, status, currency,
    shipping, fees, tax_rate, discount, payment_terms, customer_reference,
    quote_date, expiration_date, notes, created_by)
  values (
    'QDRAFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
    v.client_id, v.client_snapshot, v.sales_rep_id, v.sales_rep_name,
    v.pricing_sheet_id, v.pricing_sheet_name, 'draft', v.currency,
    v.shipping, v.fees, v.tax_rate, v.discount, v.payment_terms, v.customer_reference,
    current_date, v_expiry, v.notes, p_actor)
  returning id into v_new;

  for li in select * from public.quote_items where quote_id = p_quote order by created_at loop
    v_res := app.resolve_price(v.client_id, li.product_id, li.quantity, v.currency,
                               v.pricing_sheet_id, current_date, null, null);
    v_resolved := (v_res->>'resolved')::boolean;

    if p_retain then
      -- Keep the quoted selling price; record the current resolved price for context.
      v_unit := li.unit_price; v_source := 'quote_retained'; v_sheet := li.price_source_sheet;
      v_original := case when v_resolved then (v_res->>'price')::numeric else null end;
    elsif v_resolved then
      v_unit := (v_res->>'price')::numeric; v_source := v_res->>'source';
      v_sheet := v_res->>'pricing_sheet_name'; v_original := null;
    else
      -- Re-resolve requested but nothing resolves now — retain the prior real price
      -- rather than emit a zero. The builder will surface this on re-open.
      v_unit := li.unit_price; v_source := 'quote_retained'; v_sheet := li.price_source_sheet;
      v_original := null;
    end if;

    insert into public.quote_items(
      quote_id, product_id, sku, product_name, strength, pack_size, manufacturer_name,
      currency, quantity, unit_price, price_source, price_source_sheet,
      price_overridden, original_unit_price, manual_reason)
    values (
      v_new, li.product_id, li.sku, li.product_name, li.strength, li.pack_size, li.manufacturer_name,
      v.currency, li.quantity, v_unit, v_source, v_sheet, false, v_original, null);
  end loop;

  perform app.recalc_quote(v_new);
  perform app.record_activity('quote', v_new, 'duplicated',
    'Duplicated from ' || v.quote_number, jsonb_build_object('source_quote_id', p_quote, 'retain_prices', p_retain));
  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.convert_quote_to_order — accepted quote → DRAFT order. Transactional and
-- idempotent (one order per quote). Preserves the quoted selling prices, marks
-- each order line quote-derived, snapshots the CURRENT true cost using existing
-- order rules, and links both directions. Does NOT issue the invoice.
-- ----------------------------------------------------------------------------
create or replace function app.convert_quote_to_order(p_quote uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v record; v_is_admin boolean := app.is_admin(); v_inv uuid; v_existing uuid;
  li record; v_cost numeric(14,4);
begin
  if not app.is_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;

  select * into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;
  if not v_is_admin and v.sales_rep_id is distinct from p_actor then
    raise exception 'You may only convert quotes in your own book.' using errcode = '42501';
  end if;

  -- Idempotent: if this quote already produced an order, return it.
  if v.converted_order_id is not null then return v.converted_order_id; end if;
  select id into v_existing from public.invoices where source_quote_id = p_quote limit 1;
  if v_existing is not null then
    update public.quotes set status = 'converted', converted_order_id = v_existing
      where id = p_quote and status <> 'converted';
    return v_existing;
  end if;

  if v.status <> 'accepted' then
    raise exception 'Only an accepted quote can be converted to an order (status %).', v.status;
  end if;

  -- Create the DRAFT order. A DRAFT-scoped number keeps the row unique without
  -- consuming an AUR invoice number (allocated only at issue time). The customer
  -- snapshot (incl. terms + addresses) carries over verbatim from the quote.
  begin
    insert into public.invoices(
      invoice_number, client_id, client_snapshot, sales_rep_id, sales_rep_name,
      pricing_sheet_id, pricing_sheet_name, status, currency,
      shipping, fees, tax_rate, discount, notes, source_quote_id, source_quote_number, created_by)
    values (
      'DRAFT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
      v.client_id, v.client_snapshot, v.sales_rep_id, v.sales_rep_name,
      v.pricing_sheet_id, v.pricing_sheet_name, 'draft', v.currency,
      v.shipping, v.fees, v.tax_rate, v.discount, v.notes, p_quote, v.quote_number, p_actor)
    returning id into v_inv;
  exception when unique_violation then
    -- A concurrent conversion won the race; return the order it created.
    select id into v_existing from public.invoices where source_quote_id = p_quote limit 1;
    if v_existing is not null then
      update public.quotes set status = 'converted', converted_order_id = v_existing
        where id = p_quote and status <> 'converted';
      return v_existing;
    end if;
    raise;
  end;

  -- Copy each line, preserving the quoted selling price and marking it quote-
  -- derived. Snapshot the CURRENT true cost (order rules) — never a quote cost
  -- (a quote has none). Internal profitability is recomputed by recalc_invoice.
  for li in select * from public.quote_items where quote_id = p_quote order by created_at loop
    v_cost := 0;
    if li.product_id is not null then
      select coalesce(current_true_cost, 0) into v_cost from public.products where id = li.product_id;
      v_cost := coalesce(v_cost, 0);
    end if;

    insert into public.invoice_items(
      invoice_id, product_id, sku, product_name, strength, pack_size, manufacturer_name,
      quantity, unit_price, unit_true_cost, price_overridden, original_unit_price,
      price_source, price_source_sheet, manual_reason)
    values (
      v_inv, li.product_id, li.sku, li.product_name, li.strength, li.pack_size, li.manufacturer_name,
      li.quantity, li.unit_price, v_cost, li.price_overridden, li.original_unit_price,
      'quote', li.price_source_sheet, li.manual_reason);
  end loop;

  -- Ensure header rollups (incl. cost/profit + discount clamp) are final.
  perform app.recalc_invoice(v_inv);

  -- Mark the quote converted only after the order + all lines succeeded.
  update public.quotes set status = 'converted', converted_order_id = v_inv where id = p_quote;

  perform app.record_activity('quote', p_quote, 'converted',
    'Quote ' || v.quote_number || ' converted to an order',
    jsonb_build_object('invoice_id', v_inv, 'client_id', v.client_id));
  return v_inv;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.expire_quotes — deterministic sweep: sent quotes past their expiration date
-- move to 'expired'. Returns the number expired. Safe to run repeatedly (cron or
-- on-demand); accepted/converted quotes are never touched.
-- ----------------------------------------------------------------------------
create or replace function app.expire_quotes(p_actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may expire quotes.' using errcode = '42501';
  end if;
  for r in
    select id from public.quotes
     where status = 'sent' and expiration_date is not null and expiration_date < current_date
  loop
    update public.quotes set status = 'expired' where id = r.id and status = 'sent';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- PUBLIC permission-checked wrappers (bind auth.uid() as actor; the only quote
-- functions exposed to PostgREST).
-- ============================================================================
create or replace function public.save_quote_draft(
  p_quote uuid, p_client uuid, p_selected_model uuid, p_currency text,
  p_shipping numeric, p_fees numeric, p_tax_rate numeric, p_discount numeric,
  p_payment_terms text, p_customer_reference text, p_quote_date date,
  p_expiration_date date, p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.save_quote_draft(p_quote, p_client, p_selected_model, coalesce(p_currency,'USD')::char(3),
    p_shipping, p_fees, p_tax_rate, p_discount,
    coalesce(p_payment_terms,'net_30')::payment_terms, p_customer_reference,
    p_quote_date, p_expiration_date, p_notes, p_lines, auth.uid());
end; $$;

create or replace function public.send_quote(p_quote uuid)
returns text language plpgsql security definer set search_path = public as $$
begin return app.send_quote(p_quote, auth.uid()); end; $$;

create or replace function public.transition_quote_status(p_quote uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.transition_quote_status(p_quote, p_to::quote_status, p_note, auth.uid()); end; $$;

create or replace function public.void_quote(p_quote uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.void_quote(p_quote, p_reason, auth.uid()); end; $$;

create or replace function public.duplicate_quote(p_quote uuid, p_retain boolean)
returns uuid language plpgsql security definer set search_path = public as $$
begin return app.duplicate_quote(p_quote, coalesce(p_retain,false), auth.uid()); end; $$;

create or replace function public.convert_quote_to_order(p_quote uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin return app.convert_quote_to_order(p_quote, auth.uid()); end; $$;

create or replace function public.expire_quotes()
returns integer language plpgsql security definer set search_path = public as $$
begin return app.expire_quotes(auth.uid()); end; $$;

-- Discard a DRAFT quote (only drafts; issued quotes must be voided, never deleted).
create or replace function public.delete_quote_draft(p_quote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  select id, status, sales_rep_id into v from public.quotes where id = p_quote;
  if v.id is null then raise exception 'Quote not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft quotes can be deleted. Void issued quotes instead.'; end if;
  if not app.is_admin() and v.sales_rep_id is distinct from auth.uid() then
    raise exception 'You may only delete your own drafts.' using errcode = '42501';
  end if;
  delete from public.quotes where id = p_quote and status = 'draft';
end; $$;

revoke all on function
  public.save_quote_draft(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,date,date,text,jsonb),
  public.send_quote(uuid),
  public.transition_quote_status(uuid,text,text),
  public.void_quote(uuid,text),
  public.duplicate_quote(uuid,boolean),
  public.convert_quote_to_order(uuid),
  public.expire_quotes(),
  public.delete_quote_draft(uuid)
from public, anon;

grant execute on function
  public.save_quote_draft(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,date,date,text,jsonb),
  public.send_quote(uuid),
  public.transition_quote_status(uuid,text,text),
  public.void_quote(uuid,text),
  public.duplicate_quote(uuid,boolean),
  public.convert_quote_to_order(uuid),
  public.expire_quotes(),
  public.delete_quote_draft(uuid)
to authenticated;
