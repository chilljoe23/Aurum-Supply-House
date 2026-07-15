-- ============================================================================
-- Aurum Supply House · 0200 · M4 · Transactional order RPCs + guards
-- ----------------------------------------------------------------------------
-- ADDITIVE. Every order mutation flows through one of these SECURITY DEFINER
-- functions so permissions, snapshots, price resolution, and money math are
-- enforced server/DB-side — never trusted from the client. Each function is a
-- single transaction: any RAISE rolls the whole thing back (atomic order create).
--
--   save_order_draft   staff  create/replace a DRAFT invoice + its line items
--   issue_invoice      admin  allocate AUR number, set dates, draft → sent
--   record_payment     admin  append payment (rollup advances status/balance)
--   void_invoice       admin  reason-required void of an issued invoice
--   add_order_expense  admin  internal expense (never on the customer invoice)
--   delete_order_expense admin
-- ============================================================================

-- ---- invoice_items: per-line price-resolution snapshot columns --------------
-- The resolution source can differ per line (one override, one assigned model,
-- one manual), so it is snapshotted on the line, not just the invoice header.
alter table public.invoice_items
  add column if not exists price_source        text,   -- client_override|selected_model|assigned_model|default_model|manual
  add column if not exists price_source_sheet  text,   -- pricing model name that priced this line (if any)
  add column if not exists manual_reason       text;   -- required when price_overridden = true

-- ----------------------------------------------------------------------------
-- Status-transition permission guard (defense in depth beyond the RPCs).
-- Only Owners/Admins may move an invoice out of / between non-draft states
-- (issue, void, and — via the payment rollup, which runs as the admin who
-- recorded the payment — partial/paid). A sales rep may only ever hold a draft.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_invoice_transition_perms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not app.is_admin() then
    raise exception 'Only Owners and Admins may change an invoice''s status (attempted % → %).',
      old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invoice_transition_perms on public.invoices;
create trigger trg_invoice_transition_perms before update on public.invoices
  for each row execute function app.enforce_invoice_transition_perms();

-- ----------------------------------------------------------------------------
-- Overpayment guard: total non-void payments may never exceed the invoice total.
-- (No credit/overpayment workflow exists yet; when one is added this relaxes.)
-- ----------------------------------------------------------------------------
create or replace function app.enforce_no_overpayment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_total numeric(14,4); v_paid numeric(14,4);
begin
  if tg_op in ('INSERT','UPDATE') and coalesce(new.voided,false) = false then
    select total into v_total from public.invoices where id = new.invoice_id;
    select coalesce(sum(amount),0) into v_paid
      from public.payments
     where invoice_id = new.invoice_id and voided = false and id <> new.id;
    if v_paid + new.amount > v_total then
      raise exception 'Payment of % exceeds the remaining balance (total %, already paid %).',
        new.amount, v_total, v_paid using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_no_overpayment on public.payments;
create trigger trg_no_overpayment before insert or update on public.payments
  for each row execute function app.enforce_no_overpayment();

