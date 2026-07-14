-- ============================================================================
-- Aurum Supply House · 0130 · M2 pricing schema (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Unifies "price items" and "quantity tiers" into effective-dated quantity
-- BANDS on pricing_sheet_items (min_quantity..max_quantity). A model's price for
-- a product+quantity is the open, active, in-window band covering that quantity;
-- the min_quantity=1 band is the fallback. Client overrides get the same band
-- shape. History is preserved by closing (effective_to) and appending, exactly
-- like product_cost_history. Nothing here rewrites an M0/M1 migration.
-- ============================================================================

create extension if not exists btree_gist;   -- for non-overlap EXCLUDE constraints

-- ---- pricing_sheets → "pricing models" ------------------------------------
alter table public.pricing_sheets
  add column if not exists code            text,
  add column if not exists currency        char(3) not null default 'USD',
  add column if not exists effective_date  date not null default current_date,
  add column if not exists expiration_date date,
  add column if not exists notes           text;

-- At most one default model per currency (was: one default total).
drop index if exists uq_pricing_single_default;
create unique index if not exists uq_pricing_default_per_currency
  on public.pricing_sheets (currency) where is_default;

-- ---- pricing_sheet_items → effective-dated quantity bands -------------------
alter table public.pricing_sheet_items
  add column if not exists min_quantity        int not null default 1 check (min_quantity >= 1),
  add column if not exists max_quantity        int check (max_quantity is null or max_quantity >= min_quantity),
  add column if not exists effective_date      date not null default current_date,
  add column if not exists effective_to        date,
  add column if not exists expiration_date     date,
  add column if not exists active              boolean not null default true,
  add column if not exists notes               text,
  add column if not exists previous_price      numeric(14,4),
  add column if not exists reason              text,
  add column if not exists source_import_batch uuid,
  add column if not exists updated_by          uuid references public.profiles(id) on delete set null;

-- Was unique(sheet, product); effective-dating needs multiple rows. Replace with
-- "one OPEN active band per (sheet, product, min_quantity)" + non-overlap of bands.
alter table public.pricing_sheet_items drop constraint if exists pricing_sheet_items_pricing_sheet_id_product_id_key;

create unique index if not exists uq_psi_open_band
  on public.pricing_sheet_items (pricing_sheet_id, product_id, min_quantity)
  where effective_to is null and active;

-- NULL max = unbounded upper. Use exclusive-upper form [min, max+1) so a NULL max
-- maps to [min, ∞) without the int4 overflow that '[]' + 2147483647 would cause.
do $$ begin
  alter table public.pricing_sheet_items
    add constraint excl_psi_no_overlap exclude using gist (
      pricing_sheet_id with =,
      product_id with =,
      int4range(min_quantity, case when max_quantity is null then null else max_quantity + 1 end) with &&
    ) where (effective_to is null and active);
exception when duplicate_object then null; end $$;

-- ---- client_price_overrides → bands + effective-dating + audit --------------
alter table public.client_price_overrides
  add column if not exists min_quantity        int not null default 1 check (min_quantity >= 1),
  add column if not exists max_quantity        int check (max_quantity is null or max_quantity >= min_quantity),
  add column if not exists effective_date      date not null default current_date,
  add column if not exists effective_to        date,
  add column if not exists expiration_date     date,
  add column if not exists active              boolean not null default true,
  add column if not exists reason              text,
  add column if not exists previous_price      numeric(14,4),
  add column if not exists source_import_batch uuid,
  add column if not exists updated_by          uuid references public.profiles(id) on delete set null;

alter table public.client_price_overrides drop constraint if exists client_price_overrides_client_id_product_id_key;

create unique index if not exists uq_cpo_open_band
  on public.client_price_overrides (client_id, product_id, min_quantity)
  where effective_to is null and active;

do $$ begin
  alter table public.client_price_overrides
    add constraint excl_cpo_no_overlap exclude using gist (
      client_id with =,
      product_id with =,
      int4range(min_quantity, case when max_quantity is null then null else max_quantity + 1 end) with &&
    ) where (effective_to is null and active);
exception when duplicate_object then null; end $$;

-- ---- client_pricing_assignments (append-only audit of model assignment) ----
create table if not exists public.client_pricing_assignments (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  pricing_sheet_id uuid references public.pricing_sheets(id) on delete set null,
  effective_date   date not null default current_date,
  expiration_date  date,
  active           boolean not null default true,
  notes            text,
  assigned_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_cpa_client on public.client_pricing_assignments(client_id, created_at desc);

-- ---- Append-only guards: closed pricing records are immutable --------------
create or replace function app.block_closed_pricing_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_to is not null then
      raise exception 'Closed pricing records are immutable and cannot be deleted.';
    end if;
    return old;
  end if;
  -- Once closed, only trivial no-ops are allowed (nothing may change).
  if old.effective_to is not null then
    if ( new.selling_price is distinct from old.selling_price
      or new.min_quantity  is distinct from old.min_quantity
      or new.max_quantity  is distinct from old.max_quantity
      or new.effective_date is distinct from old.effective_date
      or new.effective_to  is distinct from old.effective_to
      or new.product_id    is distinct from old.product_id ) then
      raise exception 'Closed pricing records are immutable (only open records may change).';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_psi_closed_guard on public.pricing_sheet_items;
create trigger trg_psi_closed_guard before update or delete on public.pricing_sheet_items
  for each row execute function app.block_closed_pricing_mutation();

create or replace function app.block_closed_override_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_to is not null then
      raise exception 'Closed override records are immutable and cannot be deleted.';
    end if;
    return old;
  end if;
  if old.effective_to is not null then
    if ( new.selling_price is distinct from old.selling_price
      or new.min_quantity  is distinct from old.min_quantity
      or new.max_quantity  is distinct from old.max_quantity
      or new.effective_date is distinct from old.effective_date
      or new.effective_to  is distinct from old.effective_to
      or new.product_id    is distinct from old.product_id ) then
      raise exception 'Closed override records are immutable (only open records may change).';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cpo_closed_guard on public.client_price_overrides;
create trigger trg_cpo_closed_guard before update or delete on public.client_price_overrides
  for each row execute function app.block_closed_override_mutation();

-- ---- Pricing import: extend batches, add row-level results ------------------
alter table public.pricing_import_batches
  add column if not exists file_type         text,
  add column if not exists worksheet         text,
  add column if not exists mode              text,
  add column if not exists prices_created    int not null default 0,
  add column if not exists prices_updated    int not null default 0,
  add column if not exists tiers_changed     int not null default 0,
  add column if not exists rows_skipped      int not null default 0,
  add column if not exists error_report_path text;

create table if not exists public.pricing_import_rows (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.pricing_import_batches(id) on delete cascade,
  row_number     int,
  sku            text,
  classification text,
  status         text,
  messages       jsonb not null default '[]'::jsonb,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_pricing_import_rows_batch on public.pricing_import_rows(batch_id);
