-- ============================================================================
-- Aurum Supply House · 0075 · Activity log + Insights views
-- ============================================================================

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  entity_type text not null,      -- 'invoice','purchase_order','client','payment',...
  entity_id   uuid,
  action      text not null,      -- 'created','sent','status_changed','payment_recorded',...
  summary     text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_created on public.activity_log(created_at desc);
create index if not exists idx_activity_entity  on public.activity_log(entity_type, entity_id);

-- Generic writer used by triggers.
create or replace function app.record_activity(
  p_entity_type text, p_entity_id uuid, p_action text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log(actor_id, entity_type, entity_id, action, summary, metadata)
  values (auth.uid(), p_entity_type, p_entity_id, p_action, p_summary, p_meta);
$$;

-- Feed activity from key events.
create or replace function app.trg_activity_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_activity('invoice', new.id, 'created',
      'Invoice '||new.invoice_number||' created', jsonb_build_object('client_id', new.client_id));
  elsif new.status is distinct from old.status then
    perform app.record_activity('invoice', new.id, 'status_changed',
      'Invoice '||new.invoice_number||' → '||new.status,
      jsonb_build_object('from', old.status, 'to', new.status, 'client_id', new.client_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_activity_invoice on public.invoices;
create trigger trg_activity_invoice after insert or update on public.invoices
  for each row execute function app.trg_activity_invoice();

create or replace function app.trg_activity_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  select invoice_number into v_num from public.invoices where id = new.invoice_id;
  perform app.record_activity('payment', new.id, 'payment_recorded',
    'Payment '||new.amount::text||' on '||coalesce(v_num,'invoice'),
    jsonb_build_object('invoice_id', new.invoice_id, 'amount', new.amount));
  return new;
end;
$$;
drop trigger if exists trg_activity_payment on public.payments;
create trigger trg_activity_payment after insert on public.payments
  for each row execute function app.trg_activity_payment();

-- ----------------------------------------------------------------------------
-- Insights views  (reporting reads immutable snapshots — always reconciles)
-- Views run with the querying user's privileges, so RLS on base tables applies.
-- ----------------------------------------------------------------------------
create or replace view public.v_revenue_monthly as
select date_trunc('month', coalesce(issue_date, created_at::date))::date as month,
       count(*)                       as invoice_count,
       sum(total)                     as revenue,
       sum(gross_profit)              as gross_profit,
       sum(net_profit)                as net_profit
from public.invoices
where status <> 'void' and status <> 'draft'
group by 1
order by 1;

create or replace view public.v_profit_by_client as
select c.id as client_id, c.company_name,
       count(i.*)          as invoices,
       sum(i.total)        as revenue,
       sum(i.gross_profit) as gross_profit,
       sum(i.net_profit)   as net_profit
from public.clients c
left join public.invoices i
  on i.client_id = c.id and i.status not in ('void','draft')
group by c.id, c.company_name;

create or replace view public.v_profit_by_product as
select ii.product_id,
       ii.sku,
       max(ii.product_name)         as product_name,
       sum(ii.quantity)             as units_sold,
       sum(ii.line_subtotal)        as revenue,
       sum(ii.line_gross_profit)    as gross_profit
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id and i.status not in ('void','draft')
group by ii.product_id, ii.sku;

create or replace view public.v_profit_by_rep as
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

create or replace view public.v_commission_by_rep as
select coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid) as recipient_id,
       max(c.recipient_name)                              as recipient_name,
       sum(c.amount) filter (where c.status <> 'void')    as total,
       sum(c.amount) filter (where c.status = 'paid')     as paid,
       sum(c.amount) filter (where c.status in ('pending','approved')) as owed
from public.commissions c
group by 1;

create or replace view public.v_outstanding_invoices as
select i.id, i.invoice_number, i.client_id, i.total, i.amount_paid, i.balance_due,
       i.due_date, i.status
from public.invoices i
where i.status in ('sent','partial') and i.balance_due > 0
order by i.due_date nulls last;

create or replace view public.v_purchase_spend_monthly as
select date_trunc('month', coalesce(received_at::date, created_at::date))::date as month,
       count(*)      as po_count,
       sum(total)    as spend
from public.purchase_orders
where status not in ('draft','closed') or status = 'closed'
group by 1
order by 1;