-- ----------------------------------------------------------------------------
-- app.save_order_draft — create or replace a draft invoice with snapshots.
-- ----------------------------------------------------------------------------
create or replace function app.save_order_draft(
  p_invoice     uuid,        -- null → create
  p_client      uuid,
  p_selected_model uuid,     -- explicitly chosen model (null → use client default)
  p_currency    char(3),
  p_shipping    numeric,
  p_fees        numeric,
  p_tax_rate    numeric,
  p_discount    numeric,
  p_notes       text,
  p_lines       jsonb,       -- [{product_id, quantity, manual_price?, manual_reason?}]
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
begin
  if not app.is_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Client must exist; reps may only build orders for clients in their own book.
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

  -- Sales rep is derived from the client (a rep can never reassign an order).
  v_rep := coalesce(v_client.assigned_rep_id, p_actor);
  select full_name into v_rep_name from public.profiles where id = v_rep;

  -- Effective pricing model (header snapshot). Explicit selection wins; else the
  -- client's assigned/default model. Must be an active sheet the caller can see.
  v_sheet := coalesce(p_selected_model, v_client.default_pricing_sheet_id);
  if v_sheet is not null then
    select name into v_sheet_name from public.pricing_sheets
      where id = v_sheet and status = 'active';
    if v_sheet_name is null then
      raise exception 'Selected pricing model is not active or does not exist.';
    end if;
  end if;

  -- Client snapshot frozen onto the order (name, addresses, contact, terms).
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
    -- New draft. A DRAFT-scoped number keeps the row unique without consuming an
    -- AUR number; the real AUR-#### is allocated only at issue time.
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
    -- Editing an existing draft. Must be a draft the caller may touch.
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
    -- Replace line items wholesale (draft lock permits this).
    delete from public.invoice_items where invoice_id = v_id;
    perform app.record_activity('invoice', v_id, 'draft_updated',
      'Draft updated', jsonb_build_object('client_id', p_client));
  end if;

  -- ---- Line items: snapshot product + resolve price server-side --------------
  for r in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pid    := nullif(r->>'product_id','')::uuid;
    v_qty    := coalesce(nullif(r->>'quantity','')::numeric, 0);
    v_manual := nullif(r->>'manual_price','')::numeric;
    v_reason := nullif(btrim(r->>'manual_reason'),'');

    if v_pid is null then raise exception 'Each line item requires a product.'; end if;
    if v_qty <= 0 then raise exception 'Each line item requires a quantity greater than zero.'; end if;

    select id, sku, name, strength, pack_size, manufacturer_id, current_true_cost, status
      into v_prod from public.products where id = v_pid;
    if v_prod.id is null then raise exception 'Product % not found.', v_pid; end if;
    if v_prod.status <> 'active' then
      raise exception 'Product % (%) is not active and cannot be ordered.', v_prod.sku, v_prod.name;
    end if;

    -- Always resolve the catalog price (the "what it would be" figure), so an
    -- override can record what it replaced.
    v_res := app.resolve_price(p_client, v_pid, v_qty, v_cur, p_selected_model, current_date, null, null);

    if v_manual is not null then
      -- Authorized manual override: Owner/Admin only, reason required.
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
      price_source, price_source_sheet, manual_reason)
    values (
      v_id, v_pid, v_prod.sku, v_prod.name, v_prod.strength, v_prod.pack_size,
      (select name from public.manufacturers where id = v_prod.manufacturer_id),
      v_qty, v_unit, coalesce(v_prod.current_true_cost,0), v_overridden, v_original,
      v_source, v_source_sheet, v_reason);
  end loop;

  -- Ensure header rollups reflect the final header pass-throughs + items.
  perform app.recalc_invoice(v_id);

  -- A discount may not exceed the product subtotal (keeps total = subtotal −
  -- discount + shipping + fees + tax an exact identity; recalc also clamps).
  select subtotal into v_subtotal from public.invoices where id = v_id;
  if coalesce(p_discount,0) > coalesce(v_subtotal,0) then
    raise exception 'Discount (%) cannot exceed the product subtotal (%).', p_discount, v_subtotal;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.issue_invoice — allocate the AUR number, set dates, draft → sent.
