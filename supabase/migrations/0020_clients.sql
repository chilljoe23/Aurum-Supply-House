-- ============================================================================
-- Aurum Supply House · 0020 · Clients
-- ============================================================================
-- Note: pricing_sheets FK is added in 0040 (created there) to avoid a forward
-- reference; the column is declared here and constrained later.

create table if not exists public.clients (
  id                     uuid primary key default gen_random_uuid(),
  company_name           text not null,
  primary_contact_name   text,
  email                  citext,
  phone                  text,
  billing_address        jsonb not null default '{}'::jsonb,
  shipping_address       jsonb not null default '{}'::jsonb,
  assigned_rep_id        uuid references public.profiles(id) on delete set null,
  default_pricing_sheet_id uuid,   -- FK added in 0040
  payment_terms          payment_terms not null default 'net_30',
  notes                  text,
  status                 client_status not null default 'active',
  portal_user_id         uuid references auth.users(id) on delete set null, -- reserved for future client portal
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_clients_rep     on public.clients(assigned_rep_id);
create index if not exists idx_clients_status  on public.clients(status);
create index if not exists idx_clients_name_trgm
  on public.clients using gin (company_name gin_trgm_ops);

drop trigger if exists trg_clients_touch on public.clients;
create trigger trg_clients_touch before update on public.clients
  for each row execute function app.touch_updated_at();
