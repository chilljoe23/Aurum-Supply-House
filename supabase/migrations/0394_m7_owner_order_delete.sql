-- ============================================================================
-- Aurum Supply House · 0394 · M7 · Owner-only permanent order deletion
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Adds a narrowly-scoped, Owner-only workflow to permanently
-- delete an order that was entered incorrectly or voided. This is deliberately
-- DIFFERENT from Void:
--   • Void keeps the financial/audit record (existing app.void_invoice — UNCHANGED).
--   • Permanent delete removes an *eligible mistaken* Draft/Void order from
--     operational data, and can NEVER touch historical accounting.
--
-- Design notes:
--   • Gate is app.is_owner() — Owner only. Admins and reps are refused. RLS is
--     NOT weakened: no new DELETE policy is added; this runs via a SECURITY
--     DEFINER RPC, exactly like the existing order RPCs.
--   • The blocking obstacle is the immutability trigger layer, not FKs/RLS. We
--     introduce ONE transaction-local guard, `app.allow_order_delete`, that the
--     three existing lock triggers honor. It is default-off, so with the flag
--     unset every trigger behaves byte-identically to before (Void, issued-invoice
--     immutability, and line/commission locks are all unchanged). Only
--     app.hard_delete_order ever turns it on, and only inside its own transaction
--     (mirrors the sanctioned `app.allow_lot_update` pattern from 0360).
--   • Deletion is deterministic: children are removed in dependency order inside
--     one transaction, then the parent, then the tombstone-before-delete audit
--     row is committed together — atomic all-or-nothing.
--   • Invoice numbers are NEVER reused: document_sequences is monotonic and is
--     never touched here, so a deleted issued/void number stays permanently
--     retired (same guarantee as Void).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Teach the three immutability locks a single sanctioned bypass flag.
--     Bodies are reproduced verbatim from their latest definitions (invoice
--     lock: 0190, items lock: 0360, commission lock: 0070) with ONLY a leading
--     transaction-local guard added. Flag off ⇒ identical behavior.
-- ---------------------------------------------------------------------------

