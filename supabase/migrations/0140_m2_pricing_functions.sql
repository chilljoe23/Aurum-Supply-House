-- ============================================================================
-- Aurum Supply House · 0140 · M2 pricing functions, resolver & RPCs (ADDITIVE)
-- ============================================================================

-- ---- set_price: the ONLY sanctioned way to change a model price band --------
-- Closes the open band with the same (sheet, product, min_quantity), then
-- appends a new effective-dated band. Reason required for manual changes.
create or replace function app.set_price(
  p_sheet uuid, p_product uuid, p_min_qty int, p_max_qty int,
  p_price numeric, p_currency char(3), p_effective date, p_expiration date,
  p_active boolean, p_notes text, p_source text, p_reason text,
  p_batch uuid, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_prev numeric(14,4); v_id uuid;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'Selling price must be greater than zero (got %).', p_price;
  end if;
  if p_source = 'manual' and coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required for manual price changes.';
  end if;

  select selling_price into v_prev
    from public.pricing_sheet_items
   where pricing_sheet_id = p_sheet and product_id = p_product
     and min_quantity = p_min_qty and effective_to is null and active
   limit 1;

  update public.pricing_sheet_items
     set effective_to = p_effective, updated_by = p_actor
   where pricing_sheet_id = p_sheet and product_id = p_product
     and min_quantity = p_min_qty and effective_to is null and active;

  insert into public.pricing_sheet_items
    (pricing_sheet_id, product_id, selling_price, currency, min_quantity, max_quantity,
     effective_date, effective_to, expiration_date, active, notes, previous_price, reason,
     source_import_batch, created_by, updated_by)
  values
    (p_sheet, p_product, p_price, coalesce(p_currency,'USD'), coalesce(p_min_qty,1), p_max_qty,
     coalesce(p_effective, current_date), null, p_expiration, coalesce(p_active,true), p_notes,
     v_prev, p_reason, p_batch, p_actor, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---- set_override: client-specific SKU price band --------------------------
create or replace function app.set_override(
  p_client uuid, p_product uuid, p_min_qty int, p_max_qty int,
  p_price numeric, p_currency char(3), p_effective date, p_expiration date,
  p_active boolean, p_reason text, p_notes text, p_batch uuid, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_prev numeric(14,4); v_id uuid;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'Override price must be greater than zero (got %).', p_price;
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required for a client-specific override.';
  end if;

  select selling_price into v_prev
    from public.client_price_overrides
   where client_id = p_client and product_id = p_product
     and min_quantity = p_min_qty and effective_to is null and active
   limit 1;

  update public.client_price_overrides
     set effective_to = p_effective, updated_by = p_actor
   where client_id = p_client and product_id = p_product
     and min_quantity = p_min_qty and effective_to is null and active;

  insert into public.client_price_overrides
    (client_id, product_id, selling_price, currency, min_quantity, max_quantity,
     effective_date, effective_to, expiration_date, active, reason, note, previous_price,
     source_import_batch, created_by, updated_by)
  values
    (p_client, p_product, p_price, coalesce(p_currency,'USD'), coalesce(p_min_qty,1), p_max_qty,
     coalesce(p_effective, current_date), null, p_expiration, coalesce(p_active,true), p_reason, p_notes,
     v_prev, p_batch, p_actor, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---- assign_pricing_model: sets current model + writes assignment audit -----
create or replace function app.assign_pricing_model(
  p_client uuid, p_sheet uuid, p_effective date, p_expiration date, p_notes text, p_actor uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.client_pricing_assignments set active = false
    where client_id = p_client and active;
  insert into public.client_pricing_assignments
    (client_id, pricing_sheet_id, effective_date, expiration_date, active, notes, assigned_by)
  values (p_client, p_sheet, coalesce(p_effective, current_date), p_expiration, true, p_notes, p_actor);
  update public.clients set default_pricing_sheet_id = p_sheet where id = p_client;
end;
$$;

-- ----------------------------------------------------------------------------
-- resolve_price — the deterministic pricing brain. Returns jsonb.
-- Priority: client override → selected model → assigned model → default model →
--           authorized manual price → unresolved. Never returns 0, never falls
--           back to cost. Highest applicable min_quantity band wins.
-- ----------------------------------------------------------------------------
drop function if exists app.resolve_price(uuid, uuid, numeric);
create or replace function app.resolve_price(
  p_client_id     uuid,
  p_product_id    uuid,
  p_quantity      numeric default 1,
  p_currency      char(3) default 'USD',
  p_selected_model uuid   default null,
  p_effective     date    default current_date,
  p_manual_price  numeric default null,
  p_manual_reason text    default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cur char(3) := coalesce(p_currency, 'USD');
  rec record;
  v_sheet uuid;
  v_name text;
begin
  -- 1) Active client-specific override
  if p_client_id is not null then
    select selling_price, min_quantity, effective_date, id into rec
      from public.client_price_overrides
     where client_id = p_client_id and product_id = p_product_id and active
       and effective_to is null and currency = v_cur
       and effective_date <= p_effective
       and (expiration_date is null or expiration_date >= p_effective)
       and min_quantity <= p_quantity
       and (max_quantity is null or max_quantity >= p_quantity)
     order by min_quantity desc
     limit 1;
    if found then
      return jsonb_build_object('resolved', true, 'price', rec.selling_price, 'currency', v_cur,
        'source','client_override','pricing_sheet_id',null,'pricing_sheet_name',null,
        'override_id', rec.id,'tier_min_quantity', rec.min_quantity,
        'effective_date', rec.effective_date,'manual', false,'warning', null);
    end if;
  end if;

  -- 2/3/4) resolve which model to use, in priority order
  for v_sheet in
    select s from (
      select p_selected_model as s, 1 as ord
      union all select default_pricing_sheet_id, 2 from public.clients where id = p_client_id
      union all select id, 3 from public.pricing_sheets where is_default and currency = v_cur
    ) q where s is not null order by ord
  loop
    select psi.selling_price, psi.min_quantity, psi.effective_date, ps.name,
           (case when v_sheet = p_selected_model then 'selected_model'
                 when v_sheet = (select default_pricing_sheet_id from public.clients where id = p_client_id) then 'assigned_model'
                 else 'default_model' end) as src
      into rec
      from public.pricing_sheet_items psi
      join public.pricing_sheets ps on ps.id = psi.pricing_sheet_id
     where psi.pricing_sheet_id = v_sheet and psi.product_id = p_product_id and psi.active
       and psi.effective_to is null and psi.currency = v_cur
       and psi.effective_date <= p_effective
       and (psi.expiration_date is null or psi.expiration_date >= p_effective)
       and ps.status = 'active'
       and ps.effective_date <= p_effective
       and (ps.expiration_date is null or ps.expiration_date >= p_effective)
       and psi.min_quantity <= p_quantity
       and (psi.max_quantity is null or psi.max_quantity >= p_quantity)
     order by psi.min_quantity desc
     limit 1;
    if found then
      return jsonb_build_object('resolved', true, 'price', rec.selling_price, 'currency', v_cur,
        'source', rec.src, 'pricing_sheet_id', v_sheet, 'pricing_sheet_name', rec.name,
        'override_id', null, 'tier_min_quantity', rec.min_quantity,
        'effective_date', rec.effective_date, 'manual', false, 'warning', null);
    end if;
  end loop;

  -- 5) Authorized manual price (explicitly supplied, with a reason)
  if p_manual_price is not null then
    if p_manual_price <= 0 then
      raise exception 'Manual price must be greater than zero.';
    end if;
    if coalesce(btrim(p_manual_reason),'') = '' then
      raise exception 'Manual pricing requires an explicit reason.';
    end if;
    return jsonb_build_object('resolved', true, 'price', p_manual_price, 'currency', v_cur,
      'source','manual','pricing_sheet_id',null,'pricing_sheet_name',null,'override_id',null,
      'tier_min_quantity',null,'effective_date', p_effective,'manual', true,'warning', null);
  end if;

  -- 6) Unresolved — never zero, never cost.
  return jsonb_build_object('resolved', false, 'price', null, 'currency', v_cur,
    'source','unresolved','pricing_sheet_id',null,'pricing_sheet_name',null,'override_id',null,
    'tier_min_quantity',null,'effective_date', p_effective,'manual', false,
    'warning','No applicable price found for this product, quantity, currency and date.');
end;
$$;

-- ---- bulk_adjust_prices: percent or fixed, effective-dated, audited --------
create or replace function app.bulk_adjust_prices(
  p_sheet uuid, p_product_ids jsonb, p_type text, p_value numeric, p_reason text, p_actor uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_new numeric(14,4); v_count int := 0; v_skipped int := 0;
begin
  if p_type not in ('percent','fixed') then raise exception 'Unknown adjustment type %', p_type; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A reason is required for bulk adjustments.'; end if;

  for r in
    select * from public.pricing_sheet_items
     where pricing_sheet_id = p_sheet and effective_to is null and active
       and (p_product_ids is null or product_id in (select (jsonb_array_elements_text(p_product_ids))::uuid))
  loop
    v_new := case when p_type = 'percent' then app.money_round(r.selling_price * (1 + p_value/100.0), 4)
                  else app.money_round(r.selling_price + p_value, 4) end;
    if v_new <= 0 then v_skipped := v_skipped + 1; continue; end if;
    perform app.set_price(p_sheet, r.product_id, r.min_quantity, r.max_quantity, v_new, r.currency,
                          current_date, r.expiration_date, true, r.notes, 'manual',
                          'Bulk '||p_type||' '||p_value::text||': '||p_reason, null, p_actor);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('adjusted', v_count, 'skipped', v_skipped);
end;
$$;

-- ---- duplicate_pricing_model: copy model + its open bands ------------------
create or replace function app.duplicate_pricing_model(
  p_sheet uuid, p_name text, p_code text, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid;
begin
  insert into public.pricing_sheets (name, code, description, currency, effective_date, notes, status, is_default, created_by)
  select p_name, p_code, description, currency, current_date, notes, 'active', false, p_actor
    from public.pricing_sheets where id = p_sheet
  returning id into v_new;

  insert into public.pricing_sheet_items
    (pricing_sheet_id, product_id, selling_price, currency, min_quantity, max_quantity,
     effective_date, expiration_date, active, notes, created_by, updated_by)
  select v_new, product_id, selling_price, currency, min_quantity, max_quantity,
         current_date, expiration_date, true, notes, p_actor, p_actor
    from public.pricing_sheet_items
   where pricing_sheet_id = p_sheet and effective_to is null and active;
  return v_new;
end;
$$;

-- ---- commit_pricing_import: atomic, classified, effective-dated ------------
create or replace function app.commit_pricing_import(
  p_batch uuid, p_sheet uuid, p_rows jsonb, p_mode text, p_actor uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_sku citext; v_pid uuid; v_price numeric(14,4);
  v_min int; v_max int; v_cur char(3); v_existing numeric(14,4);
  v_class text; v_created int:=0; v_updated int:=0; v_tiers int:=0; v_skip int:=0; v_err int:=0;
begin
  if p_mode not in ('atomic','valid_only') then raise exception 'Unknown mode %', p_mode; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_sku := nullif(btrim(r->>'sku'),'');
    v_cur := coalesce(nullif(btrim(r->>'currency'),''),'USD');
    v_min := coalesce(nullif(btrim(r->>'min_quantity'),'')::int, 1);
    v_max := nullif(btrim(r->>'max_quantity'),'')::int;

    -- validity + unknown SKU gate
    v_pid := null;
    if v_sku is not null then select id into v_pid from public.products where sku = v_sku; end if;

    if (r ? 'valid' and (r->>'valid')='false') or v_sku is null
       or nullif(btrim(r->>'selling_price'),'') is null or v_pid is null then
      if p_mode = 'atomic' then
        raise exception 'Atomic pricing import aborted at row %: % .', coalesce(r->>'row_number','?'),
          case when v_pid is null and v_sku is not null then 'unknown SKU' else 'invalid row' end;
      end if;
      insert into public.pricing_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,
                case when v_pid is null and v_sku is not null then 'unknown_sku' else coalesce(r->>'classification','invalid') end,
                'skipped', coalesce(r->'errors','[]'::jsonb), r);
      v_skip := v_skip + 1; v_err := v_err + 1; continue;
    end if;

    v_price := (r->>'selling_price')::numeric;
    if v_price <= 0 then
      if p_mode = 'atomic' then raise exception 'Atomic pricing import aborted at row %: non-positive price.', coalesce(r->>'row_number','?'); end if;
      insert into public.pricing_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,'invalid','skipped','["Non-positive price"]'::jsonb, r);
      v_skip := v_skip + 1; v_err := v_err + 1; continue;
    end if;

    select selling_price into v_existing from public.pricing_sheet_items
      where pricing_sheet_id = p_sheet and product_id = v_pid and min_quantity = v_min
        and effective_to is null and active limit 1;

    if v_existing is null then
      v_class := case when v_min = 1 then 'new_price' else 'tier_added' end;
      perform app.set_price(p_sheet, v_pid, v_min, v_max, v_price, v_cur,
        coalesce(nullif(r->>'effective_date','')::date, current_date),
        nullif(r->>'expiration_date','')::date,
        not (r ? 'active' and (r->>'active')='false'), nullif(r->>'notes',''), 'import', null, p_batch, p_actor);
      if v_min = 1 then v_created := v_created + 1; else v_tiers := v_tiers + 1; end if;
    elsif v_price is distinct from v_existing then
      v_class := case when v_min = 1 then 'price_update' else 'tier_updated' end;
      perform app.set_price(p_sheet, v_pid, v_min, v_max, v_price, v_cur,
        coalesce(nullif(r->>'effective_date','')::date, current_date),
        nullif(r->>'expiration_date','')::date,
        not (r ? 'active' and (r->>'active')='false'), nullif(r->>'notes',''), 'import', null, p_batch, p_actor);
      if v_min = 1 then v_updated := v_updated + 1; else v_tiers := v_tiers + 1; end if;
    else
      v_class := 'no_change';
    end if;

    insert into public.pricing_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
      values (p_batch,(r->>'row_number')::int, v_sku::text, v_class,
              case when v_class='no_change' then 'no_change' else 'imported' end,
              coalesce(r->'errors','[]'::jsonb), r);
  end loop;

  update public.pricing_import_batches set
    status='committed', committed_at=now(), mode=p_mode, pricing_sheet_id=p_sheet,
    row_count=jsonb_array_length(p_rows), prices_created=v_created, prices_updated=v_updated,
    tiers_changed=v_tiers, rows_skipped=v_skip,
    summary=jsonb_build_object('created',v_created,'updated',v_updated,'tiers',v_tiers,'skipped',v_skip,'errors',v_err)
  where id = p_batch;

  return jsonb_build_object('created',v_created,'updated',v_updated,'tiers',v_tiers,'skipped',v_skip,'errors',v_err);
end;
$$;

-- ----------------------------------------------------------------------------
-- PUBLIC admin-checked wrappers (+ staff-callable resolver)
-- ----------------------------------------------------------------------------
create or replace function public.resolve_price(
  p_client_id uuid, p_product_id uuid, p_quantity numeric default 1, p_currency text default 'USD',
  p_selected_model uuid default null, p_effective date default current_date,
  p_manual_price numeric default null, p_manual_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  return app.resolve_price(p_client_id, p_product_id, p_quantity, coalesce(p_currency,'USD')::char(3),
                           p_selected_model, p_effective, p_manual_price, p_manual_reason);
end; $$;

create or replace function public.set_product_price(
  p_sheet uuid, p_product uuid, p_min_qty int, p_max_qty int, p_price numeric, p_currency text,
  p_effective date, p_expiration date, p_active boolean, p_notes text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may edit pricing.' using errcode='42501'; end if;
  return app.set_price(p_sheet, p_product, coalesce(p_min_qty,1), p_max_qty, p_price, coalesce(p_currency,'USD')::char(3),
                       coalesce(p_effective,current_date), p_expiration, coalesce(p_active,true), p_notes, 'manual', p_reason, null, auth.uid());
end; $$;

create or replace function public.set_client_override(
  p_client uuid, p_product uuid, p_min_qty int, p_max_qty int, p_price numeric, p_currency text,
  p_effective date, p_expiration date, p_active boolean, p_reason text, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may manage overrides.' using errcode='42501'; end if;
  return app.set_override(p_client, p_product, coalesce(p_min_qty,1), p_max_qty, p_price, coalesce(p_currency,'USD')::char(3),
                          coalesce(p_effective,current_date), p_expiration, coalesce(p_active,true), p_reason, p_notes, null, auth.uid());
end; $$;

create or replace function public.assign_pricing_model(
  p_client uuid, p_sheet uuid, p_effective date, p_expiration date, p_notes text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may assign pricing models.' using errcode='42501'; end if;
  perform app.assign_pricing_model(p_client, p_sheet, p_effective, p_expiration, p_notes, auth.uid());
end; $$;

create or replace function public.bulk_adjust_prices(
  p_sheet uuid, p_product_ids jsonb, p_type text, p_value numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may run bulk adjustments.' using errcode='42501'; end if;
  return app.bulk_adjust_prices(p_sheet, p_product_ids, p_type, p_value, p_reason, auth.uid());
end; $$;

create or replace function public.duplicate_pricing_model(
  p_sheet uuid, p_name text, p_code text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may duplicate models.' using errcode='42501'; end if;
  return app.duplicate_pricing_model(p_sheet, p_name, p_code, auth.uid());
end; $$;

create or replace function public.import_pricing(
  p_batch uuid, p_sheet uuid, p_rows jsonb, p_mode text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may import pricing.' using errcode='42501'; end if;
  return app.commit_pricing_import(p_batch, p_sheet, p_rows, p_mode, auth.uid());
end; $$;

revoke all on function
  public.resolve_price(uuid,uuid,numeric,text,uuid,date,numeric,text),
  public.set_product_price(uuid,uuid,int,int,numeric,text,date,date,boolean,text,text),
  public.set_client_override(uuid,uuid,int,int,numeric,text,date,date,boolean,text,text),
  public.assign_pricing_model(uuid,uuid,date,date,text),
  public.bulk_adjust_prices(uuid,jsonb,text,numeric,text),
  public.duplicate_pricing_model(uuid,text,text),
  public.import_pricing(uuid,uuid,jsonb,text)
from public, anon;
grant execute on function
  public.resolve_price(uuid,uuid,numeric,text,uuid,date,numeric,text),
  public.set_product_price(uuid,uuid,int,int,numeric,text,date,date,boolean,text,text),
  public.set_client_override(uuid,uuid,int,int,numeric,text,date,date,boolean,text,text),
  public.assign_pricing_model(uuid,uuid,date,date,text),
  public.bulk_adjust_prices(uuid,jsonb,text,numeric,text),
  public.duplicate_pricing_model(uuid,text,text),
  public.import_pricing(uuid,uuid,jsonb,text)
to authenticated;
