-- ============================================================================
-- Aurum Supply House · 0320 · M6 · Purchase-order schema completion (ADDITIVE)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Completes the baseline purchasing scaffold from 0050 for the full
-- M6 workflow, WITHOUT rewriting 0001–0300. Adds:
--   • a permanent per-line manufacturer cost SNAPSHOT (so later cost-file edits
--     never change an existing PO)
--   • attachment metadata (file type / size / note)
--   • a header payment-terms field
--   • receiving structure (shipments + per-line receipts) that inventory / lot
--     allocation can extend later without redesign
--   • branded PO numbering (PO-#### via app_settings.po_prefix)
--   • a status-transition STATE MACHINE + sent-PO immutability locks
--   • manufacturer-payment overpayment / duplicate guards
--
-- The existing 0050 triggers (recalc_po_line, recalc_po_header, log_po_status,
-- recalc_po_payments) are preserved and continue to maintain money rollups.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · purchase_order_items — permanent manufacturer-cost snapshot columns.
--     Everything the resolver (app.resolve_manufacturer_cost, 0280) returned at
--     save time is frozen onto the line. Later manufacturer_cost_history changes
--     can NEVER retroactively alter a saved PO line.
-- ----------------------------------------------------------------------------
alter table public.purchase_order_items
  add column if not exists manufacturer_id             uuid references public.manufacturers(id) on delete set null,
  add column if not exists manufacturer_product_id     uuid references public.manufacturer_products(id) on delete set null,
  add column if not exists manufacturer_cost_history_id uuid references public.manufacturer_cost_history(id) on delete set null,
  add column if not exists manufacturer_sku            text,
  add column if not exists manufacturer_description     text,
  add column if not exists strength                    text,   -- product snapshot
  add column if not exists pack_size                   text,   -- product snapshot
  add column if not exists currency                    char(3) not null default 'USD',
  add column if not exists resolved_cost_source        text,   -- 'base' | 'tier' | 'manual'
  add column if not exists resolved_tier_min           int,
  add column if not exists resolved_tier_max           int,
  add column if not exists moq                         int,
  add column if not exists order_multiple              int,
  add column if not exists lead_time_days              int,
  add column if not exists cost_reason                 text,   -- required when source = 'manual'
  add column if not exists created_by                  uuid references public.profiles(id) on delete set null;

create index if not exists idx_po_items_manufacturer_product
  on public.purchase_order_items(manufacturer_product_id);

-- ----------------------------------------------------------------------------
-- 2 · purchase_order_attachments — file metadata + note. `type` already carries
--     the category (manufacturer_invoice | coa | packing_list | testing_document
--     | shipping_document | tracking | other=general). created_at is the upload
--     timestamp; uploaded_by is the actor.
-- ----------------------------------------------------------------------------
alter table public.purchase_order_attachments
  add column if not exists file_type  text,
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  add column if not exists note       text;

-- ----------------------------------------------------------------------------
-- 3 · purchase_orders — supplier payment terms (free text, e.g. "50% deposit,
--     balance before shipment"). Aurum's ship-to is its own company address
--     (app_settings) resolved at document time, so no ship-to column is stored.
-- ----------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists payment_terms text;

-- ----------------------------------------------------------------------------
-- 4 · Receiving structure — shipments + per-line receipts. Deliberately kept
--     minimal (no stock ledger yet) but shaped so lot allocation / inventory can
--     be layered on later: a receipt already records quantity + optional lot.
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_order_shipments (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  carrier               text,
  tracking_number       text,
  ship_date             date,
  expected_arrival_date date,
  received_date         date,
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_po_shipments_po on public.purchase_order_shipments(purchase_order_id, created_at);

drop trigger if exists trg_po_shipments_touch on public.purchase_order_shipments;
create trigger trg_po_shipments_touch before update on public.purchase_order_shipments
  for each row execute function app.touch_updated_at();

create table if not exists public.purchase_order_receipts (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  shipment_id           uuid references public.purchase_order_shipments(id) on delete set null,
  quantity_received     numeric(14,4) not null check (quantity_received > 0),
  received_date         date not null default current_date,
  lot_number            text,          -- lot-allocation-ready (not inventory yet)
  notes                 text,
  received_by           uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_po_receipts_po   on public.purchase_order_receipts(purchase_order_id);
create index if not exists idx_po_receipts_item on public.purchase_order_receipts(purchase_order_item_id);

-- ----------------------------------------------------------------------------
-- 5 · Branded PO numbering — PO-#### (mirrors app.next_invoice_number, 0180).
--     Drafts keep a throwaway PODRAFT-… number; the real PO number is allocated
--     only when the PO is sent, so cancelled drafts never consume a number.
-- ----------------------------------------------------------------------------
insert into public.document_sequences(key, next_value) values ('purchase_order_aur', 1001)
on conflict (key) do nothing;

create or replace function app.next_po_number()
returns text language plpgsql security definer set search_path = public as $$
declare v_num bigint; v_prefix text;
begin
  select coalesce(nullif(btrim(po_prefix), ''), 'PO') into v_prefix from public.app_settings where id = true;
  update public.document_sequences set next_value = next_value + 1
   where key = 'purchase_order_aur' returning next_value - 1 into v_num;
  if v_num is null then
    insert into public.document_sequences(key, next_value) values ('purchase_order_aur', 1002)
    on conflict (key) do update set next_value = document_sequences.next_value + 1
    returning next_value - 1 into v_num;
  end if;
  return coalesce(v_prefix, 'PO') || '-' || v_num::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6 · Status-transition STATE MACHINE (enforced at the DB layer).
--     Forward-stepwise lifecycle with two branch points (confirmed→deposit_paid
--     or straight to production; deposit_paid→production). Void is allowed only
--     from pre-receipt states. received→closed is the only terminal step; closed
--     and void are terminal. Illegal moves raise 23514.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_po_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'closed' then
      raise exception 'A closed purchase order is final; its status cannot change.' using errcode = '23514';
    elsif old.status = 'void' then
      raise exception 'A void purchase order cannot be reactivated.' using errcode = '23514';
    elsif not (
         (old.status = 'draft'         and new.status in ('sent','void'))
      or (old.status = 'sent'          and new.status in ('confirmed','void'))
      or (old.status = 'confirmed'     and new.status in ('deposit_paid','production','void'))
      or (old.status = 'deposit_paid'  and new.status in ('production','void'))
      or (old.status = 'production'    and new.status in ('testing','void'))
      or (old.status = 'testing'       and new.status in ('ready_to_ship','void'))
      or (old.status = 'ready_to_ship' and new.status in ('shipped','void'))
      or (old.status = 'shipped'       and new.status in ('received','void'))
      or (old.status = 'received'      and new.status in ('closed'))
    ) then
      raise exception 'Invalid purchase-order transition (% → %).', old.status, new.status using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_transition on public.purchase_orders;
create trigger trg_po_transition before update on public.purchase_orders
  for each row execute function app.enforce_po_transition();

-- ----------------------------------------------------------------------------
-- 7 · Immutability lock — once a PO leaves draft, its money & sourcing are
--     frozen (mirrors app.enforce_invoice_lock, 0060/0190). Status, payment
--     rollups, dates, tracking and notes remain mutable so the workflow runs.
--     A non-draft PO can never be deleted (void it instead).
-- ----------------------------------------------------------------------------
create or replace function app.enforce_po_lock()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    if old.status <> 'draft' then
      raise exception 'Purchase order % is % and cannot be deleted. Void it instead.', old.po_number, old.status;
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if ( new.subtotal        is distinct from old.subtotal
      or new.total           is distinct from old.total
      or new.tax             is distinct from old.tax
      or new.shipping        is distinct from old.shipping
      or new.fees            is distinct from old.fees
      or new.currency        is distinct from old.currency
      or new.fx_rate         is distinct from old.fx_rate
      or new.manufacturer_id is distinct from old.manufacturer_id
      or new.manufacturer_snapshot is distinct from old.manufacturer_snapshot
      or new.po_number       is distinct from old.po_number ) then
      raise exception 'Purchase order % is locked (status %). Financial fields and sourcing cannot change.',
        old.po_number, old.status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_po_lock on public.purchase_orders;
create trigger trg_po_lock before update or delete on public.purchase_orders
  for each row execute function app.enforce_po_lock();

-- Lock line items whenever the parent PO is not draft (cost snapshots are frozen).
create or replace function app.enforce_po_items_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status po_status;
begin
  select status into v_status from public.purchase_orders
    where id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Cannot modify line items of a % purchase order. Cost snapshots are frozen once sent.', v_status;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_po_items_lock on public.purchase_order_items;
create trigger trg_po_items_lock before insert or update or delete on public.purchase_order_items
  for each row execute function app.enforce_po_items_lock();

-- ----------------------------------------------------------------------------
-- 8 · Manufacturer-payment guards (mirror invoice payment guards, 0200/0240).
--     • No overpayment: non-refund payments may never push net paid above the PO
--       total; a refund/credit may never push net paid below zero.
--     • No duplicate: an identical (type, amount, method, reference, date) entry
--       within 2 minutes is rejected as a double-submit.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_no_mfr_overpayment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_total numeric(14,4); v_net numeric(14,4); v_delta numeric(14,4);
begin
  select total into v_total from public.purchase_orders where id = new.purchase_order_id;
  select coalesce(sum(case when type = 'refund_credit' then -amount else amount end), 0)
    into v_net
    from public.manufacturer_payments
   where purchase_order_id = new.purchase_order_id and id <> new.id;
  v_delta := case when new.type = 'refund_credit' then -new.amount else new.amount end;
  if new.type = 'refund_credit' then
    if v_net + v_delta < 0 then
      raise exception 'Refund/credit of % exceeds the amount paid to date (net paid %).',
        new.amount, v_net using errcode = '23514';
    end if;
  else
    if v_net + v_delta > coalesce(v_total,0) then
      raise exception 'Payment of % exceeds the remaining balance (PO total %, net paid %).',
        new.amount, v_total, v_net using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_no_mfr_overpayment on public.manufacturer_payments;
create trigger trg_no_mfr_overpayment before insert or update on public.manufacturer_payments
  for each row execute function app.enforce_no_mfr_overpayment();

create or replace function app.enforce_no_duplicate_mfr_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dupe uuid;
begin
  select id into v_dupe from public.manufacturer_payments
   where purchase_order_id = new.purchase_order_id
     and type = new.type
     and amount = new.amount
     and coalesce(method, 'wire') = coalesce(new.method, 'wire')
     and coalesce(reference, '') = coalesce(new.reference, '')
     and payment_date = new.payment_date
     and id <> new.id
     and created_at > now() - interval '2 minutes'
   limit 1;
  if v_dupe is not null then
    raise exception 'A matching manufacturer payment was just recorded. Refusing a probable duplicate submission.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_no_duplicate_mfr_payment on public.manufacturer_payments;
create trigger trg_no_duplicate_mfr_payment before insert on public.manufacturer_payments
  for each row execute function app.enforce_no_duplicate_mfr_payment();

comment on table public.purchase_order_shipments is
  'PO tracking / shipping records. Receiving-ready; a future inventory module can extend receipts.';
comment on table public.purchase_order_receipts is
  'Per-line goods receipts (quantity + optional lot). Structured for later lot allocation / inventory.';
comment on column public.purchase_order_items.resolved_cost_source is
  'How the frozen unit_cost was resolved at save time: base | tier | manual. Never a customer selling price.';
