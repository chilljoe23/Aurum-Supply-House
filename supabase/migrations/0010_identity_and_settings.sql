-- ============================================================================
-- Aurum Supply House · 0010 · Identity, settings, numbering, RLS helpers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles : one row per employee, keyed to auth.users
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  full_name                text not null default '',
  email                    citext not null,
  role                     user_role not null default 'sales_rep',
  status                   profile_status not null default 'active',
  phone                    text,
  avatar_url               text,
  default_commission_type  commission_type,
  default_commission_rate  numeric(9,6) check (default_commission_rate is null or default_commission_rate >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_profiles_role   on public.profiles(role);
create index if not exists idx_profiles_status on public.profiles(status);

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Auto-create a profile when a Supabase auth user is created.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public, app
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    -- First user ever becomes owner; everyone else defaults to sales_rep.
    case when (select count(*) from public.profiles) = 0
         then 'owner'::user_role
         else 'sales_rep'::user_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ----------------------------------------------------------------------------
-- RLS helper functions (security definer -> never recurse through RLS)
-- ----------------------------------------------------------------------------
create or replace function app.role()
returns user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('owner','admin')
  );
$$;

create or replace function app.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'owner'
  );
$$;

-- ----------------------------------------------------------------------------
-- app_settings : enforced single row of company configuration
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                 boolean primary key default true check (id),   -- only one row allowed
  company_name       text not null default 'Aurum Supply House',
  logo_path          text,
  address            jsonb not null default '{}'::jsonb,
  contact_email      citext,
  contact_phone      text,
  invoice_prefix     text not null default 'INV',
  po_prefix          text not null default 'PO',
  default_payment_terms payment_terms not null default 'net_30',
  default_tax_rate   numeric(9,6) not null default 0 check (default_tax_rate >= 0),
  default_currency   char(3) not null default 'USD',
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_settings_touch on public.app_settings;
create trigger trg_settings_touch before update on public.app_settings
  for each row execute function app.touch_updated_at();

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- document_sequences : collision-free human-readable numbering
-- ----------------------------------------------------------------------------
create table if not exists public.document_sequences (
  key         text primary key,     -- e.g. 'invoice', 'purchase_order'
  next_value  bigint not null default 1
);

insert into public.document_sequences (key, next_value)
values ('invoice', 1), ('purchase_order', 1)
on conflict (key) do nothing;

-- Allocate the next number atomically (row lock prevents duplicates).
create or replace function app.next_document_number(p_key text, p_prefix text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_num bigint;
  v_year text := to_char(now(), 'YYYY');
begin
  update public.document_sequences
     set next_value = next_value + 1
   where key = p_key
  returning next_value - 1 into v_num;

  if v_num is null then
    insert into public.document_sequences(key, next_value)
    values (p_key, 2) returning next_value - 1 into v_num;
  end if;

  return p_prefix || '-' || v_year || '-' || lpad(v_num::text, 6, '0');
end;
$$;
