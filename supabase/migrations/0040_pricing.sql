-- ============================================================================
-- Aurum Supply House · 0040 · Pricing (sheets, items, tiers, history)
-- ============================================================================

create table if not exists public.pricing_sheets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      sheet_status not null default 'active',
  is_default  boolean not null default false,
  version     int not null default 1,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- At most one default sheet.
create unique index if not exists uq_pricing_single_default
  on public.pricing_sheets ((is_default)) where is_default;

drop trigger if exists trg_pricing_sheets_touch on public.pricing_sheets;
create trigger trg_pricing_sheets_touch before update on public.pricing_sheets
  for each row execute function app.touch_updated_at();

-- Now that pricing_sheets exists, wire the client FK declared in 0020.
do $$ begin
  alter table public.clients
    add constraint fk_clients_pricing_sheet
    foreign key (default_pricing_sheet_id)
    references public.pricing_sheets(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- pricing_sheet_items
-- ----------------------------------------------------------------------------
create table if not exists public.pricing_sheet_items (
  id               uuid primary key default gen_random_uuid(),
  pricing_sheet_id uuid not null references public.pricing_sheets(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  selling_price    numeric(14,4) not null check (selling_price >= 0),
  currency         char(3) not null default 'USD',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (pricing_sheet_id, product_id)
);
create index if not exists idx_pricing_items_product on public.pricing_sheet_items(product_id);

drop trigger if exists trg_pricing_items_touch on public.pricing_sheet_items;
create trigger trg_pricing_items_touch before update on public.pricing_sheet_items
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- pricing_tiers : optional quantity breaks (max_qty null = "and up")
-- ----------------------------------------------------------------------------
create table if not exists public.pricing_tiers (
  id                     uuid primary key default gen_random_uuid(),
  pricing_sheet_item_id  uuid not null references public.pricing_sheet_items(id) on delete cascade,
  min_qty                int not null check (min_qty >= 1),
  max_qty                int check (max_qty is null or max_qty >= min_qty),
  unit_price             numeric(14,4) not null check (unit_price >= 0),
  created_at             timestamptz not null default now()
);
create index if not exists idx_pricing_tiers_item on public.pricing_tiers(pricing_sheet_item_id, min_qty);

-- ----------------------------------------------------------------------------
-- pricing_item_history : journal of price changes (audit; invoices snapshot)
-- ----------------------------------------------------------------------------
create table if not exists public.pricing_item_history (
  id               uuid primary key default gen_random_uuid(),
  pricing_sheet_id uuid not null references public.pricing_sheets(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  old_price        numeric(14,4),
  new_price        numeric(14,4) not null,
  changed_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_pricing_hist on public.pricing_item_history(pricing_sheet_id, product_id, created_at desc);

-- Journal every insert/update of a price.
create or replace function app.journal_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.pricing_item_history(pricing_sheet_id, product_id, old_price, new_price, changed_by)
    values (new.pricing_sheet_id, new.product_id, null, new.selling_price, auth.uid());
  elsif (tg_op = 'UPDATE' and new.selling_price is distinct from old.selling_price) then
    insert into public.pricing_item_history(pricing_sheet_id, product_id, old_price, new_price, changed_by)
    values (new.pricing_sheet_id, new.product_id, old.selling_price, new.selling_price, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_price_journal on public.pricing_sheet_items;
create trigger trg_price_journal after insert or update on public.pricing_sheet_items
  for each row execute function app.journal_price_change();

-- Import batches for pricing uploads
create table if not exists public.pricing_import_batches (
  id               uuid primary key default gen_random_uuid(),
  pricing_sheet_id uuid references public.pricing_sheets(id) on delete set null,
  filename         text not null,
  storage_path     text not null,
  status           import_status not null default 'pending',
  row_count        int not null default 0,
  summary          jsonb not null default '{}'::jsonb,
  error            text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  committed_at     timestamptz
);