-- ----------------------------------------------------------------------------
create or replace function app.issue_invoice(p_invoice uuid, p_issue_date date, p_due_date date, p_actor uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_number text;
  v_issue date := coalesce(p_issue_date, current_date);
  v_due date := p_due_date;
  v_terms text;
  v_items int;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may issue invoices.' using errcode = '42501';
  end if;

  select * into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'Invoice not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft orders can be issued (status %).', v.status; end if;
  if v.client_id is null then raise exception 'An order needs a client before it can be issued.'; end if;

  select count(*) into v_items from public.invoice_items where invoice_id = p_invoice;
  if v_items = 0 then raise exception 'An order needs at least one line item before it can be issued.'; end if;

  -- Derive due date from the client's snapshotted payment terms when not supplied.
  if v_due is null then
    v_terms := coalesce(v.client_snapshot->>'payment_terms', 'net_30');
    v_due := v_issue + case v_terms
      when 'due_on_receipt' then 0
      when 'net_15' then 15
      when 'net_45' then 45
      when 'net_60' then 60
      when 'net_30' then 30
      else 30 end;
  end if;

  v_number := app.next_invoice_number();

  -- Single UPDATE: number/date changes are permitted while old.status is still
  -- draft; the status flip to 'sent' engages the immutability lock thereafter.
  update public.invoices
     set invoice_number = v_number, issue_date = v_issue, due_date = v_due, status = 'sent'
   where id = p_invoice and status = 'draft';

  -- Guard a concurrent issue/mutation between the checks above and this UPDATE.
  -- If nothing changed, the whole function (incl. the number allocation above)
  -- rolls back, so the AUR number is not consumed.
  if not found then
    raise exception 'Order % is no longer a draft and cannot be issued.', p_invoice;
  end if;

  return v_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.record_payment — append a customer payment (rollup advances status).
-- ----------------------------------------------------------------------------
create or replace function app.record_payment(
  p_invoice uuid, p_amount numeric, p_method payment_method,
  p_reference text, p_received_at timestamptz, p_note text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_pid uuid;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may record payments.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment amount must be greater than zero.';
  end if;

  select * into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'Invoice not found.'; end if;
  if v.status = 'draft' then raise exception 'Issue the invoice before recording a payment.'; end if;
  if v.status = 'void'  then raise exception 'Cannot record a payment against a void invoice.'; end if;
  if v.status = 'paid'  then raise exception 'This invoice is already paid in full.'; end if;

  insert into public.payments(invoice_id, amount, method, reference, received_at, note, created_by)
  values (p_invoice, p_amount, coalesce(p_method,'wire'), nullif(btrim(p_reference),''),
          coalesce(p_received_at, now()), nullif(btrim(p_note),''), p_actor)
  returning id into v_pid;
  return v_pid;  -- overpayment guard + rollup trigger handle validation & status
end;
$$;

-- ----------------------------------------------------------------------------
-- app.void_invoice — reason-required void of an issued invoice.
-- ----------------------------------------------------------------------------
create or replace function app.void_invoice(p_invoice uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may void invoices.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required to void an invoice.';
  end if;

  select * into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'Invoice not found.'; end if;
  if v.status = 'void' then raise exception 'Invoice is already void.'; end if;
  if v.status = 'draft' then raise exception 'Delete the draft instead of voiding it.'; end if;

  update public.invoices set status = 'void' where id = p_invoice;
  -- Attach the reason to the status-history row the log trigger just wrote.
  update public.invoice_status_history
     set note = p_reason
   where invoice_id = p_invoice and to_status = 'void'
     and created_at = (select max(created_at) from public.invoice_status_history
                        where invoice_id = p_invoice and to_status = 'void');
  perform app.record_activity('invoice', p_invoice, 'voided',
    'Invoice ' || v.invoice_number || ' voided',
    jsonb_build_object('client_id', v.client_id, 'reason', p_reason));
end;
$$;

-- ----------------------------------------------------------------------------
-- Internal order expenses (never customer-facing).
-- ----------------------------------------------------------------------------
create or replace function app.add_order_expense(
  p_invoice uuid, p_type order_expense_type, p_amount numeric, p_note text, p_incurred_on date, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_exists boolean;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may manage order expenses.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Expense amount must be zero or greater.'; end if;
  select true into v_exists from public.invoices where id = p_invoice;
  if not coalesce(v_exists,false) then raise exception 'Invoice not found.'; end if;

  insert into public.order_expenses(invoice_id, type, amount, note, incurred_on, created_by)
  values (p_invoice, coalesce(p_type,'other'), p_amount, nullif(btrim(p_note),''),
          coalesce(p_incurred_on, current_date), p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.delete_order_expense(p_expense uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may manage order expenses.' using errcode = '42501';
  end if;
  delete from public.order_expenses where id = p_expense;
end;
$$;

-- ----------------------------------------------------------------------------
-- PUBLIC wrappers (auth checks live in the app.* bodies above; these bind
-- auth.uid() as the actor and are the only order functions exposed to the API).
-- ----------------------------------------------------------------------------
create or replace function public.save_order_draft(
  p_invoice uuid, p_client uuid, p_selected_model uuid, p_currency text,
  p_shipping numeric, p_fees numeric, p_tax_rate numeric, p_discount numeric,
  p_notes text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.save_order_draft(p_invoice, p_client, p_selected_model, coalesce(p_currency,'USD')::char(3),
    p_shipping, p_fees, p_tax_rate, p_discount, p_notes, p_lines, auth.uid());
end; $$;

create or replace function public.issue_invoice(p_invoice uuid, p_issue_date date, p_due_date date)
returns text language plpgsql security definer set search_path = public as $$
begin return app.issue_invoice(p_invoice, p_issue_date, p_due_date, auth.uid()); end; $$;

create or replace function public.record_payment(
  p_invoice uuid, p_amount numeric, p_method text, p_reference text, p_received_at timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.record_payment(p_invoice, p_amount, coalesce(p_method,'wire')::payment_method,
    p_reference, p_received_at, p_note, auth.uid());
end; $$;

create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.void_invoice(p_invoice, p_reason, auth.uid()); end; $$;

create or replace function public.add_order_expense(
  p_invoice uuid, p_type text, p_amount numeric, p_note text, p_incurred_on date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.add_order_expense(p_invoice, coalesce(p_type,'other')::order_expense_type,
    p_amount, p_note, p_incurred_on, auth.uid());
end; $$;

create or replace function public.delete_order_expense(p_expense uuid)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.delete_order_expense(p_expense, auth.uid()); end; $$;

-- Discard a DRAFT order (only drafts; issued invoices must be voided, never deleted).
-- Staff may delete their own draft; admins may delete any draft.
create or replace function public.delete_draft(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not app.is_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  select id, status, sales_rep_id into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'Order not found.'; end if;
  if v.status <> 'draft' then raise exception 'Only draft orders can be deleted. Void issued invoices instead.'; end if;
  if not app.is_admin() and v.sales_rep_id is distinct from auth.uid() then
    raise exception 'You may only delete your own drafts.' using errcode = '42501';
  end if;
  delete from public.invoices where id = p_invoice and status = 'draft';
end; $$;

revoke all on function
  public.save_order_draft(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,jsonb),
  public.issue_invoice(uuid,date,date),
  public.record_payment(uuid,numeric,text,text,timestamptz,text),
  public.void_invoice(uuid,text),
  public.add_order_expense(uuid,text,numeric,text,date),
  public.delete_order_expense(uuid),
  public.delete_draft(uuid)
from public, anon;

grant execute on function
  public.save_order_draft(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,jsonb),
  public.issue_invoice(uuid,date,date),
  public.record_payment(uuid,numeric,text,text,timestamptz,text),
  public.void_invoice(uuid,text),
  public.add_order_expense(uuid,text,numeric,text,date),
  public.delete_order_expense(uuid),
  public.delete_draft(uuid)
to authenticated;
