-- ============================================================================
-- Aurum Supply House · 0110 · M1 import pipeline + atomic commit RPC (ADDITIVE)
-- ============================================================================

-- ---- Extend the import-batch record with M1 metadata ------------------------
alter table public.catalog_import_batches
  add column if not exists file_type         text,
  add column if not exists worksheet         text,
  add column if not exists mode              text,           -- 'atomic' | 'valid_only'
  add column if not exists products_created  int  not null default 0,
  add column if not exists products_updated  int  not null default 0,
  add column if not exists costs_updated     int  not null default 0,
  add column if not exists rows_skipped      int  not null default 0,
  add column if not exists error_report_path text,
  add column if not exists kind              text not null default 'catalog'; -- reusable for pricing later

-- ---- Row-level results, for the import history drill-down -------------------
create table if not exists public.catalog_import_rows (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.catalog_import_batches(id) on delete cascade,
  row_number     int,
  sku            text,
  classification text,   -- new | no_change | product_update | cost_update | product_and_cost_update | invalid | duplicate_in_file
  status         text,   -- imported | no_change | skipped | failed
  messages       jsonb not null default '[]'::jsonb,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_import_rows_batch on public.catalog_import_rows(batch_id);

-- ----------------------------------------------------------------------------
-- commit_catalog_import : applies an already-parsed, validated, classified set
-- of rows to the catalog in a SINGLE TRANSACTION (this function body = one txn).
--
-- p_mode = 'atomic'     → any invalid/failed row raises → ENTIRE import rolls back.
-- p_mode = 'valid_only' → invalid rows are recorded as skipped; valid rows apply.
--
-- Products are matched by SKU only (never by name). Products absent from the
-- sheet are never deleted. Cost changes flow through app.record_cost_change so
-- history is preserved. Returns a jsonb summary.
-- ----------------------------------------------------------------------------
create or replace function app.commit_catalog_import(
  p_batch uuid,
  p_rows  jsonb,
  p_mode  text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r          jsonb;
  v_sku      citext;
  v_name     text;
  v_existing public.products%rowtype;
  v_id       uuid;
  v_cur      char(3);
  v_has_cost boolean;
  v_new_cost numeric(14,4);
  v_data_changed boolean;
  v_cost_changed boolean;
  v_status   product_status;
  v_class    text;
  v_rowstat  text;
  v_created  int := 0;
  v_updated  int := 0;
  v_costs    int := 0;
  v_skipped  int := 0;
  v_errcount int := 0;
begin
  if p_mode not in ('atomic','valid_only') then
    raise exception 'Unknown import mode: %', p_mode;
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_sku  := nullif(btrim(r->>'sku'), '');
    v_name := nullif(btrim(r->>'name'), '');
    v_cur  := coalesce(nullif(btrim(r->>'currency'), ''), 'USD');

    -- ---- validity gate ----
    if (r ? 'valid' and (r->>'valid') = 'false') or v_sku is null or v_name is null then
      if p_mode = 'atomic' then
        raise exception 'Atomic import aborted at row %: invalid row.', coalesce(r->>'row_number','?');
      end if;
      insert into public.catalog_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,
                coalesce(r->>'classification','invalid'), 'skipped',
                coalesce(r->'errors','[]'::jsonb), r);
      v_skipped := v_skipped + 1; v_errcount := v_errcount + 1;
      continue;
    end if;

    v_has_cost := (r ? 'true_cost') and nullif(btrim(r->>'true_cost'), '') is not null;
    if v_has_cost then
      v_new_cost := (r->>'true_cost')::numeric;
      if v_new_cost < 0 then
        if p_mode = 'atomic' then
          raise exception 'Atomic import aborted at row %: negative cost.', coalesce(r->>'row_number','?');
        end if;
        insert into public.catalog_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
          values (p_batch,(r->>'row_number')::int, v_sku::text,'invalid','skipped',
                  '["Negative cost"]'::jsonb, r);
        v_skipped := v_skipped + 1; v_errcount := v_errcount + 1;
        continue;
      end if;
    end if;

    v_status := case when (r ? 'active' and (r->>'active') = 'false')
                     then 'discontinued' else 'active' end::product_status;

    select * into v_existing from public.products where sku = v_sku;

    if not found then
      -- ---- NEW PRODUCT ----
      insert into public.products
        (sku,name,description,strength,product_form,unit_of_measure,manufacturer_id,
         manufacturer_sku,category,pack_size,moq,lead_time_days,notes,currency,status,created_by)
      values
        (v_sku, v_name, nullif(r->>'description',''), nullif(r->>'strength',''),
         nullif(r->>'product_form',''), nullif(r->>'unit_of_measure',''),
         nullif(btrim(r->>'manufacturer_id'),'')::uuid, nullif(r->>'manufacturer_sku',''),
         nullif(r->>'category',''), nullif(r->>'pack_size',''),
         nullif(btrim(r->>'moq'),'')::int, nullif(btrim(r->>'lead_time_days'),'')::int,
         nullif(r->>'notes',''), v_cur, v_status, p_actor)
      returning id into v_id;

      if v_has_cost then
        perform app.record_cost_change(v_id, v_new_cost, v_cur, 'import', null, p_batch, p_actor);
      end if;

      v_created := v_created + 1;
      insert into public.catalog_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text,'new','imported',
                coalesce(r->'errors','[]'::jsonb), r);
    else
      -- ---- EXISTING PRODUCT: coalesce provided-over-existing, detect change ----
      v_data_changed :=
           (nullif(r->>'name','')            is not null and r->>'name'            is distinct from v_existing.name)
        or (nullif(r->>'description','')      is not null and r->>'description'     is distinct from v_existing.description)
        or (nullif(r->>'strength','')         is not null and r->>'strength'        is distinct from v_existing.strength)
        or (nullif(r->>'product_form','')     is not null and r->>'product_form'    is distinct from v_existing.product_form)
        or (nullif(r->>'unit_of_measure','')  is not null and r->>'unit_of_measure' is distinct from v_existing.unit_of_measure)
        or (nullif(r->>'manufacturer_sku','') is not null and r->>'manufacturer_sku' is distinct from v_existing.manufacturer_sku)
        or (nullif(r->>'category','')         is not null and r->>'category'        is distinct from v_existing.category)
        or (nullif(r->>'pack_size','')        is not null and r->>'pack_size'       is distinct from v_existing.pack_size)
        or (nullif(btrim(r->>'moq'),'')       is not null and (r->>'moq')::int      is distinct from v_existing.moq)
        or (nullif(btrim(r->>'lead_time_days'),'') is not null and (r->>'lead_time_days')::int is distinct from v_existing.lead_time_days)
        or (nullif(r->>'notes','')            is not null and r->>'notes'           is distinct from v_existing.notes)
        or (nullif(btrim(r->>'manufacturer_id'),'') is not null and (r->>'manufacturer_id')::uuid is distinct from v_existing.manufacturer_id)
        or ((r ? 'active') and v_status is distinct from v_existing.status);

      if v_data_changed then
        update public.products set
          name             = coalesce(nullif(r->>'name',''), name),
          description       = coalesce(nullif(r->>'description',''), description),
          strength         = coalesce(nullif(r->>'strength',''), strength),
          product_form     = coalesce(nullif(r->>'product_form',''), product_form),
          unit_of_measure  = coalesce(nullif(r->>'unit_of_measure',''), unit_of_measure),
          manufacturer_id  = coalesce(nullif(btrim(r->>'manufacturer_id'),'')::uuid, manufacturer_id),
          manufacturer_sku = coalesce(nullif(r->>'manufacturer_sku',''), manufacturer_sku),
          category         = coalesce(nullif(r->>'category',''), category),
          pack_size        = coalesce(nullif(r->>'pack_size',''), pack_size),
          moq              = coalesce(nullif(btrim(r->>'moq'),'')::int, moq),
          lead_time_days   = coalesce(nullif(btrim(r->>'lead_time_days'),'')::int, lead_time_days),
          notes            = coalesce(nullif(r->>'notes',''), notes),
          status           = case when (r ? 'active') then v_status else status end
        where id = v_existing.id;
      end if;

      v_cost_changed := v_has_cost and (v_new_cost is distinct from v_existing.current_true_cost);
      if v_cost_changed then
        perform app.record_cost_change(v_existing.id, v_new_cost, v_cur, 'import', null, p_batch, p_actor);
        v_costs := v_costs + 1;
      end if;

      if v_data_changed and v_cost_changed then v_class := 'product_and_cost_update';
      elsif v_cost_changed then                v_class := 'cost_update';
      elsif v_data_changed then                v_class := 'product_update';
      else                                     v_class := 'no_change';
      end if;

      if v_data_changed or v_cost_changed then
        v_updated := v_updated + 1;
        v_rowstat := 'imported';
      else
        v_rowstat := 'no_change';
      end if;

      insert into public.catalog_import_rows(batch_id,row_number,sku,classification,status,messages,raw)
        values (p_batch,(r->>'row_number')::int, v_sku::text, v_class, v_rowstat,
                coalesce(r->'errors','[]'::jsonb), r);
    end if;
  end loop;

  update public.catalog_import_batches set
    status           = 'committed',
    committed_at     = now(),
    mode             = p_mode,
    row_count        = jsonb_array_length(p_rows),
    products_created = v_created,
    products_updated = v_updated,
    costs_updated    = v_costs,
    rows_skipped     = v_skipped,
    summary          = jsonb_build_object(
                         'created', v_created, 'updated', v_updated,
                         'costs_updated', v_costs, 'skipped', v_skipped, 'errors', v_errcount)
  where id = p_batch;

  return jsonb_build_object(
    'created', v_created, 'updated', v_updated, 'costs_updated', v_costs,
    'skipped', v_skipped, 'errors', v_errcount);
