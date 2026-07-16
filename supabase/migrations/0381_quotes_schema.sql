-- ============================================================================
-- Aurum Supply House · 0381 · Quotes · Schema, money math, lifecycle, locks
-- ----------------------------------------------------------------------------
-- ADDITIVE. The quote tables reuse the exact snapshot + immutability idioms the
-- approved Invoice/PO modules use, but a quote is CUSTOMER-FACING ONLY: it stores
-- no true cost, gross profit, margin, commission, or internal expense — those
-- fields simply do not exist here, so they can never leak through a view, export,
-- or document. Money math mirrors app.recalc_invoice (0190) minus the internal
-- economics: net_sales = subtotal − discount; tax = net_sales × rate; total =
-- net_sales + shipping + fees + tax. Half-up rounding via app.money_round.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- quotes — header. A quote permanently snapshots the client identity, addresses,
-- representative, pricing model, currency, terms and totals at save time, so later
-- changes to clients / catalog / pricing never alter an existing quote.
-- ----------------------------------------------------------------------------
create table if not exists public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  quote_number       text not null unique,                 -- QDRAFT-… until sent, then QTE-####
  client_id          uuid references public.clients(id) on delete restrict,
  client_snapshot    jsonb not null default '{}'::jsonb,   -- name, contact, terms, billing + shipping address
  sales_rep_id       uuid references public.profiles(id) on delete set null,
  sales_rep_name     text,                                 -- snapshot
  pricing_sheet_id   uuid references public.pricing_sheets(id) on delete set null,
  pricing_sheet_name text,                                 -- snapshot
  status             quote_status not null default 'draft',

  -- Customer-facing money (the only money a quote carries)
  currency           char(3) not null default 'USD',
  subtotal           numeric(14,4) not null default 0,     -- Σ line_subtotal
  discount           numeric(14,4) not null default 0 check (discount >= 0),
  shipping           numeric(14,4) not null default 0 check (shipping >= 0),
  fees               numeric(14,4) not null default 0 check (fees >= 0),
  tax_rate           numeric(9,6)  not null default 0 check (tax_rate >= 0),
  tax_amount         numeric(14,4) not null default 0,
  total              numeric(14,4) not null default 0,     -- net_sales + shipping + fees + tax

  payment_terms      payment_terms not null default 'net_30',
  customer_reference text,                                 -- customer PO / reference
  notes              text,                                 -- customer-facing quote notes/terms

  quote_date         date not null default current_date,
  expiration_date    date,                                 -- validity window; enforced deterministically

  -- Lifecycle bookkeeping (all customer-facing / non-sensitive)
  sent_at            timestamptz,
  accepted_at        timestamptz,
  declined_at        timestamptz,
  expired_at         timestamptz,
  voided_at          timestamptz,
  converted_at       timestamptz,
  converted_order_id uuid references public.invoices(id) on delete set null,  -- quote → order link

  pdf_path           text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_quotes_client on public.quotes(client_id);
create index if not exists idx_quotes_rep    on public.quotes(sales_rep_id);
create index if not exists idx_quotes_status on public.quotes(status);
create index if not exists idx_quotes_date   on public.quotes(quote_date);
create index if not exists idx_quotes_expiry on public.quotes(expiration_date);
create index if not exists idx_quotes_converted_order on public.quotes(converted_order_id);

drop trigger if exists trg_quotes_touch on public.quotes;
create trigger trg_quotes_touch before update on public.quotes
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- quote_items — line snapshot. Carries the selling price and its resolution
-- provenance (source / model / manual reason) for internal transparency, but NO
-- cost. price_source is an internal diagnostic surfaced only to staff views —
-- never on the customer document.
-- ----------------------------------------------------------------------------
create table if not exists public.quote_items (
  id                  uuid primary key default gen_random_uuid(),
  quote_id            uuid not null references public.quotes(id) on delete cascade,
  product_id          uuid references public.products(id) on delete set null,
  sku                 text not null,        -- snapshot
  product_name        text not null,        -- snapshot
  strength            text,                 -- snapshot
  pack_size           text,                 -- snapshot
  manufacturer_name   text,                 -- snapshot
  currency            char(3) not null default 'USD',
  quantity            numeric(14,4) not null check (quantity > 0),
  unit_price          numeric(14,4) not null check (unit_price >= 0),
  price_source        text,                 -- client_override|selected_model|assigned_model|default_model|manual|quote_retained
  price_source_sheet  text,                 -- pricing model name that priced this line (if any)
  price_overridden    boolean not null default false,
  original_unit_price numeric(14,4),        -- resolved price an override/retain replaced (context)
  manual_reason       text,                 -- required when price_overridden = true
  created_at          timestamptz not null default now()
);
create index if not exists idx_quote_items_quote on public.quote_items(quote_id);

