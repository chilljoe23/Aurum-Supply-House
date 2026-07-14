-- ============================================================================
-- Aurum Supply House · 0050 · Purchasing (POs, items, attachments, history)
-- ============================================================================

create table if not exists public.purchase_orders (
  id                   uuid primary key default gen_random_uuid(),
  po_number            text not null unique,
  manufacturer_id      uuid references public.manufacturers(id) on delete restrict,
  manufacturer_snapshot jsonb not null default '{}'::jsonb,
  status               po_status not null default 'draft',
  currency             char(3) not null default 'USD',
  fx_rate              numeric(18,8) not null default 1 check (fx_rate > 0),
  subtotal             numeric(14,4) not null default 0,
  shipping             numeric(14,4) not null default 0,
  fees                 numeric(14,4) not null default 0,
  tax                  numeric(14,4) not null default 0,
  total                numeric(14,4) not null default 0,
  deposit_amount       numeric(14,4) not null default 0 check (deposit_amount >= 0),
  -- Payment tracking is a ledger (manufacturer_payments), NOT a status.
  -- These two are maintained by trigger from that ledger.
  amount_paid          numeric(14,4) not null default 0,
  balance_due          numeric(14,4) not null default 0,
  expected_date        date,
  notes                text,
  sent_at              timestamptz,
  confirmed_at         timestamptz,
  received_at          timestamptz,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_po_manufacturer on public.purchase_orders(manufacturer_id);
create index if not exists idx_po_status       on public.purchase_orders(status);

drop trigger if exists trg_po_touch on public.purchase_orders;
create trigger trg_po_touch before update on public.purchase_orders
  for each row execute function app.touch_updated_at();

create table if not exists public.purchase_order_items (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  product_id         uuid references public.products(id) on delete set null,
  sku                text not null,        -- snapshot
  name               text not null,        -- snapshot
  quantity           numeric(14,4) not null check (quantity > 0),
  unit_cost          numeric(14,4) not null check (unit_cost >= 0),
  line_total         numeric(14,4) not null default 0,
  received_cost_logged boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_po_items_po on public.purchase_order_items(purchase_order_id);

create table if not exists public.purchase_order_attachments (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  type               po_attachment_type not null default 'other',
  filename           text not null,
  storage_path       text not null,
  uploaded_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_po_attach_po on public.purchase_order_attachments(purchase_order_id);

create table if not exists public.purchase_order_status_history (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  from_status        po_status,
  to_status          po_status not null,
  note               text,
  changed_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_po_hist_po on public.purchase_order_status_history(purchase_order_id, created_at);

-- Recompute PO line total and roll up header totals.
create or replace function app.recalc_po_line()
returns trigger language plpgsql as $$
begin
  new.line_total := app.money_round(new.quantity * new.unit_cost, 4);
  return new;
end;
$$;
drop trigger if exists trg_po_line_calc on public.purchase_order_items;
create trigger trg_po_line_calc before insert or update on public.purchase_order_items
  for each row execute function app.recalc_po_line();

create or replace function app.recalc_po_header()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set subtotal    = coalesce(s.sub, 0),
         total       = coalesce(s.sub, 0) + po.shipping + po.fees + po.tax,
         balance_due = (coalesce(s.sub, 0) + po.shipping + po.fees + po.tax) - po.amount_paid
    from (select sum(line_total) sub from public.purchase_order_items where purchase_order_id = v_po) s
   where po.id = v_po;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_po_header_calc on public.purchase_order_items;
create trigger trg_po_header_calc after insert or update or delete on public.purchase_order_items
  for each row execute function app.recalc_po_header();

-- Record status transitions into history.
create or replace function app.log_po_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.purchase_order_status_history(purchase_order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  elsif (tg_op = 'INSERT') then
    insert into public.purchase_order_status_history(purchase_order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_status_log on public.purchase_orders;
create trigger trg_po_status_log after insert or update on public.purchase_orders
  for each row execute function app.log_po_status();

-- ----------------------------------------------------------------------------
-- manufacturer_payments : ledger of what Aurum has paid a manufacturer for a PO
-- Tracked separately from PO status. refund_credit rows carry a negative effect.
-- ----------------------------------------------------------------------------
create table if not exists public.manufacturer_payments (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  type               manufacturer_payment_type not null default 'deposit',
  amount             numeric(14,4) not null check (amount > 0),  -- always positive; type drives sign
  payment_date       date not null default current_date,
  method             payment_method not null default 'wire',
  reference          text,
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_mfr_payments_po on public.manufacturer_payments(purchase_order_id);

-- Roll payments into the PO. Deposit/balance/additional add to paid;
-- refund_credit subtracts (money came back / was credited).
create or replace function app.recalc_po_payments()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
  v_paid numeric(14,4);
  v_total numeric(14,4);
begin
  select coalesce(sum(case when type = 'refund_credit' then -amount else amount end), 0)
    into v_paid
    from public.manufacturer_payments where purchase_order_id = v_po;

  select total into v_total from public.purchase_orders where id = v_po;

  update public.purchase_orders
     set amount_paid = v_paid,
         balance_due = coalesce(v_total,0) - v_paid
   where id = v_po;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_mfr_payment_rollup on public.manufacturer_payments;
create trigger trg_mfr_payment_rollup after insert or update or delete on public.manufacturer_payments
  for each row execute function app.recalc_po_payments();
