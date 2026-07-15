-- ============================================================================
-- Aurum Supply House · 0210 · M4 · Order masking views, RLS, client timelines
-- ----------------------------------------------------------------------------
-- ADDITIVE. Postgres RLS hides rows, not columns, and every app user shares the
-- `authenticated` DB role — so internal economics (true cost, gross/net profit,
-- margin, commission, expenses) are hidden the same way M1 hid catalog cost:
-- lock the base tables to admins, and expose row-scoped, column-masked
-- security-barrier VIEWS as the staff read surface. Reps write only through the
-- 0200 SECURITY DEFINER RPCs, never the base tables.
-- ============================================================================

-- ---- invoices: base table becomes admin-only for direct access -------------
-- Reps read via v_orders (below) and mutate via save_order_draft(). Removing the
-- rep base policies guarantees a rep can never SELECT cost/profit columns nor
-- flip status by a direct table write.
drop policy if exists invoices_rep_select on public.invoices;
drop policy if exists invoices_rep_insert on public.invoices;
drop policy if exists invoices_rep_update on public.invoices;
-- invoices_admin_all (0080) remains: Owners/Admins keep full base access.

-- ---- invoice_items: base table admin-only; reps read v_order_items ---------
drop policy if exists invoice_items_access on public.invoice_items;
drop policy if exists invoice_items_admin_all on public.invoice_items;
create policy invoice_items_admin_all on public.invoice_items for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- order_expenses: internal only — reps lose read entirely ---------------
drop policy if exists order_exp_rep_read on public.order_expenses;
-- order_exp_admin_all (0080) remains.

-- ----------------------------------------------------------------------------
-- v_orders — the staff order list/detail surface.
-- Runs as owner (security_barrier) and applies its OWN scope: admins see all;
-- reps see only orders they own or for clients in their book. Internal economics
-- are NULL unless the caller is an admin.
-- ----------------------------------------------------------------------------
create or replace view public.v_orders
  with (security_invoker = false, security_barrier = true)
as
select
  i.id,
  i.invoice_number,
  i.status,
  i.stage,
  i.client_id,
  coalesce(i.client_snapshot->>'company_name', c.company_name) as company_name,
  i.client_snapshot,   -- customer's own data (name/addresses/terms) for the invoice document
  i.sales_rep_id,
  i.sales_rep_name,
  i.pricing_sheet_id,
  i.pricing_sheet_name,
  i.currency,
  i.subtotal,
  i.discount,
  i.shipping,
  i.fees,
  i.tax_rate,
  i.tax_amount,
  i.total,
  i.amount_paid,
  i.balance_due,
  i.issue_date,
  i.due_date,
  i.sent_at,
  i.paid_at,
  i.notes,
  i.created_at,
  i.updated_at,
  -- Internal economics — masked for non-admins.
  case when app.is_admin() then i.total_true_cost  end as total_true_cost,
  case when app.is_admin() then i.gross_profit     end as gross_profit,
  case when app.is_admin() then i.gross_margin     end as gross_margin,
  case when app.is_admin() then i.total_commission end as total_commission,
  case when app.is_admin() then i.total_expenses   end as total_expenses,
  case when app.is_admin() then i.net_profit       end as net_profit,
  app.is_admin() as can_see_internal
from public.invoices i
left join public.clients c on c.id = i.client_id
where app.is_staff()
  and ( app.is_admin()
     or i.sales_rep_id = auth.uid()
     or i.client_id in (select app.rep_client_ids()) );

revoke all on public.v_orders from anon;
grant select on public.v_orders to authenticated;
comment on view public.v_orders is
  'Staff order surface. Row-scoped (admins all, reps own book); masks cost/profit/margin/commission/expenses for non-admins.';

-- ----------------------------------------------------------------------------
-- v_order_items — line items with per-line cost/GP masked for non-admins.
-- ----------------------------------------------------------------------------
create or replace view public.v_order_items
  with (security_invoker = false, security_barrier = true)
as
select
  ii.id,
  ii.invoice_id,
  ii.product_id,
  ii.sku,
  ii.product_name,
  ii.strength,
  ii.pack_size,
  ii.manufacturer_name,
  ii.quantity,
  ii.unit_price,
  ii.line_subtotal,
  ii.price_overridden,
  ii.original_unit_price,
  ii.price_source,
  ii.price_source_sheet,
  ii.manual_reason,
  ii.created_at,
  -- Internal cost — masked for non-admins.
  case when app.is_admin() then ii.unit_true_cost    end as unit_true_cost,
  case when app.is_admin() then ii.line_true_cost    end as line_true_cost,
  case when app.is_admin() then ii.line_gross_profit end as line_gross_profit
from public.invoice_items ii
where app.can_access_invoice(ii.invoice_id);

revoke all on public.v_order_items from anon;
grant select on public.v_order_items to authenticated;
comment on view public.v_order_items is
  'Staff order line-item surface. Masks unit/line true cost and line gross profit for non-admins.';

-- ----------------------------------------------------------------------------
-- Client timelines — mirror non-sensitive order lifecycle events onto the
-- client entity so the M3 client timeline (activity_log where entity_type =
-- 'client') surfaces them. NEVER stores money in the metadata.
-- ----------------------------------------------------------------------------
create or replace function app.trg_client_activity_from_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text; v_summary text;
begin
  if new.client_id is null then return new; end if;

  if tg_op = 'INSERT' then
    v_action := 'order_created'; v_summary := 'New order started';
  elsif new.status is distinct from old.status then
    if new.status = 'sent' then
      v_action := 'invoice_issued'; v_summary := 'Invoice ' || new.invoice_number || ' issued';
    elsif new.status = 'paid' then
      v_action := 'invoice_paid'; v_summary := 'Invoice ' || new.invoice_number || ' paid in full';
    elsif new.status = 'void' then
      v_action := 'invoice_voided'; v_summary := 'Invoice ' || new.invoice_number || ' voided';
    else
      return new;  -- 'partial' is covered by the per-payment event below
    end if;
  else
    return new;
  end if;

  perform app.record_activity('client', new.client_id, v_action, v_summary,
    jsonb_build_object('invoice_id', new.id, 'invoice_number', new.invoice_number, 'status', new.status));
  return new;
end;
$$;
drop trigger if exists trg_client_activity_invoice on public.invoices;
create trigger trg_client_activity_invoice after insert or update on public.invoices
  for each row execute function app.trg_client_activity_from_invoice();

create or replace function app.trg_client_activity_from_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_num text;
begin
  select client_id, invoice_number into v_client, v_num
    from public.invoices where id = new.invoice_id;
  if v_client is not null then
    perform app.record_activity('client', v_client, 'payment_recorded',
      'Payment recorded on ' || coalesce(v_num,'invoice'),
      jsonb_build_object('invoice_id', new.invoice_id));  -- no amount (non-sensitive)
  end if;
  return new;
end;
$$;
drop trigger if exists trg_client_activity_payment on public.payments;
create trigger trg_client_activity_payment after insert on public.payments
  for each row execute function app.trg_client_activity_from_payment();