end;
$$;

-- ----------------------------------------------------------------------------
-- PUBLIC, admin-checked wrappers (PostgREST only exposes the public schema;
-- the app schema is private). These are the callable RPC surface for the app.
-- SECURITY DEFINER so they may call into app.* on the caller's behalf, but each
-- enforces app.is_admin() first, using the caller's real identity via auth.uid().
-- ----------------------------------------------------------------------------
create or replace function public.import_catalog(
  p_batch uuid, p_rows jsonb, p_mode text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may import the catalog.' using errcode = '42501';
  end if;
  return app.commit_catalog_import(p_batch, p_rows, p_mode, auth.uid());
end;
$$;

create or replace function public.record_product_cost(
  p_product uuid, p_new_cost numeric, p_currency text, p_reason text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may change product cost.' using errcode = '42501';
  end if;
  return app.record_cost_change(p_product, p_new_cost, coalesce(p_currency,'USD')::char(3),
                                'manual', p_reason, null, auth.uid());
end;
$$;

revoke all on function public.import_catalog(uuid, jsonb, text) from public, anon;
revoke all on function public.record_product_cost(uuid, numeric, text, text) from public, anon;
grant execute on function public.import_catalog(uuid, jsonb, text) to authenticated;
grant execute on function public.record_product_cost(uuid, numeric, text, text) to authenticated;
