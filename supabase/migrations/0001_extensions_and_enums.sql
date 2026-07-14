-- ============================================================================
-- Aurum Supply House · 0001 · Extensions, private schema, enums, shared utils
-- ============================================================================
-- Idempotent where practical. Apply in numeric order.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- fast fuzzy search on names/skus
create extension if not exists "citext";      -- case-insensitive email/sku matching

-- Private schema for security-definer helpers & internal functions.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role         as enum ('owner', 'admin', 'sales_rep');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_status    as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_status     as enum ('active', 'inactive', 'prospect');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_status    as enum ('active', 'discontinued');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cost_source       as enum ('manual', 'import', 'purchase_order');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sheet_status      as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_terms     as enum
    ('due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type po_status         as enum
    ('draft','sent','confirmed','deposit_paid','production',
     'testing','ready_to_ship','shipped','received','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type po_attachment_type as enum
    ('manufacturer_invoice','coa','packing_list','tracking','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status    as enum ('draft','sent','paid','partial','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method    as enum ('cash','check','wire','card','ach','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type commission_type   as enum
    ('percent_of_sale','percent_of_gross_profit','flat','per_unit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type commission_status as enum ('pending','approved','paid','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type import_status     as enum ('pending','previewed','committed','failed');
exception when duplicate_object then null; end $$;

-- Commissions may be paid to internal users or external referral partners.
do $$ begin
  create type commission_recipient_type as enum ('internal_user','external_partner');
exception when duplicate_object then null; end $$;

-- Manufacturer (purchase-order) payment ledger entry types.
do $$ begin
  create type manufacturer_payment_type as enum ('deposit','balance','additional','refund_credit');
exception when duplicate_object then null; end $$;

-- Internal per-order expense categories (never shown on customer invoices).
do $$ begin
  create type order_expense_type as enum
    ('payment_processing_fee','outbound_shipping','packaging','testing','referral_expense','other');
exception when duplicate_object then null; end $$;

-- Reserved for the future Orders lifecycle (Quote → Approved → Invoice →
-- Paid → Fulfilled → Complete). Not driven in Phase 1; see invoices.stage.
do $$ begin
  create type order_stage as enum
    ('quote','approved_order','invoice','paid','fulfilled','complete');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Shared utility: keep updated_at fresh
-- ----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Half-up money rounding to a given scale (Postgres round() is half-even for
-- some numeric paths; we standardize on half-up for currency).
create or replace function app.money_round(v numeric, scale int default 2)
returns numeric
language sql
immutable
as $$
  select case
    when v is null then null
    else trunc(v * power(10, scale) + 0.5 * sign(v)) / power(10, scale)
  end;
$$;

comment on schema app is 'Private helpers for RLS and internal logic. Not exposed to API roles.';
