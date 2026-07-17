-- ============================================================================
-- Aurum Supply House · 0396 · Fulfillment · Schema (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Three new child tables hang off the existing order (= invoice) graph. None of
-- them add or alter a column on invoices / invoice_items, so every immutability
-- lock and financial snapshot from prior milestones is untouched.
--
--   order_line_fulfillment  — one row per order line holding ONLY the manually
--                             settable operational status (default not_yet_shipped).
--                             Derived states live in views, never here.
--   order_shipments         — one row per physical shipment against an order.
--   order_shipment_items    — the per-line quantities in a shipment, with lot /
--                             mfg / exp / retest date SNAPSHOTS captured at ship
--                             time (customer-safe; no cost data anywhere).
--
-- quantity_shipped is never stored; it is SUM(order_shipment_items.quantity_shipped)
-- over FINALIZED shipments, computed in 0398's views. This makes over-/under-ship
-- and derived status deterministic and impossible to desync.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Per-line operational fulfillment status (manually settable).
--     invoice_id is denormalized for direct RLS scoping via can_access_invoice.
-- ---------------------------------------------------------------------------
create table if not exists public.order_line_fulfillment (
  invoice_item_id   uuid primary key references public.invoice_items(id) on delete cascade,
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  operational_status fulfillment_op_status not null default 'not_yet_shipped',
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_order_line_fulfillment_invoice
  on public.order_line_fulfillment(invoice_id);

drop trigger if exists trg_order_line_fulfillment_touch on public.order_line_fulfillment;
create trigger trg_order_line_fulfillment_touch before update on public.order_line_fulfillment
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2 · Shipment records (append-only after finalization).
-- ---------------------------------------------------------------------------
create table if not exists public.order_shipments (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  shipment_number   text not null unique,
  shipment_date     date not null default current_date,
  carrier           text,
  service           text,
  tracking_number   text,
  tracking_url      text,
  notes             text,                                  -- internal; never on the packing slip
  status            shipment_status not null default 'finalized',
  voided_reason     text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_order_shipments_invoice
  on public.order_shipments(invoice_id, created_at);

drop trigger if exists trg_order_shipments_touch on public.order_shipments;
create trigger trg_order_shipments_touch before update on public.order_shipments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3 · Shipment line items — quantities + lot/date SNAPSHOTS at ship time.
--     invoice_id + sku + product_name are denormalized so history and the
--     packing slip never need to reach back into (immutable) invoice_items.
-- ---------------------------------------------------------------------------
create table if not exists public.order_shipment_items (
  id                 uuid primary key default gen_random_uuid(),
  shipment_id        uuid not null references public.order_shipments(id) on delete cascade,
  invoice_id         uuid not null references public.invoices(id) on delete cascade,
  invoice_item_id    uuid not null references public.invoice_items(id) on delete cascade,
  sku                text not null,                        -- snapshot
  product_name       text not null,                        -- snapshot
  quantity_shipped   numeric(14,4) not null check (quantity_shipped > 0),
  lot_number         text,                                 -- snapshot when applicable
  manufacturing_date date,                                 -- snapshot when applicable
  expiration_date    date,                                 -- snapshot when applicable
  retest_date        date,                                 -- snapshot when applicable
  created_at         timestamptz not null default now(),
  -- One row per (shipment, line): a line appears at most once in a given shipment.
  unique (shipment_id, invoice_item_id)
);
create index if not exists idx_order_shipment_items_shipment
  on public.order_shipment_items(shipment_id);
create index if not exists idx_order_shipment_items_item
  on public.order_shipment_items(invoice_item_id);
create index if not exists idx_order_shipment_items_invoice
  on public.order_shipment_items(invoice_id);

-- ---------------------------------------------------------------------------
-- 4 · Append-only immutability locks for shipments (mirrors the invoice/PO lock
--     pattern from 0060/0190/0320). A finalized shipment can NEVER be silently
--     edited or deleted; the only sanctioned mutation is an audited void, driven
--     by app.void_shipment behind a transaction-local guard flag. The Owner-only
--     hard-delete path (0394) is honored via app.allow_order_delete so a mistaken
--     order can still be torn down atomically.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_shipment_lock()
returns trigger language plpgsql as $$
begin
  -- Sanctioned Owner-only permanent order deletion (0394): allow the cascade.
  if current_setting('app.allow_order_delete', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Shipment % is a finalized record and cannot be deleted. Void it instead.',
      old.shipment_number using errcode = '42501';
  end if;

  -- UPDATE: permit ONLY the sanctioned void transition (status finalized -> void,
  -- reason recorded, updated_at bump). Every other column must be unchanged.
  if current_setting('app.allow_shipment_void', true) = 'on'
     and old.status = 'finalized' and new.status = 'void'
     and new.id              is not distinct from old.id
     and new.invoice_id      is not distinct from old.invoice_id
     and new.shipment_number is not distinct from old.shipment_number
     and new.shipment_date   is not distinct from old.shipment_date
     and new.carrier         is not distinct from old.carrier
     and new.service         is not distinct from old.service
     and new.tracking_number is not distinct from old.tracking_number
     and new.tracking_url    is not distinct from old.tracking_url
     and new.notes           is not distinct from old.notes
     and new.created_by      is not distinct from old.created_by
     and new.created_at      is not distinct from old.created_at
  then
    return new;  -- audited void only
  end if;

  raise exception 'Shipment % is finalized and append-only. Use the void/correction workflow.',
    old.shipment_number using errcode = '42501';
end;
$$;

drop trigger if exists trg_order_shipments_lock on public.order_shipments;
create trigger trg_order_shipments_lock before update or delete on public.order_shipments
  for each row execute function app.enforce_shipment_lock();

create or replace function app.enforce_shipment_items_lock()
returns trigger language plpgsql as $$
begin
  -- Sanctioned Owner-only permanent order deletion (0394): allow the cascade.
  if current_setting('app.allow_order_delete', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Shipment line items are immutable once written; void the shipment instead.'
    using errcode = '42501';
end;
$$;

-- INSERT is intentionally NOT guarded (that is how app.create_shipment writes);
-- any later UPDATE/DELETE outside the sanctioned delete cascade is refused.
drop trigger if exists trg_order_shipment_items_lock on public.order_shipment_items;
create trigger trg_order_shipment_items_lock before update or delete on public.order_shipment_items
  for each row execute function app.enforce_shipment_items_lock();

comment on table public.order_shipments is
  'Customer-order shipment records (append-only; corrections via audited void). Distinct from purchase_order_shipments.';
comment on table public.order_shipment_items is
  'Per-line quantities in a shipment with lot/date snapshots. Never carries price or cost.';
comment on table public.order_line_fulfillment is
  'Manually settable per-line operational status. Derived (partially/fully shipped) is computed in views from quantities.';
