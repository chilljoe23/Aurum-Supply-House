-- ============================================================================
-- Aurum Supply House · 0060 · Orders / Invoices (with snapshot + lock)
-- ============================================================================

create table if not exists public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  invoice_number     text not null unique,
  client_id          uuid references public.clients(id) on delete restrict,
  client_snapshot    jsonb not null default '{}'::jsonb,   -- name, addresses, contact, terms
  sales_rep_id       uuid references public.profiles(id) on delete set null,
  sales_rep_name     text,                                 -- snapshot
  pricing_sheet_id   uuid references public.pricing_sheets(id) on delete set null,
  pricing_sheet_name text,                                 -- snapshot
  status             invoice_status not null default 'draft',
  -- Reserved for the future Orders lifecycle (quote → approved_order → invoice →
  -- paid → fulfilled → complete). NULL in Phase 1; status above drives behavior.
  stage              order_stage,

  -- Customer-facing money (appears on the invoice)
  currency           char(3) not null default 'USD',
  fx_rate            numeric(18,8) not null default 1 check (fx_rate > 0),
  subtotal           numeric(14,4) not null default 0,   -- product sales
  shipping           numeric(14,4) not null default 0,   -- CUSTOMER-PAID shipping revenue (not company freight)
  fees               numeric(14,4) not null default 0,   -- explicit customer-charged fee/surcharge
  tax_rate           numeric(9,6)  not null default 0 check (tax_rate >= 0),
  tax_amount         numeric(14,4) not null default 0,
  total              numeric(14,4) not null default 0,   -- subtotal + shipping + fees + tax

  -- Internal economics (never shown to customer)
  total_true_cost    numeric(14,4) not null default 0,
  gross_profit       numeric(14,4) not null default 0,   -- subtotal - total_true_cost
  gross_margin       numeric(9,6)  not null default 0,
  total_commission   numeric(14,4) not null default 0,
  total_expenses     numeric(14,4) not null default 0,   -- Σ order_expenses (processing, company freight, packaging, testing, referral, other)
  net_profit         numeric(14,4) not null default 0,   -- gross_profit - total_commission - total_expenses

  -- Payment rollups (maintained from payments)
  amount_paid        numeric(14,4) not null default 0,
  balance_due        numeric(14,4) not null default 0,

  issue_date         date,
  due_date           date,
  sent_at            timestamptz,
  paid_at            timestamptz,
  pdf_path           text,
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_invoices_rep    on public.invoices(sales_rep_id);
create index if not exists idx_invoices_status on public.invoices(status);
create index if not exists idx_invoices_issue  on public.invoices(issue_date);

drop trigger if exists trg_invoices_touch on public.invoices;
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

