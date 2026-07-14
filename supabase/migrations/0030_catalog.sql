-- ============================================================================
-- Aurum Supply House · 0030 · Catalog (manufacturers, products, cost history)
-- ============================================================================

create table if not exists public.manufacturers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  contact_name           text,
  email                  citext,
  phone                  text,
  address                jsonb not null default '{}'::jsonb,
  default_lead_time_days int check (default_lead_time_days is null or default_lead_time_days >= 0),
  notes                  text,
  status                 product_status not null default 'active',
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_manufacturers_name_trgm
  on public.manufacturers using gin (name gin_trgm_ops);

drop trigger if exists trg_manufacturers_touch on public.manufacturers;
create trigger trg_manufacturers_touch before update on public.manufacturers
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- catalog_import_batches : one row per uploaded spreadsheet
-- ----------------------------------------------------------------------------
create table if not exists public.catalog_import_batches (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  storage_path  text not null,
  status        import_status not null default 'pending',
  row_count     int not null default 0,
  summary       jsonb not null default '{}'::jsonb,   -- {inserted, updated, skipped, errors}
  error         text,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz
);

-- ----------------------------------------------------------------------------
-- products : catalog master. current_true_cost is a trigger-maintained cache.
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  sku                citext not null unique,
  name               text not null,
  strength           text,
  pack_size          text,
  manufacturer_id    uuid references public.manufacturers(id) on delete set null,
  current_true_cost  numeric(14,4) not null default 0 check (current_true_cost >= 0),
  currency           char(3) not null default 'USD',
  lead_time_days     int check (lead_time_days is null or lead_time_days >= 0),
  moq                int check (moq is null or moq >= 0),
  notes              text,
  status             product_status not null default 'active',
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_products_manufacturer on public.products(manufacturer_id);
create index if not exists idx_products_status       on public.products(status);
create index if not exists idx_products_sku_trgm
  on public.products using gin ((sku::text) gin_trgm_ops);
create index if not exists idx_products_name_trgm
  on public.products using gin (name gin_trgm_ops);

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- product_cost_history : APPEND-ONLY ledger of true cost over time
-- ----------------------------------------------------------------------------
create table if not exists public.product_cost_history (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id) on delete cascade,
  true_cost       numeric(14,4) not null check (true_cost >= 0),
  currency        char(3) not null default 'USD',
  effective_date  date not null default current_date,
  source          cost_source not null default 'manual',
  import_batch_id uuid references public.catalog_import_batches(id) on delete set null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cost_history_product on public.product_cost_history(product_id, effective_date desc);

-- Guard: cost history is immutable once written.
create or replace function app.block_cost_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'product_cost_history is append-only; costs are never changed or deleted (product %).',
    coalesce(old.product_id, new.product_id);
end;
$$;
drop trigger if exists trg_cost_history_no_update on public.product_cost_history;
create trigger trg_cost_history_no_update before update or delete on public.product_cost_history
  for each row execute function app.block_cost_history_mutation();

-- Maintain products.current_true_cost from the latest history row.
create or replace function app.refresh_current_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.products p
     set current_true_cost = h.true_cost,
         currency          = h.currency
    from (
      select true_cost, currency
      from public.product_cost_history
      where product_id = new.product_id
      order by effective_date desc, created_at desc
      limit 1
    ) h
   where p.id = new.product_id;
  return new;
end;
$$;
drop trigger if exists trg_refresh_current_cost on public.product_cost_history;
create trigger trg_refresh_current_cost after insert on public.product_cost_history
  for each row execute function app.refresh_current_cost();
