-- ============================================================================
-- Aurum Supply House · 0240 · M5 · Customer-payment duplicate guard
-- ----------------------------------------------------------------------------
-- ADDITIVE. The M4 payments ledger (0070) + record_payment RPC (0200) already
-- enforce: amount > 0, no payment on draft/void, no overpayment, and automatic
-- amount_paid / balance_due rollups with Partial/Paid status. M5 adds one more
-- safeguard required by the AR workflow — preventing an accidental DUPLICATE
-- submission (a double-clicked "Record payment" or a retried request) from
-- posting the same money twice.
--
-- A new payment is rejected when an identical, still-active payment for the same
-- invoice (same amount, method, reference, and received date) was recorded within
-- the last two minutes. Legitimately repeated payments (different reference, or
-- spaced apart) are unaffected.
-- ============================================================================

create or replace function app.enforce_no_duplicate_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and coalesce(new.voided, false) = false then
    if exists (
      select 1 from public.payments p
       where p.invoice_id = new.invoice_id
         and p.voided = false
         and p.id <> new.id
         and p.amount = new.amount
         and p.method = new.method
         and coalesce(btrim(p.reference), '') = coalesce(btrim(new.reference), '')
         and p.received_at::date = new.received_at::date
         and p.created_at > now() - interval '2 minutes'
    ) then
      raise exception 'A matching payment was just recorded. If this is a separate payment, add a distinct reference.'
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

-- Runs before the overpayment guard's sibling checks; both are BEFORE INSERT.
drop trigger if exists trg_no_duplicate_payment on public.payments;
create trigger trg_no_duplicate_payment before insert on public.payments
  for each row execute function app.enforce_no_duplicate_payment();
