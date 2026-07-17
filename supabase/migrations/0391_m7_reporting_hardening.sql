-- ============================================================================
-- Aurum Supply House · 0391 · M7 · Harden legacy insights views (ADDITIVE / FIX)
-- ----------------------------------------------------------------------------
-- SECURITY FIX. The M0 insights views in 0075 (v_revenue_monthly,
-- v_profit_by_client, v_profit_by_product, v_profit_by_rep, v_commission_by_rep,
-- v_outstanding_invoices, v_purchase_spend_monthly) carry raw gross_profit /
-- net_profit / cost aggregates. Their header comment claimed "views run with the
-- querying user's privileges," but none actually set `security_invoker = true`,
-- so they ran with the VIEW OWNER's rights and applied neither base-table RLS,
-- rep row-scoping, nor cost masking. A Sales Rep with SELECT on these views could
-- therefore read company-wide profit.
--
-- Fix: recreate each WITH (security_invoker = true) so base-table RLS is the gate
-- (invoices/commissions are admin-only since 0210/0260; purchase_orders is
-- admin-only since 0350). Result: admins see full company-wide figures; a rep
-- gets zero invoice/commission/PO rows and therefore NULL/zero profit — the
-- guarantee is now enforced at the DB layer, not just by admin-gated callers.
-- Definitions are otherwise byte-for-byte identical to 0075.
-- ============================================================================

create or replace view public.v_revenue_monthly
  with (security_invoker = true) as
select date_trunc('month', coalesce(issue_date, created_at::date))::date as month,
       count(*)                       as invoice_count,
       sum(total)                     as revenue,
       sum(gross_profit)              as gross_profit,
       sum(net_profit)                as net_profit
from public.invoices
where status <> 'void' and status <> 'draft'
group by 1
order by 1;

create or replace view public.v_profit_by_client
  with (security_invoker = true) as
select c.id as client_id, c.company_name,
       count(i.*)          as invoices,
       sum(i.total)        as revenue,
       sum(i.gross_profit) as gross_profit,
       sum(i.net_profit)   as net_profit
from public.clients c
left join public.invoices i
  on i.client_id = c.id and i.status not in ('void','draft')
group by c.id, c.company_name;

create or replace view public.v_profit_by_product
  with (security_invoker = true) as
select ii.product_id,
       ii.sku,
       max(ii.product_name)         as product_name,
       sum(ii.quantity)             as units_sold,
       sum(ii.line_subtotal)        as revenue,
       sum(ii.line_gross_profit)    as gross_profit
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id and i.status not in ('void','draft')
group by ii.product_id, ii.sku;

create or replace view public.v_profit_by_rep
  with (security_invoker = true) as
select p.id as rep_id, p.full_name,
       count(i.*)          as invoices,
       sum(i.total)        as revenue,
       sum(i.gross_profit) as gross_profit,
       sum(i.net_profit)   as net_profit
from public.profiles p
left join public.invoices i
  on i.sales_rep_id = p.id and i.status not in ('void','draft')
where p.role = 'sales_rep'
group by p.id, p.full_name;

create or replace view public.v_commission_by_rep
  with (security_invoker = true) as
select coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid) as recipient_id,
       max(c.recipient_name)                              as recipient_name,
       sum(c.amount) filter (where c.status <> 'void')    as total,
       sum(c.amount) filter (where c.status = 'paid')     as paid,
       sum(c.amount) filter (where c.status in ('pending','approved')) as owed
from public.commissions c
group by 1;

create or replace view public.v_outstanding_invoices
  with (security_invoker = true) as
select i.id, i.invoice_number, i.client_id, i.total, i.amount_paid, i.balance_due,
       i.due_date, i.status
from public.invoices i
where i.status in ('sent','partial') and i.balance_due > 0
order by i.due_date nulls last;

create or replace view public.v_purchase_spend_monthly
  with (security_invoker = true) as
select date_trunc('month', coalesce(received_at::date, created_at::date))::date as month,
       count(*)      as po_count,
       sum(total)    as spend
from public.purchase_orders
where status not in ('draft','closed') or status = 'closed'
group by 1
order by 1;

-- Privileges: RLS (now applied via security_invoker) is the real gate; keep the
-- views unreachable by anon and selectable by authenticated, consistent with
-- every other view in the schema.
do $$
declare v text;
begin
  foreach v in array array[
    'v_revenue_monthly','v_profit_by_client','v_profit_by_product','v_profit_by_rep',
    'v_commission_by_rep','v_outstanding_invoices','v_purchase_spend_monthly'
  ] loop
    execute format('revoke all on public.%I from anon;', v);
    execute format('grant select on public.%I to authenticated;', v);
  end loop;
end $$;
