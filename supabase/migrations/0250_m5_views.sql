-- ============================================================================
-- Aurum Supply House · 0250 · M5 · Commission + Accounts-Receivable views
-- ----------------------------------------------------------------------------
-- ADDITIVE. Postgres RLS hides rows, not columns, and every app user shares the
-- `authenticated` DB role — so (as with the M4 order views) the staff read surface
-- for commissions and receivables is a set of owner-run, security-barrier VIEWS
-- that apply their OWN row scope and NULL out internal (cost-derived) figures for
-- non-admins. Reps mutate nothing here; they only read their own rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_commissions — the staff commission surface.
--   Row scope : admins see all; reps see ONLY their own (recipient_id = them).
--   Masking   : invoice_gross_profit is NULL for non-admins; basis_amount is
--               NULL for non-admins when the type is percent_of_gross_profit
--               (it would otherwise reveal the invoice's gross profit).
-- Customer-facing figures (invoice number, subtotal, amount, dates) are visible.
-- ----------------------------------------------------------------------------
create or replace view public.v_commissions
  with (security_invoker = false, security_barrier = true)
as
select
  cm.id,
  cm.invoice_id,
  i.invoice_number,
  i.status            as invoice_status,
  i.issue_date        as invoice_issue_date,
  i.due_date          as invoice_due_date,
  i.paid_at           as invoice_paid_at,
  i.client_id,
  coalesce(i.client_snapshot->>'company_name', c.company_name) as company_name,
  i.sales_rep_id      as invoice_rep_id,
  i.sales_rep_name    as invoice_rep_name,
  cm.recipient_type,
  cm.recipient_id,
  cm.recipient_name,
  cm.recipient_email,
  cm.recipient_company,
  cm.payment_notes,
  cm.commission_type,
  cm.rate,
  cm.units,
  cm.amount,
  cm.status,
  cm.invoice_subtotal,
  cm.note,
  cm.approved_by,
  cm.approved_at,
  cm.paid_by,
  cm.paid_at,
  cm.paid_method,
  cm.paid_reference,
  cm.paid_note,
  cm.created_by,
  cm.created_at,
  cm.updated_at,
  -- Internal (cost-derived) — masked for non-admins.
  case when app.is_admin() then cm.invoice_gross_profit end as invoice_gross_profit,
  case when app.is_admin() or cm.commission_type <> 'percent_of_gross_profit'
       then cm.basis_amount end as basis_amount,
  app.is_admin() as can_see_internal
from public.commissions cm
join public.invoices i on i.id = cm.invoice_id
left join public.clients c on c.id = i.client_id
where app.is_staff()
  and ( app.is_admin() or cm.recipient_id = auth.uid() );

revoke all on public.v_commissions from anon;
grant select on public.v_commissions to authenticated;
comment on view public.v_commissions is
  'Staff commission surface. Row-scoped (admins all; reps own only); masks invoice gross profit and GP-basis for non-admins.';

-- ----------------------------------------------------------------------------
-- v_commission_summary — KPI rollup over the scoped commission surface.
-- Inherits v_commissions'' scope (admin: company-wide; rep: their own totals).
-- ----------------------------------------------------------------------------
create or replace view public.v_commission_summary as
select
  coalesce(sum(amount) filter (where status = 'pending'), 0)  as pending,
  coalesce(sum(amount) filter (where status = 'earned'), 0)   as earned,
  coalesce(sum(amount) filter (where status = 'approved'), 0) as approved,
  coalesce(sum(amount) filter (where status = 'paid'), 0)     as paid,
  coalesce(sum(amount) filter (where status in ('earned','approved')), 0) as owed,
  count(*) filter (where status <> 'void')                    as active_count
from public.v_commissions;

revoke all on public.v_commission_summary from anon;
grant select on public.v_commission_summary to authenticated;

-- ----------------------------------------------------------------------------
-- v_ar_aging — open receivables with deterministic aging buckets.
--   Included : issued invoices with a positive balance (status sent | partial).
--   Excluded : drafts, voids, and fully-paid invoices (never "outstanding").
--   Aging    : from due_date vs current_date (deterministic per query).
--   Scope    : admins company-wide; reps only their book (own orders / clients).
-- Contains NO cost/profit columns — every figure is customer-facing, so reps may
-- safely see their own book''s receivables.
-- ----------------------------------------------------------------------------
create or replace view public.v_ar_aging
  with (security_invoker = false, security_barrier = true)
as
select
  i.id,
  i.invoice_number,
  i.client_id,
  coalesce(i.client_snapshot->>'company_name', c.company_name) as company_name,
  i.sales_rep_id,
  i.sales_rep_name,
  i.currency,
  i.status,
  i.issue_date,
  i.due_date,
  i.total,
  i.amount_paid,
  i.balance_due,
  greatest(0, current_date - i.due_date) as days_overdue,
  case
    when i.due_date is null or current_date <= i.due_date then 'current'
    when current_date - i.due_date <= 30 then 'd1_30'
    when current_date - i.due_date <= 60 then 'd31_60'
    when current_date - i.due_date <= 90 then 'd61_90'
    else 'd90_plus'
  end as aging_bucket
from public.invoices i
left join public.clients c on c.id = i.client_id
where i.status in ('sent','partial')
  and i.balance_due > 0
  and app.is_staff()
  and ( app.is_admin()
     or i.sales_rep_id = auth.uid()
     or i.client_id in (select app.rep_client_ids()) );

revoke all on public.v_ar_aging from anon;
grant select on public.v_ar_aging to authenticated;
comment on view public.v_ar_aging is
  'Open receivables (sent/partial, balance > 0) with deterministic aging buckets. Row-scoped; no cost/profit columns.';

-- ----------------------------------------------------------------------------
-- v_ar_summary — outstanding + per-bucket totals over the scoped AR surface.
-- ----------------------------------------------------------------------------
create or replace view public.v_ar_summary as
select
  count(*)                                                                as invoice_count,
  coalesce(sum(balance_due), 0)                                          as total_outstanding,
  coalesce(sum(balance_due) filter (where aging_bucket = 'current'), 0)  as current_amt,
  coalesce(sum(balance_due) filter (where aging_bucket = 'd1_30'), 0)    as d1_30,
  coalesce(sum(balance_due) filter (where aging_bucket = 'd31_60'), 0)   as d31_60,
  coalesce(sum(balance_due) filter (where aging_bucket = 'd61_90'), 0)   as d61_90,
  coalesce(sum(balance_due) filter (where aging_bucket = 'd90_plus'), 0) as d90_plus,
  coalesce(sum(balance_due) filter (where aging_bucket <> 'current'), 0) as overdue_amt
from public.v_ar_aging;

revoke all on public.v_ar_summary from anon;
grant select on public.v_ar_summary to authenticated;
