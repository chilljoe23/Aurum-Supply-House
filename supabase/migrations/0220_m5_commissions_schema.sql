-- ============================================================================
-- Aurum Supply House · 0220 · M5 · Commission schema, lifecycle & audit
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Extends the M0 `commissions` table (0070) with the M5 lifecycle
-- (adds an `earned` status between pending and approved), a full frozen financial
-- snapshot, and payment-record fields — then wires the lifecycle automation:
--
--   • commission amount is snapshotted from the invoice's FROZEN economics and is
--     never silently recalculated once the invoice leaves draft;
--   • a commission becomes `earned` automatically when its customer invoice is
--     fully paid (the default rule);
--   • voiding an unpaid invoice voids its unpaid commissions (paid ones retained);
--   • status may only move forward through the legal lifecycle;
--   • every lifecycle event is journaled to activity_log with NON-sensitive
--     metadata (no amounts, no cost/profit, no banking details, no private notes).
--
-- Migrations 0001–0210 are untouched. `discount = 0` era math is unaffected.
-- ============================================================================

-- ---- Lifecycle: add `earned` to the commission status enum -------------------
-- Idempotent; appended (enum comparisons are by equality, not ordinal position).
alter type commission_status add value if not exists 'earned';

-- ---- Frozen snapshot + payment-record columns -------------------------------
-- The invoice subtotal and gross profit AT CALCULATION TIME are snapshotted so a
-- commission is auditable and immune to any later change in pricing, cost, or
-- business rules. Payment-record fields capture who/how a commission was paid.
alter table public.commissions
  add column if not exists invoice_subtotal     numeric(14,4) not null default 0,  -- snapshot @ calc time
  add column if not exists invoice_gross_profit numeric(14,4) not null default 0,  -- snapshot @ calc time
  add column if not exists paid_by       uuid references public.profiles(id) on delete set null,
  add column if not exists paid_method   payment_method,
  add column if not exists paid_reference text,
  add column if not exists paid_note     text,
  add column if not exists updated_by    uuid references public.profiles(id) on delete set null;

comment on column public.commissions.invoice_subtotal is
  'Invoice product subtotal snapshotted when the commission amount was computed. Immutable.';
comment on column public.commissions.invoice_gross_profit is
  'Invoice gross profit snapshotted when the commission amount was computed. Immutable; INTERNAL — masked from reps/partners.';

create index if not exists idx_comm_recipient_type on public.commissions(recipient_type);
create index if not exists idx_comm_invoice_status on public.commissions(invoice_id, status);

-- ----------------------------------------------------------------------------
-- Recompute commission amount from the invoice's economics.
-- INSERT: always compute + snapshot.
-- UPDATE: recompute ONLY while the invoice is a draft AND an economic input
--         (type / rate / units) actually changed. Otherwise the frozen amount,
--         basis, and snapshots are preserved verbatim — a status change, a note
--         edit, or a locked-invoice update can never silently move the money.
-- ----------------------------------------------------------------------------
create or replace function app.compute_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric(14,4);
  v_gp  numeric(14,4);
  v_status invoice_status;
  v_recompute boolean;
begin
  select subtotal, gross_profit, status
    into v_sub, v_gp, v_status
    from public.invoices where id = new.invoice_id;

  if tg_op = 'INSERT' then
    v_recompute := true;
  else
    v_recompute := (v_status = 'draft')
      and ( new.commission_type is distinct from old.commission_type
         or new.rate            is distinct from old.rate
         or new.units           is distinct from old.units );
    if not v_recompute then
      -- Preserve the frozen figures no matter what the UPDATE payload carried.
      new.amount               := old.amount;
      new.basis_amount         := old.basis_amount;
      new.invoice_subtotal     := old.invoice_subtotal;
      new.invoice_gross_profit := old.invoice_gross_profit;
      return new;
    end if;
  end if;

  new.invoice_subtotal     := coalesce(v_sub, 0);
  new.invoice_gross_profit := coalesce(v_gp, 0);

  if new.commission_type = 'percent_of_sale' then
    new.basis_amount := coalesce(v_sub, 0);
    new.amount := app.money_round(coalesce(v_sub, 0) * new.rate, 2);
  elsif new.commission_type = 'percent_of_gross_profit' then
    new.basis_amount := coalesce(v_gp, 0);
    new.amount := app.money_round(coalesce(v_gp, 0) * new.rate, 2);
  elsif new.commission_type = 'flat' then
    new.basis_amount := 0;
    new.amount := app.money_round(new.rate, 2);
  elsif new.commission_type = 'per_unit' then
    new.basis_amount := coalesce(new.units, 0);
    new.amount := app.money_round(coalesce(new.units, 0) * new.rate, 2);
  end if;
  return new;
