-- ============================================================================
-- Aurum Supply House · 0230 · M5 · Transactional commission RPCs + guards
-- ----------------------------------------------------------------------------
-- ADDITIVE. Every commission mutation flows through one of these SECURITY
-- DEFINER functions so permissions, snapshots, and lifecycle rules are enforced
-- at the DB — never trusted from the client. Each function is a single
-- transaction: any RAISE rolls the whole thing back.
--
--   create_commission    admin  attach a recipient to an invoice (pending/earned)
--   update_commission    admin  edit an editable (pending/earned) commission
--   approve_commission   admin  earned   → approved
--   pay_commission       admin  approved → paid (records method/reference/notes)
--   void_commission      admin  pending/earned/approved → void
--   bulk_approve_commissions  admin
--   bulk_pay_commissions      admin
--   preview_commission   admin  compute an amount for the builder (+GP warning)
--
-- Sales reps may VIEW their own commissions (via v_commissions, 0250) but can
-- never create, edit, approve, pay, or void — enforced here and in RLS (0260).
-- ============================================================================

-- ---- Shared validation helper ----------------------------------------------
create or replace function app.validate_commission_inputs(
  p_recipient_type commission_recipient_type,
  p_recipient_id   uuid,
  p_recipient_name text,
  p_commission_type commission_type,
  p_rate  numeric,
  p_units numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_recipient_name),'') = '' then
    raise exception 'A recipient name is required.';
  end if;
  if p_recipient_type = 'internal_user' then
    if p_recipient_id is null then
      raise exception 'An internal recipient must reference a user.';
    end if;
    if not exists (select 1 from public.profiles where id = p_recipient_id) then
      raise exception 'Internal recipient profile not found.';
    end if;
  else
    if p_recipient_id is not null then
      raise exception 'An external partner must not reference an internal user.';
    end if;
  end if;

  if p_rate is null or p_rate < 0 then
    raise exception 'A commission rate/amount must be zero or greater.';
  end if;
  if p_commission_type = 'per_unit' and coalesce(p_units,0) <= 0 then
    raise exception 'A per-unit commission requires a unit quantity greater than zero.';
  end if;
  if p_commission_type = 'flat' and p_rate <= 0 then
    raise exception 'A fixed-dollar commission must be greater than zero.';
  end if;
  if p_commission_type in ('percent_of_sale','percent_of_gross_profit') and p_rate > 1 then
    raise exception 'Enter a percentage as a fraction between 0 and 1 (e.g. 0.05 for 5%%).';
  end if;
end;
$$;

