-- ============================================================================
-- Aurum Supply House · 0390 · M7 · Reporting surfaces (ADDITIVE)
-- ----------------------------------------------------------------------------
-- The Command Center and Insights read ONLY from row-scoped, column-masked
-- surfaces, exactly like every staff read since M4. This migration adds:
--   1. v_report_order_lines — per-line sales surface joined to its invoice, so
--      "sales/profit by product" can filter by date/status/client/rep without
--      the app ever touching a base table. Line cost/GP are masked to admins.
--   2. report_recent_activity() — a rep-safe activity feed. activity_log is
--      staff-wide at the DB layer (0080), so this SECURITY DEFINER function does
--      the per-rep book scoping the base table cannot, in one authoritative place.
--
-- No base tables, columns, RPCs, or historical figures are altered. Reporting is
-- computed from the FROZEN invoice/line snapshots (never from current catalog
-- cost), and voided/draft rows are excluded by the callers, mirroring M4 rules.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_report_order_lines — line-level sales, row-scoped like v_orders, with line
-- true cost and line gross profit masked for non-admins (NULL). Revenue is the
-- frozen line_subtotal (pre header-level discount/shipping/fees/tax), matching
-- the existing v_profit_by_product definition so product reports reconcile.
-- ----------------------------------------------------------------------------
create or replace view public.v_report_order_lines
  with (security_invoker = false, security_barrier = true)
as
select
  ii.id,
  ii.invoice_id,
  i.invoice_number,
  i.status,
  i.issue_date,
  i.created_at        as invoice_created_at,
  i.client_id,
  coalesce(i.client_snapshot->>'company_name', c.company_name) as company_name,
  i.sales_rep_id,
  i.sales_rep_name,
  i.currency,
  ii.product_id,
  ii.sku,
  ii.product_name,
  ii.manufacturer_name,
  ii.quantity,
  ii.unit_price,
  ii.line_subtotal    as line_revenue,
  -- Internal economics — masked for non-admins (NULL), never a zero.
  case when app.is_admin() then ii.line_true_cost    end as line_true_cost,
  case when app.is_admin() then ii.line_gross_profit end as line_gross_profit,
  app.is_admin()      as can_see_internal
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id
left join public.clients c on c.id = i.client_id
where app.is_staff()
  and ( app.is_admin()
     or i.sales_rep_id = auth.uid()
     or i.client_id in (select app.rep_client_ids()) );

revoke all on public.v_report_order_lines from anon;
grant select on public.v_report_order_lines to authenticated;
comment on view public.v_report_order_lines is
  'M7 line-level sales surface. Row-scoped (admins all, reps own book); masks line true cost and line gross profit for non-admins. Revenue = frozen line_subtotal.';

-- ----------------------------------------------------------------------------
-- report_recent_activity(p_limit) — rep-safe activity feed.
-- activity_log is staff-readable company-wide (0080 activity_read = is_staff),
-- so a rep must NOT be shown other reps' books. This SECURITY DEFINER function
-- applies the same book scope used everywhere else: admins see all; a rep sees
-- their own actions plus events on clients / invoices / quotes in their book.
-- auth.uid() inside a definer still resolves to the CALLER, so scope is correct.
-- ----------------------------------------------------------------------------
create or replace function public.report_recent_activity(p_limit integer default 20)
returns table (
  id          uuid,
  action      text,
  summary     text,
  entity_type text,
  entity_id   uuid,
  created_at  timestamptz,
  actor_id    uuid,
  actor_name  text
)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.summary, a.entity_type, a.entity_id, a.created_at,
         a.actor_id, pr.full_name as actor_name
  from public.activity_log a
  left join public.profiles pr on pr.id = a.actor_id
  where app.is_staff()
    and ( app.is_admin()
       or a.actor_id = auth.uid()
       or (a.entity_type = 'client'  and a.entity_id in (select app.rep_client_ids()))
       or (a.entity_type = 'invoice' and app.can_access_invoice(a.entity_id))
       or (a.entity_type = 'quote'   and app.can_access_quote(a.entity_id)) )
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

revoke all on function public.report_recent_activity(integer) from anon, public;
grant execute on function public.report_recent_activity(integer) to authenticated;
comment on function public.report_recent_activity(integer) is
  'M7 rep-safe recent activity. Admins: company-wide. Reps: own actions + events on clients/invoices/quotes in their book.';
