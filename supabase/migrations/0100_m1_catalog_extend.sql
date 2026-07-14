-- ============================================================================
-- Aurum Supply House · 0100 · M1 catalog extensions (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Extends products, manufacturers, and product_cost_history for the full
-- catalog + import feature set. Does not rewrite any M0 migration.
-- ============================================================================

-- ---- products: richer, flexible product record ------------------------------
alter table public.products
  add column if not exists description       text,
  add column if not exists product_form      text,        -- dosage form / product form (optional)
  add column if not exists unit_of_measure   text,
  add column if not exists manufacturer_sku  text,
  add column if not exists category          text;

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_form     on public.products(product_form);

-- ---- manufacturers: contact & terms ----------------------------------------
alter table public.manufacturers
  add column if not exists legal_name       text,
  add column if not exists payment_terms    payment_terms,
  add column if not exists default_currency char(3) not null default 'USD';

-- Normalized name for duplicate detection (whitespace-collapsed, lowercased).
alter table public.manufacturers
  add column if not exists normalized_name text
  generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored;
create index if not exists idx_manufacturers_normalized on public.manufacturers(normalized_name);

create or replace function app.normalize_name(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p,'')), '\s+', ' ', 'g'));
$$;

-- Best-match manufacturer lookup by normalized name (exact normalized match).
create or replace function app.find_manufacturer(p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.manufacturers
  where normalized_name = app.normalize_name(p_name)
  order by created_at
  limit 1;
$$;

-- ---- product_cost_history: effective-dating + audit trail -------------------
alter table public.product_cost_history
  add column if not exists effective_to  date,             -- NULL = still current
  add column if not exists previous_cost numeric(14,4),    -- cost this row superseded
  add column if not exists reason        text;             -- required for manual changes

create index if not exists idx_cost_history_open
  on public.product_cost_history(product_id) where effective_to is null;

-- Relax the append-only guard: deletes are still forbidden, and the cost amount
-- itself can never change — but a record MAY be *closed* by setting effective_to
-- (and its reason annotated). This preserves immutability of what a cost WAS.
create or replace function app.block_cost_history_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'product_cost_history is append-only; cost records cannot be deleted.';
  end if;
  if ( new.true_cost     is distinct from old.true_cost
    or new.product_id    is distinct from old.product_id
    or new.currency      is distinct from old.currency
    or new.effective_date is distinct from old.effective_date
    or new.source        is distinct from old.source
    or new.previous_cost is distinct from old.previous_cost
    or new.import_batch_id is distinct from old.import_batch_id
    or new.created_at    is distinct from old.created_at ) then
    raise exception 'product_cost_history is append-only; only effective_to/reason may change (to close a record).';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- record_cost_change : the ONLY sanctioned way to change a product's true cost.
-- Closes the current open record (effective_to = effective date), then appends
-- a new effective-dated record carrying previous_cost, source, reason, batch.
-- The existing refresh_current_cost trigger keeps products.current_true_cost
-- resolvable. Historical invoices/POs are unaffected — they hold their own
-- snapshots.
-- ----------------------------------------------------------------------------
create or replace function app.record_cost_change(
  p_product       uuid,
  p_new_cost      numeric,
  p_currency      char(3),
  p_source        cost_source,
  p_reason        text default null,
  p_import_batch  uuid default null,
  p_actor         uuid default null,
  p_effective     date default current_date
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_prev numeric(14,4);
  v_id   uuid;
begin
  if p_new_cost is null or p_new_cost < 0 then
    raise exception 'Cost must be zero or positive (got %).', p_new_cost;
  end if;
  if p_source = 'manual' and coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required for manual cost changes.';
  end if;

  -- Previous open cost (if any) → becomes previous_cost and gets closed.
  select true_cost into v_prev
    from public.product_cost_history
   where product_id = p_product and effective_to is null
   order by effective_date desc, created_at desc
   limit 1;

  update public.product_cost_history
     set effective_to = p_effective, reason = coalesce(reason, p_reason)
   where product_id = p_product and effective_to is null;

  insert into public.product_cost_history
    (product_id, true_cost, currency, effective_date, effective_to,
     source, previous_cost, reason, import_batch_id, created_by)
  values
    (p_product, p_new_cost, coalesce(p_currency,'USD'), p_effective, null,
     p_source, v_prev, p_reason, p_import_batch, p_actor)
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Harden current-cost resolution. now() is constant within a transaction, so
-- two cost rows written in one transaction can share created_at, making a plain
-- "latest by date" ordering ambiguous. The current cost is definitionally the
-- OPEN record (effective_to IS NULL) — record_cost_change guarantees exactly one
-- — so prefer it, with deterministic tiebreakers behind it. Overrides 0030.
-- ----------------------------------------------------------------------------
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
      order by (effective_to is null) desc,   -- the open (current) record wins
               effective_date desc,
               created_at desc,
               id desc                          -- final deterministic tiebreaker
      limit 1
    ) h
   where p.id = new.product_id;
  return new;
end;
$$;
