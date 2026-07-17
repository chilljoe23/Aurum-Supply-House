-- ============================================================================
-- Aurum Supply House · 0280 · M6-prerequisite: Manufacturer cost RPCs (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Transactional, SECURITY DEFINER functions in the private app.* schema, each
-- fronted by an admin-checked public.* wrapper (PostgREST only exposes public).
-- Mirrors the M2 pricing RPC design (0140).
--
--   app.set_manufacturer_cost      — close-and-append one cost band (append-only)
--   app.upsert_manufacturer_product— get-or-create a supply relationship
--   app.resolve_manufacturer_cost  — the deterministic PO cost resolver (M6 uses)
--   app.commit_manufacturer_cost_import — atomic, classified cost-file commit
--   app.promote_manufacturer_cost  — the ONLY sanctioned bridge to catalog true cost
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app.set_manufacturer_cost — the ONLY sanctioned way to change a manufacturer
-- cost band. Closes the open band with the same (relationship, min_quantity),
-- then appends a new effective-dated band carrying previous_cost. Reason
-- required for manual changes. Overlapping/ambiguous tiers are rejected by the
-- excl_mch_no_overlap constraint (deterministic).
-- ----------------------------------------------------------------------------
create or replace function app.set_manufacturer_cost(
  p_relationship uuid, p_min_qty int, p_max_qty int, p_cost numeric, p_currency char(3),
  p_effective date, p_expiration date, p_active boolean, p_source cost_source,
  p_reason text, p_batch uuid, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_prev numeric(14,4); v_id uuid; v_min int := coalesce(p_min_qty, 1);
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'Manufacturer unit cost must be greater than zero (got %).', p_cost;
  end if;
  if p_max_qty is not null and p_max_qty < v_min then
    raise exception 'Tier maximum quantity (%) is below minimum (%).', p_max_qty, v_min;
  end if;
  if p_source = 'manual' and coalesce(btrim(p_reason),'') = '' then
    raise exception 'A reason is required for manual manufacturer cost changes.';
  end if;
  if p_expiration is not null and coalesce(p_effective, current_date) > p_expiration then
    raise exception 'Expiration date is before effective date.';
  end if;

  select unit_cost into v_prev from public.manufacturer_cost_history
   where manufacturer_product_id = p_relationship and min_quantity = v_min
     and effective_to is null and active
   limit 1;

  update public.manufacturer_cost_history
     set effective_to = coalesce(p_effective, current_date)
   where manufacturer_product_id = p_relationship and min_quantity = v_min
     and effective_to is null and active;

  insert into public.manufacturer_cost_history
    (manufacturer_product_id, min_quantity, max_quantity, unit_cost, currency,
     effective_date, effective_to, expiration_date, active, previous_cost, source, reason,
     source_import_batch, created_by)
  values
    (p_relationship, v_min, p_max_qty, p_cost, coalesce(p_currency,'USD'),
     coalesce(p_effective, current_date), null, p_expiration, coalesce(p_active, true),
     v_prev, coalesce(p_source, 'manual'), p_reason, p_batch, p_actor)
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.upsert_manufacturer_product — get-or-create a supply relationship and
-- refresh its (non-cost) terms. Never touches cost bands. Blank/NULL optional
-- fields never overwrite existing values (coalesce provided-over-existing).
-- ----------------------------------------------------------------------------
create or replace function app.upsert_manufacturer_product(
  p_manufacturer uuid, p_product uuid, p_manufacturer_sku text, p_description text,
  p_currency char(3), p_moq int, p_order_multiple int, p_lead_time int,
  p_active boolean, p_notes text, p_batch uuid, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.manufacturer_products
    (manufacturer_id, product_id, manufacturer_sku, manufacturer_description, currency,
     moq, order_multiple, lead_time_days, active, notes, source_import_batch, created_by, updated_by)
  values
    (p_manufacturer, p_product, nullif(btrim(p_manufacturer_sku),''), nullif(btrim(p_description),''),
     coalesce(p_currency,'USD'), p_moq, p_order_multiple, p_lead_time,
     coalesce(p_active, true), nullif(btrim(p_notes),''), p_batch, p_actor, p_actor)
  on conflict (manufacturer_id, product_id) do update set
     manufacturer_sku         = coalesce(nullif(btrim(excluded.manufacturer_sku),''), public.manufacturer_products.manufacturer_sku),
     manufacturer_description = coalesce(nullif(btrim(excluded.manufacturer_description),''), public.manufacturer_products.manufacturer_description),
     currency                 = coalesce(excluded.currency, public.manufacturer_products.currency),
     moq                      = coalesce(excluded.moq, public.manufacturer_products.moq),
     order_multiple           = coalesce(excluded.order_multiple, public.manufacturer_products.order_multiple),
     lead_time_days           = coalesce(excluded.lead_time_days, public.manufacturer_products.lead_time_days),
     active                   = excluded.active,
     notes                    = coalesce(excluded.notes, public.manufacturer_products.notes),
     updated_by               = excluded.updated_by
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- app.resolve_manufacturer_cost — the deterministic cost resolver M6 consumes.
-- Given (manufacturer, product, quantity, currency, effective date) returns the
-- resolved manufacturer cost and full provenance as jsonb. Highest applicable
-- min_quantity band wins (deterministic). NEVER returns zero when unresolved,
-- NEVER falls back to a customer selling price. Advisory MOQ/order-multiple
-- warnings are surfaced but never block resolution.
-- ----------------------------------------------------------------------------
create or replace function app.resolve_manufacturer_cost(
  p_manufacturer uuid,
  p_product      uuid,
  p_quantity     numeric default 1,
  p_currency     char(3) default 'USD',
  p_effective    date    default current_date
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cur char(3) := coalesce(p_currency, 'USD');
  v_qty numeric := coalesce(p_quantity, 1);
  v_eff date    := coalesce(p_effective, current_date);
  mp    record;
  rec   record;
  v_src text;
  v_warn jsonb := '[]'::jsonb;
begin
  -- NB: the driving table is aliased `rel` (not `mp`) so it never collides with the
  -- `mp` record variable — otherwise `mp.<col>` would be an ambiguous column reference
  -- under plpgsql's default variable_conflict = error.
  select rel.id, rel.manufacturer_id, rel.product_id, rel.active, rel.moq, rel.order_multiple,
         rel.lead_time_days, m.status as mfr_status, p.status as prod_status
    into mp
    from public.manufacturer_products rel
    join public.manufacturers m on m.id = rel.manufacturer_id
    join public.products p on p.id = rel.product_id
   where rel.manufacturer_id = p_manufacturer and rel.product_id = p_product;

  if not found then
    return jsonb_build_object('resolved', false, 'unit_cost', null, 'currency', v_cur,
      'source','unresolved','manufacturer_product_id', null, 'cost_history_id', null,
      'tier_min_quantity', null, 'tier_max_quantity', null, 'effective_date', v_eff,
      'moq', null, 'order_multiple', null, 'lead_time_days', null, 'warnings', '["no_relationship"]'::jsonb,
      'warning','No supply relationship exists for this manufacturer and product.');
  end if;

  if not mp.active or mp.mfr_status <> 'active' or mp.prod_status <> 'active' then
    return jsonb_build_object('resolved', false, 'unit_cost', null, 'currency', v_cur,
      'source','unresolved','manufacturer_product_id', mp.id, 'cost_history_id', null,
      'tier_min_quantity', null, 'tier_max_quantity', null, 'effective_date', v_eff,
      'moq', mp.moq, 'order_multiple', mp.order_multiple, 'lead_time_days', mp.lead_time_days,
      'warnings', '["inactive"]'::jsonb,
      'warning','The manufacturer, product, or supply relationship is inactive.');
  end if;

  -- Highest applicable min_quantity band covering the quantity (open, in-window).
  select h.id, h.unit_cost, h.min_quantity, h.max_quantity, h.effective_date
    into rec
    from public.manufacturer_cost_history h
   where h.manufacturer_product_id = mp.id and h.active
     and h.effective_to is null and h.currency = v_cur
     and h.effective_date <= v_eff
     and (h.expiration_date is null or h.expiration_date >= v_eff)
     and h.min_quantity <= v_qty
     and (h.max_quantity is null or h.max_quantity >= v_qty)
   order by h.min_quantity desc
   limit 1;

  if not found then
    return jsonb_build_object('resolved', false, 'unit_cost', null, 'currency', v_cur,
      'source','unresolved','manufacturer_product_id', mp.id, 'cost_history_id', null,
      'tier_min_quantity', null, 'tier_max_quantity', null, 'effective_date', v_eff,
      'moq', mp.moq, 'order_multiple', mp.order_multiple, 'lead_time_days', mp.lead_time_days,
      'warnings', '["no_cost"]'::jsonb,
      'warning','No active manufacturer cost found for this quantity, currency and date.');
  end if;

  v_src := case when rec.min_quantity = 1 then 'base' else 'tier' end;

  if mp.moq is not null and v_qty < mp.moq then
    v_warn := v_warn || to_jsonb('below_moq'::text);
  end if;
  if mp.order_multiple is not null and mp.order_multiple > 1 and (v_qty::numeric % mp.order_multiple) <> 0 then
    v_warn := v_warn || to_jsonb('not_order_multiple'::text);
  end if;

  return jsonb_build_object(
    'resolved', true, 'unit_cost', rec.unit_cost, 'currency', v_cur, 'source', v_src,
    'manufacturer_product_id', mp.id, 'cost_history_id', rec.id,
    'tier_min_quantity', rec.min_quantity, 'tier_max_quantity', rec.max_quantity,
    'effective_date', rec.effective_date, 'moq', mp.moq, 'order_multiple', mp.order_multiple,
    'lead_time_days', mp.lead_time_days, 'warnings', v_warn, 'warning', null);
end;
$$;

-- ----------------------------------------------------------------------------
-- app.commit_manufacturer_cost_import — applies a parsed/validated/classified
-- set of rows for ONE manufacturer in a single transaction. Products are matched
-- by SKU ONLY (never by name); catalog products are NEVER created here. Cost
-- bands flow through app.set_manufacturer_cost so history is preserved.
--   p_mode='atomic'     → any invalid row raises → whole import rolls back.
--   p_mode='valid_only' → invalid rows recorded as skipped; valid rows apply.
-- ----------------------------------------------------------------------------
create or replace function app.commit_manufacturer_cost_import(
  p_batch uuid, p_manufacturer uuid, p_rows jsonb, p_mode text, p_actor uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_sku citext; v_pid uuid; v_cost numeric(14,4);
  v_min int; v_max int; v_cur char(3);
  v_rel public.manufacturer_products%rowtype;
  v_relid uuid; v_existing_cost numeric(14,4); v_existing_max int;
  v_class text; v_data_changed boolean;
  v_new_sku text; v_new_desc text; v_new_moq int; v_new_om int; v_new_lt int;
  v_rels int:=0; v_cnew int:=0; v_cupd int:=0; v_tiers int:=0; v_skip int:=0; v_err int:=0;
  v_mfr_active boolean;
begin
  if p_mode not in ('atomic','valid_only') then raise exception 'Unknown mode %', p_mode; end if;

  select (status = 'active') into v_mfr_active from public.manufacturers where id = p_manufacturer;
  if v_mfr_active is null then raise exception 'Manufacturer not found.'; end if;
  if not v_mfr_active and p_mode = 'atomic' then
    raise exception 'Manufacturer is inactive; activate it before an atomic import.';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_sku := nullif(btrim(r->>'sku'),'');
    v_cur := coalesce(nullif(btrim(r->>'currency'),''), 'USD');
    v_min := coalesce(nullif(btrim(r->>'min_quantity'),'')::int, 1);
    v_max := nullif(btrim(r->>'max_quantity'),'')::int;

    v_pid := null;
    if v_sku is not null then select id into v_pid from public.products where sku = v_sku; end if;

    -- validity + unknown SKU gate (SKU + positive cost + known product required)
    if (r ? 'valid' and (r->>'valid')='false') or v_sku is null
       or nullif(btrim(r->>'unit_cost'),'') is null or v_pid is null then
      if p_mode = 'atomic' then
        raise exception 'Atomic manufacturer-cost import aborted at row %: %.', coalesce(r->>'row_number','?'),
          case when v_pid is null and v_sku is not null then 'unknown SKU' else 'invalid row' end;
      end if;
      insert into public.manufacturer_cost_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,
                case when v_pid is null and v_sku is not null then 'unknown_sku' else coalesce(r->>'classification','invalid') end,
                'skipped', coalesce(r->'errors','[]'::jsonb), r);
      v_skip := v_skip + 1; v_err := v_err + 1; continue;
    end if;

    v_cost := (r->>'unit_cost')::numeric;
    if v_cost <= 0 then
      if p_mode = 'atomic' then raise exception 'Atomic manufacturer-cost import aborted at row %: non-positive cost.', coalesce(r->>'row_number','?'); end if;
      insert into public.manufacturer_cost_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,'invalid','skipped','["Cost must be greater than zero"]'::jsonb, r);
      v_skip := v_skip + 1; v_err := v_err + 1; continue;
    end if;

    v_new_sku  := nullif(btrim(r->>'manufacturer_sku'),'');
    v_new_desc := nullif(btrim(r->>'manufacturer_description'),'');
    v_new_moq  := nullif(btrim(r->>'moq'),'')::int;
    v_new_om   := nullif(btrim(r->>'order_multiple'),'')::int;
    v_new_lt   := nullif(btrim(r->>'lead_time_days'),'')::int;

    select * into v_rel from public.manufacturer_products
     where manufacturer_id = p_manufacturer and product_id = v_pid;

    if not found then
      -- NEW supply relationship (+ its first cost band)
      insert into public.manufacturer_products
        (manufacturer_id, product_id, manufacturer_sku, manufacturer_description, currency,
         moq, order_multiple, lead_time_days, active, notes, source_import_batch, created_by, updated_by)
      values
        (p_manufacturer, v_pid, v_new_sku, v_new_desc, v_cur,
         v_new_moq, v_new_om, v_new_lt, true, nullif(btrim(r->>'notes'),''), p_batch, p_actor, p_actor)
      returning id into v_relid;
      v_rels := v_rels + 1;

      perform app.set_manufacturer_cost(v_relid, v_min, v_max, v_cost, v_cur,
        coalesce(nullif(r->>'effective_date','')::date, current_date),
        nullif(r->>'expiration_date','')::date,
        not (r ? 'active' and (r->>'active')='false'), 'import', null, p_batch, p_actor);
      if v_min = 1 then v_cnew := v_cnew + 1; else v_tiers := v_tiers + 1; end if;
      v_class := 'new_manufacturer_product';
    else
      v_relid := v_rel.id;

      v_data_changed :=
           (v_new_sku  is not null and v_new_sku  is distinct from v_rel.manufacturer_sku)
        or (v_new_desc is not null and v_new_desc is distinct from v_rel.manufacturer_description)
        or (v_new_moq  is not null and v_new_moq  is distinct from v_rel.moq)
        or (v_new_om   is not null and v_new_om   is distinct from v_rel.order_multiple)
        or (v_new_lt   is not null and v_new_lt   is distinct from v_rel.lead_time_days);

      if v_data_changed then
        update public.manufacturer_products set
          manufacturer_sku         = coalesce(v_new_sku, manufacturer_sku),
          manufacturer_description = coalesce(v_new_desc, manufacturer_description),
          moq                      = coalesce(v_new_moq, moq),
          order_multiple           = coalesce(v_new_om, order_multiple),
          lead_time_days           = coalesce(v_new_lt, lead_time_days),
          updated_by               = p_actor
        where id = v_relid;
      end if;

      select unit_cost, max_quantity into v_existing_cost, v_existing_max
        from public.manufacturer_cost_history
       where manufacturer_product_id = v_relid and min_quantity = v_min
         and effective_to is null and active
       limit 1;

      if v_existing_cost is null then
        perform app.set_manufacturer_cost(v_relid, v_min, v_max, v_cost, v_cur,
          coalesce(nullif(r->>'effective_date','')::date, current_date),
          nullif(r->>'expiration_date','')::date,
          not (r ? 'active' and (r->>'active')='false'), 'import', null, p_batch, p_actor);
        if v_min = 1 then v_cnew := v_cnew + 1; v_class := 'new_cost';
        else v_tiers := v_tiers + 1; v_class := 'tier_added'; end if;
      elsif v_cost is distinct from v_existing_cost then
        -- Preserve the band's existing bounds when the update row omits max_quantity,
        -- so a base-cost update never silently becomes unbounded and collides with tiers.
        perform app.set_manufacturer_cost(v_relid, v_min, coalesce(v_max, v_existing_max), v_cost, v_cur,
          coalesce(nullif(r->>'effective_date','')::date, current_date),
          nullif(r->>'expiration_date','')::date,
          not (r ? 'active' and (r->>'active')='false'), 'import', null, p_batch, p_actor);
        if v_min = 1 then v_cupd := v_cupd + 1; v_class := 'cost_update';
        else v_tiers := v_tiers + 1; v_class := 'tier_updated'; end if;
      elsif v_data_changed then
        v_class := 'product_data_update';
      else
        v_class := 'no_change';
      end if;
    end if;

    insert into public.manufacturer_cost_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
      values (p_batch,(r->>'row_number')::int, v_sku::text, v_class,
              case when v_class='no_change' then 'no_change' else 'imported' end,
              coalesce(r->'errors','[]'::jsonb), r);
  end loop;

  update public.manufacturer_cost_import_batches set
    status='committed', committed_at=now(), mode=p_mode, manufacturer_id=p_manufacturer,
    row_count=jsonb_array_length(p_rows), relationships_created=v_rels,
    costs_created=v_cnew, costs_updated=v_cupd, tiers_changed=v_tiers, rows_skipped=v_skip,
    summary=jsonb_build_object('relationships',v_rels,'costs_created',v_cnew,'costs_updated',v_cupd,
                               'tiers',v_tiers,'skipped',v_skip,'errors',v_err)
  where id = p_batch;

  return jsonb_build_object('relationships',v_rels,'costs_created',v_cnew,'costs_updated',v_cupd,
                            'tiers',v_tiers,'skipped',v_skip,'errors',v_err);
end;
$$;

-- ----------------------------------------------------------------------------
-- app.promote_manufacturer_cost — the ONLY sanctioned bridge from a manufacturer
-- cost to the catalog's current true cost. Resolves the manufacturer's current
-- BASE (qty 1) cost and writes it through the EXISTING app.record_cost_change
-- path (append-only product_cost_history + refresh_current_cost trigger), so all
-- downstream invoice/commission behaviour is unchanged. Optionally records the
-- manufacturer as the product's preferred source. Manufacturer cost imports
-- NEVER call this — promotion is always an explicit Owner/Admin action.
-- ----------------------------------------------------------------------------
create or replace function app.promote_manufacturer_cost(
  p_manufacturer uuid, p_product uuid, p_reason text, p_effective date,
  p_set_preferred boolean, p_actor uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb; v_cost numeric(14,4); v_cur char(3); v_hist uuid; v_relcur char(3);
begin
  select currency into v_relcur from public.manufacturer_products
   where manufacturer_id = p_manufacturer and product_id = p_product;

  v_res := app.resolve_manufacturer_cost(p_manufacturer, p_product, 1,
             coalesce(v_relcur, 'USD'), coalesce(p_effective, current_date));

  if not (v_res->>'resolved')::boolean then
    raise exception 'Cannot promote manufacturer cost: %', coalesce(v_res->>'warning', 'no resolvable base cost.');
  end if;

  v_cost := (v_res->>'unit_cost')::numeric;
  v_cur  := v_res->>'currency';

  -- Update the catalog true cost through the existing sanctioned path ONLY.
  v_hist := app.record_cost_change(
    p_product, v_cost, v_cur, 'manual',
    coalesce(nullif(btrim(p_reason),''), 'Promoted manufacturer cost to catalog true cost'),
    null, p_actor, coalesce(p_effective, current_date));

  if coalesce(p_set_preferred, true) then
    update public.products set preferred_manufacturer_id = p_manufacturer where id = p_product;
  end if;

  return jsonb_build_object('promoted', true, 'true_cost', v_cost, 'currency', v_cur,
    'cost_history_id', v_hist, 'manufacturer_product_id', v_res->>'manufacturer_product_id');
end;
$$;

-- ============================================================================
-- PUBLIC admin-checked wrappers. Cost data is admin-only in Aurum, so EVERY
-- wrapper here (including the resolver) requires app.is_admin(). Sales reps can
-- neither read manufacturer costs nor call these RPCs.
-- ============================================================================
create or replace function public.resolve_manufacturer_cost(
  p_manufacturer uuid, p_product uuid, p_quantity numeric default 1,
  p_currency text default 'USD', p_effective date default current_date
) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may resolve manufacturer costs.' using errcode='42501'; end if;
  return app.resolve_manufacturer_cost(p_manufacturer, p_product, coalesce(p_quantity,1),
           coalesce(p_currency,'USD')::char(3), coalesce(p_effective, current_date));
end; $$;

create or replace function public.set_manufacturer_cost(
  p_relationship uuid, p_min_qty int, p_max_qty int, p_cost numeric, p_currency text,
  p_effective date, p_expiration date, p_active boolean, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may edit manufacturer costs.' using errcode='42501'; end if;
  return app.set_manufacturer_cost(p_relationship, coalesce(p_min_qty,1), p_max_qty, p_cost,
           coalesce(p_currency,'USD')::char(3), coalesce(p_effective, current_date), p_expiration,
           coalesce(p_active, true), 'manual', p_reason, null, auth.uid());
end; $$;

create or replace function public.upsert_manufacturer_product(
  p_manufacturer uuid, p_product uuid, p_manufacturer_sku text, p_description text,
  p_currency text, p_moq int, p_order_multiple int, p_lead_time int, p_active boolean, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may manage manufacturer products.' using errcode='42501'; end if;
  return app.upsert_manufacturer_product(p_manufacturer, p_product, p_manufacturer_sku, p_description,
           coalesce(p_currency,'USD')::char(3), p_moq, p_order_multiple, p_lead_time,
           coalesce(p_active, true), p_notes, null, auth.uid());
end; $$;

create or replace function public.import_manufacturer_costs(
  p_batch uuid, p_manufacturer uuid, p_rows jsonb, p_mode text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may import manufacturer costs.' using errcode='42501'; end if;
  return app.commit_manufacturer_cost_import(p_batch, p_manufacturer, p_rows, p_mode, auth.uid());
end; $$;

create or replace function public.promote_manufacturer_cost(
  p_manufacturer uuid, p_product uuid, p_reason text, p_effective date default current_date,
  p_set_preferred boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then raise exception 'Only Owners and Admins may promote manufacturer costs.' using errcode='42501'; end if;
  return app.promote_manufacturer_cost(p_manufacturer, p_product, p_reason,
           coalesce(p_effective, current_date), coalesce(p_set_preferred, true), auth.uid());
end; $$;

revoke all on function
  public.resolve_manufacturer_cost(uuid,uuid,numeric,text,date),
  public.set_manufacturer_cost(uuid,int,int,numeric,text,date,date,boolean,text),
  public.upsert_manufacturer_product(uuid,uuid,text,text,text,int,int,int,boolean,text),
  public.import_manufacturer_costs(uuid,uuid,jsonb,text),
  public.promote_manufacturer_cost(uuid,uuid,text,date,boolean)
from public, anon;

grant execute on function
  public.resolve_manufacturer_cost(uuid,uuid,numeric,text,date),
  public.set_manufacturer_cost(uuid,int,int,numeric,text,date,date,boolean,text),
  public.upsert_manufacturer_product(uuid,uuid,text,text,text,int,int,int,boolean,text),
  public.import_manufacturer_costs(uuid,uuid,jsonb,text),
  public.promote_manufacturer_cost(uuid,uuid,text,date,boolean)
to authenticated;