create table if not exists public.quote_status_history (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  from_status quote_status,
  to_status   quote_status not null,
  note        text,
  changed_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_quote_hist on public.quote_status_history(quote_id, created_at);

-- ----------------------------------------------------------------------------
-- Order-side linkage (order → quote). ADDITIVE columns on invoices; existing rows
-- get NULL and no approved invoice behavior, calculation, permission, or layout
-- changes. A partial UNIQUE index enforces AT MOST ONE order per quote at the DB
-- layer (idempotent conversion, no duplicate orders).
-- ----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists source_quote_id     uuid references public.quotes(id) on delete set null,
  add column if not exists source_quote_number text;

create unique index if not exists uq_invoices_source_quote
  on public.invoices(source_quote_id) where source_quote_id is not null;

comment on column public.invoices.source_quote_id is
  'The accepted quote this order was converted from (order → quote link). Unique: one order per quote.';

-- ----------------------------------------------------------------------------
-- Header recalculation (customer-facing money only — no cost/profit).
-- quote_items intentionally has no persisted line_subtotal column (kept lean);
-- the line total = quantity × unit_price is derived in v_quote_items and summed
-- directly here. Full header rollup is idempotent; safe to call repeatedly.
-- ----------------------------------------------------------------------------
create or replace function app.recalc_quote(p_quote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric(14,4);
  v_tax_rate numeric(9,6);
  v_shipping numeric(14,4);
  v_fees numeric(14,4);
  v_discount numeric(14,4);
  v_net_sales numeric(14,4);
  v_tax numeric(14,4);
  v_total numeric(14,4);
begin
  select coalesce(sum(app.money_round(quantity * unit_price, 4)), 0)
    into v_sub
    from public.quote_items where quote_id = p_quote;

  select tax_rate, shipping, fees, discount
    into v_tax_rate, v_shipping, v_fees, v_discount
    from public.quotes where id = p_quote;

  -- Discount cannot exceed product sales (clamp so net_sales/total never go negative).
  v_discount  := least(coalesce(v_discount,0), v_sub);
  v_net_sales := v_sub - v_discount;

  v_tax   := app.money_round(v_net_sales * coalesce(v_tax_rate,0), 2);
  v_total := v_net_sales + coalesce(v_shipping,0) + coalesce(v_fees,0) + v_tax;

  update public.quotes
     set subtotal   = v_sub,
         tax_amount = v_tax,
         total      = v_total
   where id = p_quote;
end;
$$;

-- Recompute the header when line items change.
create or replace function app.trg_recalc_quote_from_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.recalc_quote(coalesce(new.quote_id, old.quote_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_quote_header_calc on public.quote_items;
create trigger trg_quote_header_calc after insert or update or delete on public.quote_items
  for each row execute function app.trg_recalc_quote_from_items();

-- Recompute when header pass-throughs change while still a draft.
create or replace function app.trg_recalc_quote_from_header()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.tax_rate is distinct from old.tax_rate
      or new.shipping is distinct from old.shipping
      or new.fees is distinct from old.fees
      or new.discount is distinct from old.discount) then
    perform app.recalc_quote(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_header_recalc on public.quotes;
create trigger trg_quote_header_recalc after update on public.quotes
  for each row execute function app.trg_recalc_quote_from_header();

-- ----------------------------------------------------------------------------
-- Lifecycle STATE MACHINE (enforced at the DB layer; illegal moves raise 23514).
--   draft     → sent | void
--   sent      → accepted | declined | expired | void
--   accepted  → converted
--   declined / expired / converted / void are terminal.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_quote_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status in ('declined','expired','converted','void') then
      raise exception 'Quote % is % and cannot change status.', old.quote_number, old.status
        using errcode = '23514';
    elsif not (
         (old.status = 'draft'    and new.status in ('sent','void'))
      or (old.status = 'sent'     and new.status in ('accepted','declined','expired','void'))
      or (old.status = 'accepted' and new.status in ('converted'))
    ) then
      raise exception 'Invalid quote transition (% → %).', old.status, new.status
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_transition on public.quotes;
create trigger trg_quote_transition before update on public.quotes
  for each row execute function app.enforce_quote_transition();

-- ----------------------------------------------------------------------------
-- IMMUTABILITY LOCK — a draft is fully editable; once a quote is SENT its
-- customer-facing financial fields, parties and number are frozen (mirrors
-- app.enforce_invoice_lock, 0190). Status, lifecycle timestamps, the converted-
-- order link and the pdf path stay mutable so the workflow can run. A non-draft
-- quote can never be deleted (void it instead).
-- ----------------------------------------------------------------------------
create or replace function app.enforce_quote_lock()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    if old.status <> 'draft' then
      raise exception 'Quote % is % and cannot be deleted. Void it instead.', old.quote_number, old.status;
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if ( new.subtotal        is distinct from old.subtotal
      or new.total           is distinct from old.total
      or new.discount        is distinct from old.discount
      or new.shipping        is distinct from old.shipping
      or new.fees            is distinct from old.fees
      or new.tax_rate        is distinct from old.tax_rate
      or new.tax_amount      is distinct from old.tax_amount
      or new.currency        is distinct from old.currency
      or new.payment_terms   is distinct from old.payment_terms
      or new.client_id       is distinct from old.client_id
      or new.client_snapshot is distinct from old.client_snapshot
      or new.sales_rep_id    is distinct from old.sales_rep_id
      or new.pricing_sheet_id is distinct from old.pricing_sheet_id
      or new.quote_date      is distinct from old.quote_date
      or new.expiration_date is distinct from old.expiration_date
      or new.quote_number    is distinct from old.quote_number )
    then
      raise exception 'Quote % is locked (status %). Customer-facing financial fields cannot change.',
        old.quote_number, old.status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_lock on public.quotes;
create trigger trg_quote_lock before update or delete on public.quotes
  for each row execute function app.enforce_quote_lock();

-- Lock line items whenever the parent quote is not a draft.
create or replace function app.enforce_quote_items_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status quote_status;
begin
  select status into v_status from public.quotes
    where id = coalesce(new.quote_id, old.quote_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Cannot modify line items of a % quote.', v_status;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_quote_items_lock on public.quote_items;
create trigger trg_quote_items_lock before insert or update or delete on public.quote_items
  for each row execute function app.enforce_quote_items_lock();

-- ----------------------------------------------------------------------------
-- Status-history log + lifecycle timestamp stamping (mirrors log_invoice_status).
-- ----------------------------------------------------------------------------
create or replace function app.log_quote_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.quote_status_history(quote_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());

    if new.status = 'sent'      and new.sent_at      is null then new.sent_at      := now(); end if;
    if new.status = 'accepted'  and new.accepted_at  is null then new.accepted_at  := now(); end if;
    if new.status = 'declined'  and new.declined_at  is null then new.declined_at  := now(); end if;
    if new.status = 'expired'   and new.expired_at   is null then new.expired_at   := now(); end if;
    if new.status = 'void'      and new.voided_at    is null then new.voided_at     := now(); end if;
    if new.status = 'converted' and new.converted_at is null then new.converted_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_status_log on public.quotes;
create trigger trg_quote_status_log before update on public.quotes
  for each row execute function app.log_quote_status();

-- ----------------------------------------------------------------------------
-- Activity feed (entity_type = 'quote') + client-timeline mirror (non-sensitive
-- metadata only — NEVER any money). Mirrors the invoice activity/timeline idiom
-- (0075 / 0210) so the client detail timeline surfaces quote lifecycle events.
-- ----------------------------------------------------------------------------
create or replace function app.trg_activity_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_activity('quote', new.id, 'created',
      'Quote ' || new.quote_number || ' created', jsonb_build_object('client_id', new.client_id));
  elsif new.status is distinct from old.status then
    perform app.record_activity('quote', new.id, 'status_changed',
      'Quote ' || new.quote_number || ' → ' || new.status,
      jsonb_build_object('from', old.status, 'to', new.status, 'client_id', new.client_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_activity_quote on public.quotes;
create trigger trg_activity_quote after insert or update on public.quotes
  for each row execute function app.trg_activity_quote();

create or replace function app.trg_client_activity_from_quote()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text; v_summary text;
begin
  if new.client_id is null then return new; end if;

  if tg_op = 'INSERT' then
    v_action := 'quote_created'; v_summary := 'New quote started';
  elsif new.status is distinct from old.status then
    if new.status = 'sent' then
      v_action := 'quote_sent'; v_summary := 'Quote ' || new.quote_number || ' sent';
    elsif new.status = 'accepted' then
      v_action := 'quote_accepted'; v_summary := 'Quote ' || new.quote_number || ' accepted';
    elsif new.status = 'declined' then
      v_action := 'quote_declined'; v_summary := 'Quote ' || new.quote_number || ' declined';
    elsif new.status = 'expired' then
      v_action := 'quote_expired'; v_summary := 'Quote ' || new.quote_number || ' expired';
    elsif new.status = 'void' then
      v_action := 'quote_voided'; v_summary := 'Quote ' || new.quote_number || ' voided';
    elsif new.status = 'converted' then
      v_action := 'quote_converted'; v_summary := 'Quote ' || new.quote_number || ' converted to an order';
    else
      return new;
    end if;
  else
    return new;
  end if;

  perform app.record_activity('client', new.client_id, v_action, v_summary,
    jsonb_build_object('quote_id', new.id, 'quote_number', new.quote_number, 'status', new.status));
  return new;
end;
$$;
drop trigger if exists trg_client_activity_quote on public.quotes;
create trigger trg_client_activity_quote after insert or update on public.quotes
  for each row execute function app.trg_client_activity_from_quote();

-- ----------------------------------------------------------------------------
-- RLS access helper (mirrors app.can_access_invoice, 0080). Admins see all;
-- reps see quotes they own or for clients in their book. Security-definer so it
-- never recurses through RLS.
-- ----------------------------------------------------------------------------
create or replace function app.can_access_quote(p_quote uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_admin()
      or exists (
        select 1 from public.quotes q
        where q.id = p_quote
          and ( q.sales_rep_id = auth.uid()
             or q.client_id in (select app.rep_client_ids()) )
      );
$$;

comment on table public.quotes is
  'Customer-facing quotes. Stores selling price + snapshots only — never true cost, profit, margin, commission, or internal expense.';
