-- ============================================================================
-- Aurum Supply House · 0070 · Commissions & Payments
-- ============================================================================

create table if not exists public.commissions (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  -- recipient_id is NULL for external referral partners / payees (no login).
  recipient_id   uuid references public.profiles(id) on delete set null,
  recipient_type    commission_recipient_type not null default 'internal_user',
  recipient_name text not null,                       -- snapshot (required for both types)
  recipient_email   citext,                           -- external payee contact
  recipient_company text,                             -- optional external company
  payment_notes     text,                             -- how/where to pay an external partner
  commission_type commission_type not null,
  -- Integrity: an internal recipient must reference a user; an external one must not.
  constraint chk_commission_recipient check (
    (recipient_type = 'internal_user' and recipient_id is not null)
    or (recipient_type = 'external_partner' and recipient_id is null)
  ),
  rate           numeric(14,6) not null check (rate >= 0),  -- percent | flat $ | per-unit $
  basis_amount   numeric(14,4) not null default 0,          -- sale or gross-profit snapshot
  units          numeric(14,4),                             -- for per_unit
  amount         numeric(14,4) not null default 0,
  status         commission_status not null default 'pending',
  approved_by    uuid references public.profiles(id) on delete set null,
  approved_at    timestamptz,
  paid_at        timestamptz,
  note           text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_comm_invoice   on public.commissions(invoice_id);
create index if not exists idx_comm_recipient on public.commissions(recipient_id);
create index if not exists idx_comm_status    on public.commissions(status);

drop trigger if exists trg_comm_touch on public.commissions;
create trigger trg_comm_touch before update on public.commissions
  for each row execute function app.touch_updated_at();

-- Compute commission amount from type + invoice economics (snapshotted).
create or replace function app.compute_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sub numeric(14,4); v_gp numeric(14,4);
begin
  select subtotal, gross_profit into v_sub, v_gp
    from public.invoices where id = new.invoice_id;

  if new.commission_type = 'percent_of_sale' then
    new.basis_amount := coalesce(v_sub,0);
    new.amount := app.money_round(coalesce(v_sub,0) * new.rate, 2);
  elsif new.commission_type = 'percent_of_gross_profit' then
    new.basis_amount := coalesce(v_gp,0);
    new.amount := app.money_round(coalesce(v_gp,0) * new.rate, 2);
  elsif new.commission_type = 'flat' then
    new.basis_amount := 0;
    new.amount := app.money_round(new.rate, 2);
  elsif new.commission_type = 'per_unit' then
    new.basis_amount := coalesce(new.units,0);
    new.amount := app.money_round(coalesce(new.units,0) * new.rate, 2);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_comm_compute on public.commissions;
create trigger trg_comm_compute before insert or update on public.commissions
  for each row execute function app.compute_commission();

-- Roll commission totals into the parent invoice (and net_profit).
create or replace function app.trg_recalc_invoice_from_comm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_comm_rollup on public.commissions;
create trigger trg_comm_rollup after insert or update or delete on public.commissions
  for each row execute function app.trg_recalc_invoice_from_comm();

-- Commissions inherit the invoice lock: once the invoice is out of draft the
-- amount/type/rate are frozen; only workflow status (approve/pay/void) moves.
create or replace function app.enforce_commission_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status invoice_status;
begin
  select status into v_status from public.invoices
    where id = coalesce(new.invoice_id, old.invoice_id);

  if v_status is not null and v_status <> 'draft' then
    if (tg_op = 'DELETE') then
      raise exception 'Cannot delete a commission on a locked invoice; void it instead.';
    end if;
    if ( new.commission_type is distinct from old.commission_type
      or new.rate            is distinct from old.rate
      or new.amount          is distinct from old.amount
      or new.basis_amount    is distinct from old.basis_amount
      or new.recipient_id    is distinct from old.recipient_id ) then
      raise exception 'Commission economics are locked once the invoice is %.', v_status;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_comm_lock on public.commissions;
create trigger trg_comm_lock before update or delete on public.commissions
  for each row execute function app.enforce_commission_lock();

-- ----------------------------------------------------------------------------
-- payments : ledger of payments against an invoice
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  amount      numeric(14,4) not null check (amount > 0),
  method      payment_method not null default 'wire',
  reference   text,
  received_at timestamptz not null default now(),
  note        text,
  voided      boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_payments_invoice on public.payments(invoice_id);

-- Recompute amount_paid / balance_due and advance status (never touches money).
create or replace function app.apply_payment_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_paid numeric(14,4);
  v_total numeric(14,4);
  v_status invoice_status;
begin
  select coalesce(sum(amount),0) into v_paid
    from public.payments where invoice_id = v_invoice and voided = false;

  select total, status into v_total, v_status
    from public.invoices where id = v_invoice;

  update public.invoices
     set amount_paid = v_paid,
         balance_due = v_total - v_paid,
         status = case
                    when status = 'void' then 'void'
                    when status = 'draft' then 'draft'
                    when v_paid <= 0 then status
                    when v_paid >= v_total then 'paid'
                    else 'partial'
                  end,
         paid_at = case when v_paid >= v_total and paid_at is null then now() else paid_at end
   where id = v_invoice;

  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_payment_rollup on public.payments;
create trigger trg_payment_rollup after insert or update or delete on public.payments
  for each row execute function app.apply_payment_rollup();
