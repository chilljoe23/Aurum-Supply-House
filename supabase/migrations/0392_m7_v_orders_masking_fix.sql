-- ============================================================================
-- Aurum Supply House · 0392 · M7 · SECURITY FIX — reconcile v_orders masking
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- The M7 structural security assertion (supabase/tests/m7_security_assertions.sql)
-- failed against the LIVE database:
--
--     v_orders must mask net_profit / gross_profit / total_true_cost for non-admins
--
-- Root cause is migration drift, not a source defect. In source, v_orders is
-- created exactly once — 0210_m4_masking_rls.sql — and there every internal-
-- economics column is already gated behind app.is_admin(). But Supabase migrations
-- are apply-once (keyed by version), so the live database is still running an
-- EARLIER form of v_orders whose column masking was absent. The row-scope
-- app.is_admin() in the WHERE clause survived (so row isolation and the first
-- assertion checks pass), but the per-column CASE gates did not — leaking raw
-- cost/profit/margin/commission/expense figures to any staff member (sales reps
-- included) who can see the order row. Re-editing 0210 cannot fix a deployed
-- database; only a forward, additive migration can.
--
-- WHAT THIS DOES
-- Re-establishes the canonical, fully-masked v_orders definition so the live
-- schema matches source intent. This is ADDITIVE and idempotent: if the live view
-- already matched source, behavior is unchanged; where it drifted, masking is
-- restored. Owner/Admin access and row-level book isolation are preserved exactly.
--
-- SAFETY
--   * No schema object depends on v_orders (verified across all migrations: only
--     app-level PostgREST SELECTs and behavioral tests read it), so recreation
--     cannot cascade. We DROP + CREATE (rather than CREATE OR REPLACE) so the fix
--     reconciles the view regardless of how the live column list/order drifted —
--     CREATE OR REPLACE would error if the deployed column signature differs.
--   * The column set, names, order, and types are identical to 0210, so the app's
--     generated types (src/types/database.types.ts) remain valid.
--   * ALL SIX internal-economics columns are masked (not only the three named by
--     the assertion): total_true_cost, gross_profit, gross_margin,
--     total_commission, total_expenses, net_profit — plus can_see_internal.
-- ============================================================================

drop view if exists public.v_orders;

create view public.v_orders
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
  -- Internal economics — masked for non-admins (NULL for any non-admin, incl. reps).
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
  'Staff order surface. Row-scoped (admins all, reps own book); masks cost/profit/margin/commission/expenses for non-admins. Masking reconciled in 0392 after live-schema drift.';
