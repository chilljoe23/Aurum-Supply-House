-- ============================================================================
-- Aurum Supply House · 0260 · M5 · Commission RLS tightening + client timeline
-- ----------------------------------------------------------------------------
-- ADDITIVE. Two things:
--  1. Lock the `commissions` BASE table to admins for direct access. The base row
--     now carries cost-derived snapshots (invoice_gross_profit, and basis_amount
--     which equals gross profit for GP-type commissions). Reps must read through
--     the masked, row-scoped v_commissions view (0250) — never the base table —
--     and may not create/edit/approve/pay/void (that is Owner/Admin only in M5).
--  2. Mirror non-sensitive commission lifecycle events onto the client timeline.
-- Migrations 0001–0250 are otherwise untouched.
-- ============================================================================

-- ---- commissions: base table becomes admin-only ----------------------------
-- Remove the rep read (would expose the GP snapshot / GP-basis) and the rep
-- insert (commission management is Owner/Admin only in M5). commissions_admin_all
-- (0080) remains: Owners/Admins keep full base access; reps use v_commissions.
drop policy if exists commissions_rep_read on public.commissions;
drop policy if exists commissions_rep_insert on public.commissions;

-- ---- Client timeline: mirror commission events (non-sensitive, no amounts) ---
create or replace function app.trg_client_activity_from_commission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_num text; v_action text; v_summary text;
begin
  if tg_op = 'INSERT' then
    v_action := 'commission_added'; v_summary := 'Commission added';
  elsif new.status is distinct from old.status and new.status = 'paid' then
    v_action := 'commission_paid'; v_summary := 'Commission paid';
  else
    return coalesce(new, old);
  end if;

  select client_id, invoice_number into v_client, v_num
    from public.invoices where id = new.invoice_id;
  if v_client is not null then
    perform app.record_activity('client', v_client, v_action,
      v_summary || ' on ' || coalesce(v_num, 'invoice'),
      jsonb_build_object('invoice_id', new.invoice_id, 'commission_id', new.id));  -- no amounts
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_client_activity_commission on public.commissions;
create trigger trg_client_activity_commission after insert or update on public.commissions
  for each row execute function app.trg_client_activity_from_commission();