create table if not exists public.invoice_items (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices(id) on delete cascade,
  product_id         uuid references public.products(id) on delete set null,
  sku                text not null,        -- snapshot
  product_name       text not null,        -- snapshot
  strength           text,                 -- snapshot
  pack_size          text,                 -- snapshot
  manufacturer_name  text,                 -- snapshot
  quantity           numeric(14,4) not null check (quantity > 0),
  unit_price         numeric(14,4) not null check (unit_price >= 0),
  unit_true_cost     numeric(14,4) not null default 0 check (unit_true_cost >= 0),
  price_overridden   boolean not null default false,
  original_unit_price numeric(14,4),
  line_subtotal      numeric(14,4) not null default 0,
  line_true_cost     numeric(14,4) not null default 0,
  line_gross_profit  numeric(14,4) not null default 0,
  -- Optional lot references (future-ready; NOT inventory management).
  -- Left NULL by the Phase 1 invoice builder; populated later if/when used.
  lot_number         text,
  manufacturing_date date,
  expiration_date    date,
  retest_date        date,
  coa_path           text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_invoice_items_invoice on public.invoice_items(invoice_id);

create table if not exists public.invoice_status_history (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  from_status invoice_status,
  to_status   invoice_status not null,
  note        text,
  changed_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_inv_hist on public.invoice_status_history(invoice_id, created_at);

-- ----------------------------------------------------------------------------
-- Line + header recalculation
-- ----------------------------------------------------------------------------
create or replace function app.recalc_invoice_line()
returns trigger language plpgsql as $$
begin
  new.line_subtotal     := app.money_round(new.quantity * new.unit_price, 4);
  new.line_true_cost    := app.money_round(new.quantity * new.unit_true_cost, 4);
  new.line_gross_profit := new.line_subtotal - new.line_true_cost;
  return new;
end;
$$;
drop trigger if exists trg_inv_line_calc on public.invoice_items;
create trigger trg_inv_line_calc before insert or update on public.invoice_items
  for each row execute function app.recalc_invoice_line();

-- Full economic rollup for an invoice (idempotent; safe to call repeatedly).
create or replace function app.recalc_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric(14,4);
  v_cost numeric(14,4);
  v_comm numeric(14,4);
  v_exp  numeric(14,4);
  v_tax_rate numeric(9,6);
  v_shipping numeric(14,4);
  v_fees numeric(14,4);
  v_tax numeric(14,4);
  v_total numeric(14,4);
  v_gp numeric(14,4);
  v_margin numeric(9,6);
begin
  select coalesce(sum(line_subtotal),0), coalesce(sum(line_true_cost),0)
    into v_sub, v_cost
    from public.invoice_items where invoice_id = p_invoice;

  select coalesce(sum(amount),0) into v_comm
    from public.commissions where invoice_id = p_invoice and status <> 'void';

  -- Internal per-order expenses (payment processing, company-paid freight,
  -- packaging, testing, referral, other). Never billed to the customer.
  select coalesce(sum(amount),0) into v_exp
    from public.order_expenses where invoice_id = p_invoice;

  select tax_rate, shipping, fees into v_tax_rate, v_shipping, v_fees
    from public.invoices where id = p_invoice;

  v_tax    := app.money_round(v_sub * coalesce(v_tax_rate,0), 2);
  -- Customer-facing total = product sales + customer-paid shipping + customer fees + tax.
  v_total  := v_sub + coalesce(v_shipping,0) + coalesce(v_fees,0) + v_tax;
  v_gp     := v_sub - v_cost;                                    -- Gross Profit = product sales - true cost
  v_margin := case when v_sub > 0 then round(v_gp / v_sub, 6) else 0 end;

  update public.invoices
     set subtotal         = v_sub,
         total_true_cost  = v_cost,
         tax_amount       = v_tax,
         total            = v_total,
         gross_profit     = v_gp,
         gross_margin     = v_margin,
         total_commission = v_comm,
         total_expenses   = v_exp,
         -- Net Profit = Gross Profit - Commission - Order Expenses
         -- (expenses already include processing fees + company-paid shipping).
         net_profit       = v_gp - v_comm - v_exp,
         balance_due      = v_total - amount_paid
   where id = p_invoice;
end;
$$;

create or replace function app.trg_recalc_invoice_from_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_inv_header_calc on public.invoice_items;
create trigger trg_inv_header_calc after insert or update or delete on public.invoice_items
  for each row execute function app.trg_recalc_invoice_from_items();

-- Recalc when header-level pass-through figures change while still a draft.
create or replace function app.trg_recalc_invoice_from_header()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.tax_rate is distinct from old.tax_rate
      or new.shipping is distinct from old.shipping
      or new.fees is distinct from old.fees) then
    perform app.recalc_invoice(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_inv_header_recalc on public.invoices;
create trigger trg_inv_header_recalc after update on public.invoices
  for each row execute function app.trg_recalc_invoice_from_header();

-- ----------------------------------------------------------------------------
-- IMMUTABILITY LOCK — once out of draft, financial fields are frozen
-- ----------------------------------------------------------------------------
create or replace function app.enforce_invoice_lock()
returns trigger language plpgsql as $$
begin
  -- Deleting a non-draft invoice is never allowed (void instead).
  if (tg_op = 'DELETE') then
    if old.status <> 'draft' then
      raise exception 'Invoice % is % and cannot be deleted. Void it instead.', old.invoice_number, old.status;
    end if;
    return old;
  end if;

  -- Once the invoice has ever left draft, lock the money & parties.
  if old.status <> 'draft' then
    if ( new.subtotal        is distinct from old.subtotal
      or new.total           is distinct from old.total
      or new.total_true_cost is distinct from old.total_true_cost
      or new.gross_profit    is distinct from old.gross_profit
      or new.tax_rate        is distinct from old.tax_rate
      or new.tax_amount      is distinct from old.tax_amount
      or new.shipping        is distinct from old.shipping
      or new.fees            is distinct from old.fees
      or new.client_id       is distinct from old.client_id
      or new.client_snapshot is distinct from old.client_snapshot
      or new.sales_rep_id    is distinct from old.sales_rep_id
      or new.pricing_sheet_id is distinct from old.pricing_sheet_id
      or new.issue_date      is distinct from old.issue_date
      or new.invoice_number  is distinct from old.invoice_number )
    then
      raise exception 'Invoice % is locked (status %). Financial fields cannot change.',
        old.invoice_number, old.status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invoice_lock on public.invoices;
create trigger trg_invoice_lock before update or delete on public.invoices
  for each row execute function app.enforce_invoice_lock();

-- Lock invoice_items whenever the parent invoice is not draft.
create or replace function app.enforce_invoice_items_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status invoice_status;
begin
  select status into v_status from public.invoices
    where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Cannot modify line items of a % invoice. Void and reissue instead.', v_status;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_invoice_items_lock on public.invoice_items;
create trigger trg_invoice_items_lock before insert or update or delete on public.invoice_items
  for each row execute function app.enforce_invoice_items_lock();

-- Log invoice status transitions.
create or replace function app.log_invoice_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.invoice_status_history(invoice_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
    if new.status = 'sent' and new.sent_at is null then
      new.sent_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invoice_status_log on public.invoices;
create trigger trg_invoice_status_log before update on public.invoices
  for each row execute function app.log_invoice_status();
