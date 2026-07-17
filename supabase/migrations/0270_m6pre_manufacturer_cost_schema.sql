-- ============================================================================
-- Aurum Supply House · 0270 · M6-prerequisite: Manufacturer-specific cost schema
-- ----------------------------------------------------------------------------
-- ADDITIVE. Does not rewrite migrations 0001–0260. Introduces the ability to
-- hold separate cost/pricing files from MULTIPLE manufacturers for the SAME
-- Aurum product, effective-dated and append-only, with optional quantity tiers.
--
-- Shape deliberately mirrors the M2 pricing model (0130): a single table holds
-- both quantity BANDS (min_quantity..max_quantity) and their HISTORY (close via
-- effective_to + append), guarded by btree_gist non-overlap EXCLUDE constraints
-- and append-only triggers — the proven pattern for pricing_sheet_items.
--
-- CRITICAL SAFETY PROPERTY: nothing here writes public.product_cost_history or
-- public.products.current_true_cost. Manufacturer cost imports live ENTIRELY in
-- these new tables. The catalog's "true cost" (which feeds invoice profitability
-- and commissions) changes ONLY through the existing app.record_cost_change path,
-- and ONLY when an Owner/Admin explicitly PROMOTES a manufacturer cost (0280).
-- Historical invoices and POs are therefore never touched by a cost-file upload.
-- ============================================================================

create extension if not exists btree_gist;   -- non-overlap EXCLUDE (idempotent; also in 0130)

-- ----------------------------------------------------------------------------
-- products: which manufacturer is the SANCTIONED source of the catalog's true
-- cost for this product. Nullable; NULL means "no preferred source designated"
-- and true cost is only ever changed by an explicit promotion or manual edit.
-- We intentionally do NOT store per-manufacturer costs on the product record.
-- ----------------------------------------------------------------------------
alter table public.products
  add column if not exists preferred_manufacturer_id uuid
    references public.manufacturers(id) on delete set null;

create index if not exists idx_products_preferred_manufacturer
  on public.products(preferred_manufacturer_id);