end;
$$;
-- trigger trg_comm_compute (0070) already binds this function; nothing to re-add.

-- ----------------------------------------------------------------------------
-- Lifecycle transition guard: status may only advance through the legal path.
--   pending  → earned | void
--   earned   → approved | void
--   approved → paid | void
--   paid     → (terminal, immutable)
--   void     → (terminal)
-- Prevents duplicate payment/approval and reactivation of void/paid rows.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_commission_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'paid' then
      raise exception 'A paid commission is immutable; its status cannot change.'
        using errcode = '23514';
    elsif old.status = 'void' then
      raise exception 'A void commission cannot be reactivated.'
        using errcode = '23514';
    elsif not (
         (old.status = 'pending'  and new.status in ('earned','void'))
      or (old.status = 'earned'   and new.status in ('approved','void'))
      or (old.status = 'approved' and new.status in ('paid','void'))
    ) then
      raise exception 'Invalid commission transition (% → %).', old.status, new.status
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_comm_transition on public.commissions;
create trigger trg_comm_transition before update on public.commissions
  for each row execute function app.enforce_commission_transition();

-- ----------------------------------------------------------------------------
-- Invoice → commission lifecycle automation (single AFTER-UPDATE trigger).
--   invoice becomes `paid`  → its `pending` commissions become `earned`
--   invoice becomes `void`  → its unpaid (pending/earned/approved) commissions
--                             become `void`; PAID commissions are retained.
-- ----------------------------------------------------------------------------
create or replace function app.trg_commissions_follow_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paid' then
      update public.commissions
         set status = 'earned'
       where invoice_id = new.id and status = 'pending';
    elsif new.status = 'void' then
      update public.commissions
         set status = 'void'
       where invoice_id = new.id and status in ('pending','earned','approved');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_commissions_follow_invoice on public.invoices;
create trigger trg_commissions_follow_invoice after update on public.invoices
  for each row execute function app.trg_commissions_follow_invoice();

-- ----------------------------------------------------------------------------
-- Commission audit trail → activity_log. NON-sensitive metadata only:
-- ids, recipient_type, and the new status. NEVER the amount, gross-profit basis,
-- payment reference, or private notes (activity_log is readable by all staff).
-- ----------------------------------------------------------------------------
create or replace function app.trg_activity_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_num text;
  v_action text;
  v_summary text;
  v_meta jsonb;
begin
  select invoice_number into v_num from public.invoices where id = new.invoice_id;
  v_meta := jsonb_build_object(
    'commission_id', new.id,
    'invoice_id',    new.invoice_id,
    'recipient_type', new.recipient_type,
    'status',        new.status);

  if tg_op = 'INSERT' then
    v_action := 'commission_created';
    v_summary := 'Commission created on ' || coalesce(v_num, 'invoice');
  elsif new.status is distinct from old.status then
    v_action := case new.status
                  when 'earned'   then 'commission_earned'
                  when 'approved' then 'commission_approved'
                  when 'paid'     then 'commission_paid'
                  when 'void'     then 'commission_voided'
                  else 'commission_updated' end;
    v_summary := (case new.status
                  when 'earned'   then 'Commission earned on '
                  when 'approved' then 'Commission approved on '
                  when 'paid'     then 'Commission marked paid on '
                  when 'void'     then 'Commission voided on '
                  else 'Commission updated on ' end) || coalesce(v_num, 'invoice');
  elsif ( new.commission_type is distinct from old.commission_type
       or new.rate is distinct from old.rate
       or new.units is distinct from old.units
       or new.recipient_id is distinct from old.recipient_id
       or new.recipient_name is distinct from old.recipient_name ) then
    v_action := 'commission_corrected';
    v_summary := 'Commission corrected on ' || coalesce(v_num, 'invoice');
  else
    return coalesce(new, old);   -- no material change worth journaling
  end if;

  perform app.record_activity('commission', new.id, v_action, v_summary, v_meta);
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_activity_commission on public.commissions;
create trigger trg_activity_commission after insert or update on public.commissions
  for each row execute function app.trg_activity_commission();
