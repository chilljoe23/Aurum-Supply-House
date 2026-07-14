-- ============================================================================
-- Aurum Supply House · 0045 · Customer-specific pricing overrides + resolver
-- ============================================================================
-- A customer keeps an assigned pricing model (Pricing A/B/…) but may override
-- the price of selected SKUs without needing a whole separate sheet.
--
-- Price resolution priority (see app.resolve_price):
--   1. Customer-specific SKU override            (client_price_overrides)
--   2. Customer's assigned pricing model         (clients.default_pricing_sheet_id)
--   3. Default pricing model                     (pricing_sheets.is_default)
--   4. Manual entry — resolver returns NULL; the invoice line records the
--      manual price with price_overridden = true.
-- Historical orders always snapshot the resolved price onto the invoice line.

create table if not exists public.client_price_overrides (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  selling_price numeric(14,4) not null check (selling_price >= 0),
  currency    char(3) not null default 'USD',
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, product_id)
);
create index if not exists idx_client_overrides_client  on public.client_price_overrides(client_id);
create index if not exists idx_client_overrides_product on public.client_price_overrides(product_id);

drop trigger if exists trg_client_overrides_touch on public.client_price_overrides;
create trigger trg_client_overrides_touch before update on public.client_price_overrides
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Resolver: returns the applicable price and where it came from.
-- Quantity is accepted so tier pricing on the assigned/default sheet applies.
-- A NULL price means "no rule found — enter manually".
-- ----------------------------------------------------------------------------
create or replace function app.resolve_price(
  p_client_id  uuid,
  p_product_id uuid,
  p_quantity   numeric default 1,
  out price     numeric,
  out source    text,
  out pricing_sheet_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_sheet uuid;
  v_base  numeric(14,4);
  v_tier  numeric(14,4);
begin
  -- 1) Customer-specific SKU override
  select selling_price into price
    from public.client_price_overrides
   where client_id = p_client_id and product_id = p_product_id;
  if price is not null then
    source := 'client_override';
    pricing_sheet_id := null;
    return;
  end if;

  -- 2) Customer's assigned pricing model, else 3) default model
  select c.default_pricing_sheet_id into v_sheet
    from public.clients c where c.id = p_client_id;
  if v_sheet is null then
    select id into v_sheet from public.pricing_sheets where is_default limit 1;
    source := 'default_model';
  else
    source := 'assigned_model';
  end if;

  if v_sheet is not null then
    select psi.selling_price into v_base
      from public.pricing_sheet_items psi
     where psi.pricing_sheet_id = v_sheet and psi.product_id = p_product_id;

    if v_base is not null then
      -- Quantity tier (if any) overrides the flat sheet price.
      select pt.unit_price into v_tier
        from public.pricing_sheet_items psi
        join public.pricing_tiers pt on pt.pricing_sheet_item_id = psi.id
       where psi.pricing_sheet_id = v_sheet and psi.product_id = p_product_id
         and p_quantity >= pt.min_qty
         and (pt.max_qty is null or p_quantity <= pt.max_qty)
       order by pt.min_qty desc
       limit 1;

      price := coalesce(v_tier, v_base);
      pricing_sheet_id := v_sheet;
      return;
    end if;
  end if;

  -- 4) Nothing found → manual entry
  price := null;
  source := 'manual';
  pricing_sheet_id := v_sheet;
  return;
end;
$$;