-- ---- create_commission ------------------------------------------------------
create or replace function app.create_commission(
  p_invoice        uuid,
  p_recipient_type commission_recipient_type,
  p_recipient_id   uuid,
  p_recipient_name text,
  p_recipient_email text,
  p_recipient_company text,
  p_payment_notes  text,
  p_commission_type commission_type,
  p_rate  numeric,
  p_units numeric,
  p_note  text,
  p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid; v_status commission_status;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may manage commissions.' using errcode = '42501';
  end if;

  select id, status into v from public.invoices where id = p_invoice;
  if v.id is null then raise exception 'Invoice not found.'; end if;
  if v.status = 'void' then raise exception 'Cannot add a commission to a void invoice.'; end if;

  perform app.validate_commission_inputs(
    p_recipient_type, p_recipient_id, p_recipient_name, p_commission_type, p_rate, p_units);

  -- A commission created against an already fully-paid invoice is earned on sight;
  -- otherwise it starts pending and earns when the invoice is fully paid.
  v_status := case when v.status = 'paid' then 'earned' else 'pending' end;

  insert into public.commissions(
    invoice_id, recipient_type, recipient_id, recipient_name, recipient_email,
    recipient_company, payment_notes, commission_type, rate, units, note,
    status, created_by, updated_by)
  values (
    p_invoice, p_recipient_type,
    case when p_recipient_type = 'internal_user' then p_recipient_id else null end,
    btrim(p_recipient_name), nullif(btrim(p_recipient_email),''),
    nullif(btrim(p_recipient_company),''), nullif(btrim(p_payment_notes),''),
    p_commission_type, p_rate, p_units, nullif(btrim(p_note),''),
    v_status, p_actor, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---- update_commission (edit an editable commission) ------------------------
create or replace function app.update_commission(
  p_commission uuid,
  p_recipient_type commission_recipient_type,
  p_recipient_id   uuid,
  p_recipient_name text,
  p_recipient_email text,
  p_recipient_company text,
  p_payment_notes  text,
  p_commission_type commission_type,
  p_rate  numeric,
  p_units numeric,
  p_note  text,
  p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; v_inv_status invoice_status; v_econ_change boolean;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may manage commissions.' using errcode = '42501';
  end if;

  select * into c from public.commissions where id = p_commission;
  if c.id is null then raise exception 'Commission not found.'; end if;
  if c.status = 'paid' then raise exception 'A paid commission is immutable and cannot be edited. Void and recreate to correct.'; end if;
  if c.status = 'void' then raise exception 'A void commission cannot be edited.'; end if;
  if c.status = 'approved' then raise exception 'Un-approve is not supported. Void and recreate to correct an approved commission.'; end if;

  perform app.validate_commission_inputs(
    p_recipient_type, p_recipient_id, p_recipient_name, p_commission_type, p_rate, p_units);

  select status into v_inv_status from public.invoices where id = c.invoice_id;
  v_econ_change := ( c.commission_type is distinct from p_commission_type
                  or c.rate  is distinct from p_rate
                  or c.units is distinct from p_units );
  if v_econ_change and v_inv_status <> 'draft' then
    raise exception 'Commission economics are locked once the invoice is issued. Void and recreate to correct.';
  end if;

  update public.commissions set
    recipient_type   = p_recipient_type,
    recipient_id     = case when p_recipient_type = 'internal_user' then p_recipient_id else null end,
    recipient_name   = btrim(p_recipient_name),
    recipient_email  = nullif(btrim(p_recipient_email),''),
    recipient_company= nullif(btrim(p_recipient_company),''),
    payment_notes    = nullif(btrim(p_payment_notes),''),
    commission_type  = p_commission_type,
    rate             = p_rate,
    units            = p_units,
    note             = nullif(btrim(p_note),''),
    updated_by       = p_actor
  where id = p_commission;
end;
$$;

-- ---- approve_commission (earned → approved) ---------------------------------
create or replace function app.approve_commission(p_commission uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may approve commissions.' using errcode = '42501';
  end if;
  select * into c from public.commissions where id = p_commission;
  if c.id is null then raise exception 'Commission not found.'; end if;
  if c.status = 'void' then raise exception 'Cannot approve a void commission.'; end if;
  if c.status = 'approved' or c.status = 'paid' then raise exception 'Commission is already %.', c.status; end if;
  if c.status <> 'earned' then
    raise exception 'Only an earned commission can be approved (status %). A commission earns when its invoice is fully paid.', c.status;
  end if;

  update public.commissions
     set status = 'approved', approved_by = p_actor, approved_at = now(), updated_by = p_actor
   where id = p_commission;
end;
$$;

-- ---- pay_commission (approved → paid) ---------------------------------------
create or replace function app.pay_commission(
  p_commission uuid, p_method payment_method, p_reference text, p_note text,
  p_paid_at timestamptz, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may pay commissions.' using errcode = '42501';
  end if;
  select * into c from public.commissions where id = p_commission;
  if c.id is null then raise exception 'Commission not found.'; end if;
  if c.status = 'void' then raise exception 'Cannot pay a void commission.'; end if;
  if c.status = 'paid' then raise exception 'Commission is already paid.'; end if;
  if c.status <> 'approved' then
    raise exception 'Only an approved commission can be marked paid (status %).', c.status;
  end if;

  update public.commissions
     set status = 'paid',
         paid_by = p_actor,
         paid_at = coalesce(p_paid_at, now()),
         paid_method = coalesce(p_method, 'wire'),
         paid_reference = nullif(btrim(p_reference),''),
         paid_note = nullif(btrim(p_note),''),
         updated_by = p_actor
   where id = p_commission;
end;
$$;

-- ---- void_commission --------------------------------------------------------
create or replace function app.void_commission(p_commission uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may void commissions.' using errcode = '42501';
  end if;
  select * into c from public.commissions where id = p_commission;
  if c.id is null then raise exception 'Commission not found.'; end if;
  if c.status = 'void' then raise exception 'Commission is already void.'; end if;
  if c.status = 'paid' then raise exception 'A paid commission cannot be voided; it is permanent history.'; end if;

  update public.commissions
     set status = 'void',
         note = coalesce(nullif(btrim(p_reason),''), note),
         updated_by = p_actor
   where id = p_commission;
end;
$$;

-- ---- bulk_approve_commissions ----------------------------------------------
create or replace function app.bulk_approve_commissions(p_ids uuid[], p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok int := 0; v_skip int := 0;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may approve commissions.' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    begin
      perform app.approve_commission(v_id, p_actor);
      v_ok := v_ok + 1;
    exception when others then
      v_skip := v_skip + 1;   -- not earned / void / already approved → skipped
    end;
  end loop;
  return jsonb_build_object('approved', v_ok, 'skipped', v_skip);
end;
$$;

-- ---- bulk_pay_commissions ---------------------------------------------------
create or replace function app.bulk_pay_commissions(
  p_ids uuid[], p_method payment_method, p_reference text, p_note text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok int := 0; v_skip int := 0;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may pay commissions.' using errcode = '42501';
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    begin
      perform app.pay_commission(v_id, p_method, p_reference, p_note, now(), p_actor);
      v_ok := v_ok + 1;
    exception when others then
      v_skip := v_skip + 1;   -- not approved / void / already paid → skipped
    end;
  end loop;
  return jsonb_build_object('paid', v_ok, 'skipped', v_skip);
end;
$$;

-- ---- preview_commission (builder helper; returns amount + GP warning) --------
create or replace function app.preview_commission(
  p_invoice uuid, p_commission_type commission_type, p_rate numeric, p_units numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_basis numeric(14,4); v_amount numeric(14,4); v_warn text;
begin
  if not app.is_admin() then
    raise exception 'Only Owners and Admins may preview commissions.' using errcode = '42501';
  end if;
  select subtotal, gross_profit into v from public.invoices where id = p_invoice;
  if not found then raise exception 'Invoice not found.'; end if;

  if p_commission_type = 'percent_of_sale' then
    v_basis := coalesce(v.subtotal,0); v_amount := app.money_round(v_basis * coalesce(p_rate,0), 2);
  elsif p_commission_type = 'percent_of_gross_profit' then
    v_basis := coalesce(v.gross_profit,0); v_amount := app.money_round(v_basis * coalesce(p_rate,0), 2);
  elsif p_commission_type = 'flat' then
    v_basis := 0; v_amount := app.money_round(coalesce(p_rate,0), 2);
  elsif p_commission_type = 'per_unit' then
    v_basis := coalesce(p_units,0); v_amount := app.money_round(v_basis * coalesce(p_rate,0), 2);
  end if;

  if v_amount > coalesce(v.gross_profit,0) then
    v_warn := 'This commission exceeds the invoice gross profit.';
  end if;

  return jsonb_build_object(
    'amount', v_amount, 'basis', v_basis,
    'invoice_subtotal', coalesce(v.subtotal,0),
    'invoice_gross_profit', coalesce(v.gross_profit,0),
    'exceeds_gross_profit', v_amount > coalesce(v.gross_profit,0),
    'warning', v_warn);
end;
$$;

-- ----------------------------------------------------------------------------
-- PUBLIC wrappers (bind auth.uid() as the actor; the only commission functions
-- exposed to the API). Authorization lives in the app.* bodies above.
-- ----------------------------------------------------------------------------
create or replace function public.create_commission(
  p_invoice uuid, p_recipient_type text, p_recipient_id uuid, p_recipient_name text,
  p_recipient_email text, p_recipient_company text, p_payment_notes text,
  p_commission_type text, p_rate numeric, p_units numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return app.create_commission(p_invoice, p_recipient_type::commission_recipient_type, p_recipient_id,
    p_recipient_name, p_recipient_email, p_recipient_company, p_payment_notes,
    p_commission_type::commission_type, p_rate, p_units, p_note, auth.uid());
end; $$;

create or replace function public.update_commission(
  p_commission uuid, p_recipient_type text, p_recipient_id uuid, p_recipient_name text,
  p_recipient_email text, p_recipient_company text, p_payment_notes text,
  p_commission_type text, p_rate numeric, p_units numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.update_commission(p_commission, p_recipient_type::commission_recipient_type, p_recipient_id,
    p_recipient_name, p_recipient_email, p_recipient_company, p_payment_notes,
    p_commission_type::commission_type, p_rate, p_units, p_note, auth.uid());
end; $$;

create or replace function public.approve_commission(p_commission uuid)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.approve_commission(p_commission, auth.uid()); end; $$;

create or replace function public.pay_commission(
  p_commission uuid, p_method text, p_reference text, p_note text, p_paid_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.pay_commission(p_commission, coalesce(p_method,'wire')::payment_method,
    p_reference, p_note, p_paid_at, auth.uid());
end; $$;

create or replace function public.void_commission(p_commission uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin perform app.void_commission(p_commission, p_reason, auth.uid()); end; $$;

create or replace function public.bulk_approve_commissions(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin return app.bulk_approve_commissions(p_ids, auth.uid()); end; $$;

create or replace function public.bulk_pay_commissions(
  p_ids uuid[], p_method text, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return app.bulk_pay_commissions(p_ids, coalesce(p_method,'wire')::payment_method,
    p_reference, p_note, auth.uid());
end; $$;

create or replace function public.preview_commission(
  p_invoice uuid, p_commission_type text, p_rate numeric, p_units numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return app.preview_commission(p_invoice, p_commission_type::commission_type, p_rate, p_units);
end; $$;

-- ---- Grants -----------------------------------------------------------------
revoke all on function
  public.create_commission(uuid,text,uuid,text,text,text,text,text,numeric,numeric,text),
  public.update_commission(uuid,text,uuid,text,text,text,text,text,numeric,numeric,text),
  public.approve_commission(uuid),
  public.pay_commission(uuid,text,text,text,timestamptz),
  public.void_commission(uuid,text),
  public.bulk_approve_commissions(uuid[]),
  public.bulk_pay_commissions(uuid[],text,text,text),
  public.preview_commission(uuid,text,numeric,numeric)
from public, anon;

grant execute on function
  public.create_commission(uuid,text,uuid,text,text,text,text,text,numeric,numeric,text),
  public.update_commission(uuid,text,uuid,text,text,text,text,text,numeric,numeric,text),
  public.approve_commission(uuid),
  public.pay_commission(uuid,text,text,text,timestamptz),
  public.void_commission(uuid,text),
  public.bulk_approve_commissions(uuid[]),
  public.bulk_pay_commissions(uuid[],text,text,text),
  public.preview_commission(uuid,text,numeric,numeric)
to authenticated;