create or replace function app.enforce_invoice_lock()
returns trigger language plpgsql as $$
begin
  -- Sanctioned Owner-only permanent deletion sets this transaction-local guard.
  -- Normal callers never set it. It suppresses BOTH the non-draft delete block
  -- and the header immutability checks, so cascade/rollup updates can settle
  -- while app.hard_delete_order tears the order down.
  if current_setting('app.allow_order_delete', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if (tg_op = 'DELETE') then
    if old.status <> 'draft' then
      raise exception 'Invoice % is % and cannot be deleted. Void it instead.', old.invoice_number, old.status;
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if ( new.subtotal        is distinct from old.subtotal
      or new.total           is distinct from old.total
      or new.total_true_cost is distinct from old.total_true_cost
      or new.gross_profit    is distinct from old.gross_profit
      or new.tax_rate        is distinct from old.tax_rate
      or new.tax_amount      is distinct from old.tax_amount
      or new.shipping        is distinct from old.shipping
      or new.fees            is distinct from old.fees
      or new.discount        is distinct from old.discount
      or new.client_id       is distinct from old.client_id
      or new.client_snapshot is distinct from old.client_snapshot
      or new.sales_rep_id    is distinct from old.sales_rep_id
      or new.pricing_sheet_id is distinct from old.pricing_sheet_id
      or new.issue_date      is distinct from old.issue_date
      or new.invoice_number  is distinct from old.invoice_number )
    then
      raise exception 'Invoice % is locked (status %). Financial fields cannot change.',
        old.invoice_number, old.status;
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.enforce_invoice_items_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status invoice_status;
begin
  -- Sanctioned permanent-deletion bypass (see app.hard_delete_order).
  if current_setting('app.allow_order_delete', true) = 'on' then
    return coalesce(new, old);
  end if;

  select status into v_status from public.invoices
    where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is null or v_status = 'draft' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and current_setting('app.allow_lot_update', true) = 'on'
     and new.invoice_id          is not distinct from old.invoice_id
     and new.product_id          is not distinct from old.product_id
     and new.sku                 is not distinct from old.sku
     and new.product_name        is not distinct from old.product_name
     and new.strength            is not distinct from old.strength
     and new.pack_size           is not distinct from old.pack_size
     and new.manufacturer_name   is not distinct from old.manufacturer_name
     and new.quantity            is not distinct from old.quantity
     and new.unit_price          is not distinct from old.unit_price
     and new.unit_true_cost      is not distinct from old.unit_true_cost
     and new.price_overridden    is not distinct from old.price_overridden
     and new.original_unit_price is not distinct from old.original_unit_price
     and new.line_subtotal       is not distinct from old.line_subtotal
     and new.line_true_cost      is not distinct from old.line_true_cost
     and new.line_gross_profit   is not distinct from old.line_gross_profit
     and new.price_source        is not distinct from old.price_source
     and new.price_source_sheet  is not distinct from old.price_source_sheet
     and new.manual_reason       is not distinct from old.manual_reason
  then
    return new;  -- lot-only annotation permitted
  end if;

  raise exception 'Cannot modify line items of a % invoice. Void and reissue instead.', v_status;
end;
$$;

create or replace function app.enforce_commission_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status invoice_status;
begin
  -- Sanctioned permanent-deletion bypass (see app.hard_delete_order).
  if current_setting('app.allow_order_delete', true) = 'on' then
    return coalesce(new, old);
  end if;

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

-- ---------------------------------------------------------------------------
-- 2 · app.hard_delete_order — the Owner-only, eligibility-gated, atomic RPC.
-- ---------------------------------------------------------------------------
create or replace function app.hard_delete_order(p_invoice uuid, p_reason text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v            record;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_retired    text;
begin
  -- (1) Owner only. Admin and Sales Representative are refused here (RLS/void
  --     paths are unchanged; this is a strictly narrower gate than is_admin()).
  if not app.is_owner() then
    raise exception 'Only the Owner may permanently delete an order.' using errcode = '42501';
  end if;

  -- Reason is mandatory and preserved in the tombstone.
  if v_reason = '' then
    raise exception 'A deletion reason is required.';
  end if;

  -- (2) Lock the row for the duration of the transaction so concurrent deletes,
  --     issues, payments, or voids cannot race with the eligibility checks.
  select * into v from public.invoices where id = p_invoice for update;
  if v.id is null then
    raise exception 'Order not found.';
  end if;

  -- (3) Status must be Draft or Void. Sent / Partial / Paid are never deletable.
  if v.status not in ('draft', 'void') then
    raise exception 'Only Draft or Void orders can be permanently deleted. This order is %.', v.status;
  end if;

  -- (4) Never delete a fulfilled/completed order (reserved order_stage guard).
  if v.stage in ('fulfilled', 'complete') then
    raise exception 'Fulfilled or completed orders cannot be permanently deleted.';
  end if;

  -- (5) No payment history may exist — even a reversed (voided) payment is a
  --     financial record that must be retained via Void, never hard-deleted.
  if exists (select 1 from public.payments where invoice_id = p_invoice) then
    raise exception 'This order has payment history and cannot be deleted. Void preserves the record instead.';
  end if;

  -- (6) No paid/approved/earned commission may exist — that is confirmed, owed,
  --     or paid money that must be retained. (pending/void commissions are safe
  --     operational scaffolding and are removed with the order.)
  if exists (
    select 1 from public.commissions
     where invoice_id = p_invoice and status in ('paid', 'approved', 'earned')
  ) then
    raise exception 'This order has commission activity that must be retained and cannot be deleted.';
  end if;

  -- The number of an issued/void invoice is permanently retired (drafts carry a
  -- throwaway DRAFT- placeholder that never consumed the AUR sequence).
  v_retired := case when v.status = 'void' then v.invoice_number else null end;

  -- (7) TOMBSTONE FIRST — a minimal, non-sensitive audit record. Written before
  --     the delete and committed atomically with it (same transaction). Contains
  --     NO line pricing, costs, totals, customer PII, or notes.
  perform app.record_activity(
    'invoice', p_invoice, 'deleted',
    'Order ' || v.invoice_number || ' permanently deleted',
    jsonb_build_object(
      'former_order_number', v.invoice_number,
      'former_status',       v.status,
      'client_id',           v.client_id,
      'retired_invoice_number', v_retired,
      'reason',              v_reason
    )
  );

  -- (8) Deterministic teardown inside the sanctioned bypass. Children are deleted
  --     in dependency order; the parent last. Order-numbering (document_sequences)
  --     is never touched, so retired numbers can never be reissued.
  perform set_config('app.allow_order_delete', 'on', true);

  delete from public.payments               where invoice_id = p_invoice;  -- (none by eligibility; defensive + deterministic)
  delete from public.commissions            where invoice_id = p_invoice;
  delete from public.order_expenses         where invoice_id = p_invoice;
  delete from public.invoice_items          where invoice_id = p_invoice;
  delete from public.invoice_status_history where invoice_id = p_invoice;
  update public.quotes set converted_order_id = null where converted_order_id = p_invoice;
  delete from public.invoices               where id = p_invoice;

  perform set_config('app.allow_order_delete', 'off', true);

  return jsonb_build_object(
    'deleted', true,
    'former_order_number', v.invoice_number,
    'former_status', v.status,
    'retired_invoice_number', v_retired
  );
end;
$$;

-- Thin public wrapper: binds the caller's identity, so the tombstone's actor and
-- the Owner check both reflect the real user. Errors surface verbatim to the app.
create or replace function public.hard_delete_order(p_invoice uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select app.hard_delete_order(p_invoice, p_reason, auth.uid());
$$;

-- Lock down execution: never public/anon; authenticated only (the body still
-- enforces Owner-only). No broad DELETE grant on invoices or any child table is
-- added anywhere — deletion is reachable ONLY through this audited RPC.
revoke all on function public.hard_delete_order(uuid, text) from public, anon;
grant execute on function public.hard_delete_order(uuid, text) to authenticated;
revoke all on function app.hard_delete_order(uuid, text, uuid) from public, anon, authenticated;