-- ----------------------------------------------------------------------------
-- manufacturer_cost_import_batches : one row per uploaded manufacturer cost file
-- Mirrors pricing_import_batches; adds manufacturer_id (the file's supplier).
-- ----------------------------------------------------------------------------
create table if not exists public.manufacturer_cost_import_batches (
  id                 uuid primary key default gen_random_uuid(),
  manufacturer_id    uuid not null references public.manufacturers(id) on delete cascade,
  filename           text not null,
  storage_path       text not null,
  file_type          text,
  worksheet          text,
  status             import_status not null default 'pending',
  mode               text,                                   -- 'atomic' | 'valid_only'
  row_count          int  not null default 0,
  relationships_created int not null default 0,
  costs_created      int  not null default 0,
  costs_updated      int  not null default 0,
  tiers_changed      int  not null default 0,
  rows_skipped       int  not null default 0,
  summary            jsonb not null default '{}'::jsonb,
  error              text,
  error_report_path  text,
  uploaded_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  committed_at       timestamptz
);
create index if not exists idx_mfr_cost_batches_manufacturer
  on public.manufacturer_cost_import_batches(manufacturer_id, created_at desc);

-- ----------------------------------------------------------------------------
-- manufacturer_products : the manufacturer ⇄ Aurum-product relationship.
-- A product may be supplied by many manufacturers; each (manufacturer, product)
-- pair is one row carrying relationship-level terms. The CURRENT unit cost is a
-- trigger-maintained cache of the open base-tier cost record (see below); the
-- authoritative, effective-dated costs live in manufacturer_cost_history.
-- ----------------------------------------------------------------------------
create table if not exists public.manufacturer_products (
  id                       uuid primary key default gen_random_uuid(),
  manufacturer_id          uuid not null references public.manufacturers(id) on delete cascade,
  product_id               uuid not null references public.products(id) on delete cascade,
  manufacturer_sku         text,
  manufacturer_description text,
  currency                 char(3) not null default 'USD',
  moq                      int check (moq is null or moq >= 0),            -- minimum order quantity
  order_multiple           int check (order_multiple is null or order_multiple >= 1), -- case / order multiple
  lead_time_days           int check (lead_time_days is null or lead_time_days >= 0),
  current_unit_cost        numeric(14,4) check (current_unit_cost is null or current_unit_cost >= 0), -- cache of open base tier
  active                   boolean not null default true,
  notes                    text,
  source_import_batch      uuid references public.manufacturer_cost_import_batches(id) on delete set null,
  created_by               uuid references public.profiles(id) on delete set null,
  updated_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (manufacturer_id, product_id)
);
create index if not exists idx_mfr_products_manufacturer on public.manufacturer_products(manufacturer_id);
create index if not exists idx_mfr_products_product      on public.manufacturer_products(product_id);
create index if not exists idx_mfr_products_active       on public.manufacturer_products(manufacturer_id) where active;

drop trigger if exists trg_mfr_products_touch on public.manufacturer_products;
create trigger trg_mfr_products_touch before update on public.manufacturer_products
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- manufacturer_cost_history : effective-dated, append-only cost ledger, unified
-- with optional quantity TIERS (min_quantity..max_quantity). One OPEN active
-- band per (relationship, min_quantity); bands may not overlap. Closing a band
-- (effective_to) + appending a new one preserves history — costs are never
-- edited or deleted. unit_cost must be > 0 (a real cost). previous_cost records
-- the superseded cost so old→new/Δ is always reconstructable.
-- ----------------------------------------------------------------------------
create table if not exists public.manufacturer_cost_history (
  id                      uuid primary key default gen_random_uuid(),
  manufacturer_product_id uuid not null references public.manufacturer_products(id) on delete cascade,
  min_quantity            int not null default 1 check (min_quantity >= 1),
  max_quantity            int check (max_quantity is null or max_quantity >= min_quantity),
  unit_cost               numeric(14,4) not null check (unit_cost > 0),
  currency                char(3) not null default 'USD',
  effective_date          date not null default current_date,
  effective_to            date,                              -- NULL = open / current
  expiration_date         date,
  active                  boolean not null default true,
  previous_cost           numeric(14,4),                     -- cost this record superseded
  source                  cost_source not null default 'import',
  reason                  text,
  source_import_batch     uuid references public.manufacturer_cost_import_batches(id) on delete set null,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  constraint mch_expiration_after_effective
    check (expiration_date is null or effective_date is null or expiration_date >= effective_date)
);
create index if not exists idx_mch_relationship on public.manufacturer_cost_history(manufacturer_product_id, effective_date desc);
create index if not exists idx_mch_open on public.manufacturer_cost_history(manufacturer_product_id) where effective_to is null;

-- One open active band per (relationship, min_quantity).
create unique index if not exists uq_mch_open_band
  on public.manufacturer_cost_history (manufacturer_product_id, min_quantity)
  where effective_to is null and active;

-- Non-overlapping open active bands. Exclusive-upper [min, max+1) so a NULL max
-- maps to [min, ∞) without int4 overflow (same idiom as pricing 0130).
do $$ begin
  alter table public.manufacturer_cost_history
    add constraint excl_mch_no_overlap exclude using gist (
      manufacturer_product_id with =,
      int4range(min_quantity, case when max_quantity is null then null else max_quantity + 1 end) with &&
    ) where (effective_to is null and active);
exception when duplicate_object then null; end $$;

-- ---- Append-only guard: closed cost records are immutable -------------------
-- Open records may be closed (effective_to set) or their reason annotated; the
-- cost amount / band / dates of a WRITTEN record can never change, and closed
-- records can never be deleted. Mirrors app.block_closed_pricing_mutation (0130).
create or replace function app.block_mfr_cost_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_to is not null then
      raise exception 'Closed manufacturer cost records are immutable and cannot be deleted.';
    end if;
    return old;
  end if;
  -- The immutable core of ANY record (open or closed): the cost itself, the band,
  -- the effective date, currency, relationship, source and previous_cost. Only
  -- effective_to (to close) and reason (to annotate) may ever change.
  if ( new.unit_cost               is distinct from old.unit_cost
    or new.min_quantity            is distinct from old.min_quantity
    or new.max_quantity            is distinct from old.max_quantity
    or new.currency                is distinct from old.currency
    or new.manufacturer_product_id is distinct from old.manufacturer_product_id
    or new.effective_date          is distinct from old.effective_date
    or new.source                  is distinct from old.source
    or new.previous_cost           is distinct from old.previous_cost
    or new.created_at              is distinct from old.created_at ) then
    raise exception 'manufacturer_cost_history is append-only; only effective_to/reason may change (to close a record).';
  end if;
  -- A closed record's effective_to is frozen — it can never be re-opened or re-closed
  -- (the cost/band/date core is already frozen unconditionally above).
  if old.effective_to is not null and (new.effective_to is distinct from old.effective_to) then
    raise exception 'A closed manufacturer cost record cannot be re-opened or re-closed.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mch_append_only on public.manufacturer_cost_history;
create trigger trg_mch_append_only before update or delete on public.manufacturer_cost_history
  for each row execute function app.block_mfr_cost_mutation();

-- ---- Maintain manufacturer_products.current_unit_cost from the open base tier
-- "Current unit cost" for a relationship is definitionally the OPEN base-tier
-- (min_quantity = 1) record. Prefer the open record with deterministic
-- tiebreakers behind it (now() is constant within a txn). Mirrors 0100's
-- app.refresh_current_cost.
create or replace function app.refresh_mfr_current_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.manufacturer_products mp
     set current_unit_cost = h.unit_cost,
         currency          = h.currency
    from (
      select unit_cost, currency
      from public.manufacturer_cost_history
      where manufacturer_product_id = new.manufacturer_product_id
        and min_quantity = 1
      order by (effective_to is null) desc,   -- the open (current) base record wins
               effective_date desc,
               created_at desc,
               id desc
      limit 1
    ) h
   where mp.id = new.manufacturer_product_id;
  return new;
end;
$$;
drop trigger if exists trg_refresh_mfr_current_cost on public.manufacturer_cost_history;
create trigger trg_refresh_mfr_current_cost after insert on public.manufacturer_cost_history
  for each row execute function app.refresh_mfr_current_cost();

-- ----------------------------------------------------------------------------
-- manufacturer_cost_import_rows : row-level import results, for history drill-down
-- Mirrors pricing_import_rows / catalog_import_rows.
-- ----------------------------------------------------------------------------
create table if not exists public.manufacturer_cost_import_rows (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.manufacturer_cost_import_batches(id) on delete cascade,
  row_number     int,
  sku            text,
  classification text,   -- new_manufacturer_product | new_cost | cost_update | product_data_update
                         -- | tier_added | tier_updated | no_change | unknown_sku | duplicate_in_file
                         -- | invalid | future_dated | expired
  status         text,   -- imported | no_change | skipped | failed
  messages       jsonb not null default '[]'::jsonb,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_mfr_cost_import_rows_batch on public.manufacturer_cost_import_rows(batch_id);
create index if not exists idx_mfr_cost_import_rows_sku   on public.manufacturer_cost_import_rows(sku);

comment on table public.manufacturer_products is
  'Manufacturer ⇄ Aurum-product supply relationship. current_unit_cost caches the open base-tier cost.';
comment on table public.manufacturer_cost_history is
  'Effective-dated, append-only manufacturer cost ledger with optional quantity tiers. Never feeds products.current_true_cost automatically.';
comment on column public.products.preferred_manufacturer_id is
  'Sanctioned source manufacturer for this product''s catalog true cost. Promotion is explicit (see app.promote_manufacturer_cost).';
