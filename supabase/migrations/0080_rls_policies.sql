-- ============================================================================
-- Aurum Supply House · 0080 · Row Level Security
-- ============================================================================
-- Model:
--   owner     -> everything, incl. settings + deletes
--   admin     -> full operational read/write; approve/pay commissions; no settings/deletes
--   sales_rep -> own book only (assigned clients, own invoices, own commissions)
--   reference data (products/manufacturers/pricing) -> staff read, admin write
-- Immutability is enforced by triggers (0030/0060/0070), independent of RLS.

-- ---- Access helpers (security definer to avoid RLS recursion) ---------------
create or replace function app.rep_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.clients where assigned_rep_id = auth.uid();
$$;

create or replace function app.can_access_invoice(p_invoice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_admin()
      or exists (
        select 1 from public.invoices i
        where i.id = p_invoice
          and ( i.sales_rep_id = auth.uid()
             or i.client_id in (select app.rep_client_ids()) )
      );
$$;

-- ---- Enable RLS on everything ----------------------------------------------
alter table public.profiles                     enable row level security;
alter table public.app_settings                 enable row level security;
alter table public.document_sequences           enable row level security;
alter table public.clients                       enable row level security;
alter table public.manufacturers                 enable row level security;
alter table public.products                       enable row level security;
alter table public.product_cost_history           enable row level security;
alter table public.catalog_import_batches         enable row level security;
alter table public.pricing_sheets                 enable row level security;
alter table public.pricing_sheet_items            enable row level security;
alter table public.pricing_tiers                  enable row level security;
alter table public.pricing_item_history           enable row level security;
alter table public.pricing_import_batches         enable row level security;
alter table public.purchase_orders                enable row level security;
alter table public.purchase_order_items           enable row level security;
alter table public.purchase_order_attachments     enable row level security;
alter table public.purchase_order_status_history  enable row level security;
alter table public.invoices                       enable row level security;
alter table public.invoice_items                  enable row level security;
alter table public.invoice_status_history         enable row level security;
alter table public.payments                       enable row level security;
alter table public.commissions                    enable row level security;
alter table public.activity_log                   enable row level security;

-- ---- profiles ---------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (app.is_staff());                        -- all staff can see the roster (dropdowns)

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- app_settings : staff read, owner write --------------------------------
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select using (app.is_staff());
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for update
  using (app.is_owner()) with check (app.is_owner());

-- document_sequences: no direct policies -> only reachable via definer functions.

-- ---- clients : admin all; rep sees/edits own book --------------------------
drop policy if exists clients_admin_all on public.clients;
create policy clients_admin_all on public.clients for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists clients_rep_select on public.clients;
create policy clients_rep_select on public.clients for select
  using (app.is_staff() and assigned_rep_id = auth.uid());

drop policy if exists clients_rep_insert on public.clients;
create policy clients_rep_insert on public.clients for insert
  with check (app.is_staff() and assigned_rep_id = auth.uid());

drop policy if exists clients_rep_update on public.clients;
create policy clients_rep_update on public.clients for update
  using (app.is_staff() and assigned_rep_id = auth.uid())
  with check (assigned_rep_id = auth.uid());

-- ---- Reference data: staff read, admin write -------------------------------
-- Applied uniformly to manufacturers, products, cost history, pricing, imports.
do $$
declare t text;
begin
  foreach t in array array[
    'manufacturers','products','product_cost_history','catalog_import_batches',
    'pricing_sheets','pricing_sheet_items','pricing_tiers','pricing_item_history',
    'pricing_import_batches'
  ] loop
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select using (app.is_staff());', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('create policy %I_write on public.%I for all using (app.is_admin()) with check (app.is_admin());', t, t);
  end loop;
end $$;

-- ---- Purchasing: staff read, admin write -----------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders','purchase_order_items','purchase_order_attachments','purchase_order_status_history'
  ] loop
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select using (app.is_staff());', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('create policy %I_write on public.%I for all using (app.is_admin()) with check (app.is_admin());', t, t);
  end loop;
end $$;

-- ---- invoices : admin all; rep own book ------------------------------------
drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_all on public.invoices for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists invoices_rep_select on public.invoices;
create policy invoices_rep_select on public.invoices for select
  using (app.is_staff() and (sales_rep_id = auth.uid() or client_id in (select app.rep_client_ids())));

drop policy if exists invoices_rep_insert on public.invoices;
create policy invoices_rep_insert on public.invoices for insert
  with check (app.is_staff() and sales_rep_id = auth.uid());

-- reps may edit only their own DRAFT invoices; lock trigger guards the rest.
drop policy if exists invoices_rep_update on public.invoices;
create policy invoices_rep_update on public.invoices for update
  using (app.is_staff() and sales_rep_id = auth.uid() and status = 'draft')
  with check (sales_rep_id = auth.uid());

-- ---- invoice_items / status history : follow parent invoice access ---------
drop policy if exists invoice_items_access on public.invoice_items;
create policy invoice_items_access on public.invoice_items for all
  using (app.can_access_invoice(invoice_id))
  with check (app.can_access_invoice(invoice_id));

drop policy if exists invoice_hist_read on public.invoice_status_history;
create policy invoice_hist_read on public.invoice_status_history for select
  using (app.can_access_invoice(invoice_id));

-- ---- payments : admin write, rep read for own invoices ---------------------
drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments for all
  using (app.is_admin()) with check (app.is_admin());
drop policy if exists payments_rep_read on public.payments;
create policy payments_rep_read on public.payments for select
  using (app.can_access_invoice(invoice_id));

-- ---- commissions : rep reads own; admin manages + approves/pays ------------
drop policy if exists commissions_admin_all on public.commissions;
create policy commissions_admin_all on public.commissions for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists commissions_rep_read on public.commissions;
create policy commissions_rep_read on public.commissions for select
  using (app.is_staff() and recipient_id = auth.uid());

-- Reps may add commission lines to their own draft invoices (e.g. splitting),
-- but cannot approve/pay — those status moves require admin (enforced in app + policy).
drop policy if exists commissions_rep_insert on public.commissions;
create policy commissions_rep_insert on public.commissions for insert
  with check (app.is_staff() and app.can_access_invoice(invoice_id) and status = 'pending');

-- ---- activity_log : staff read (scoped in app for reps); insert via definer -
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select using (app.is_staff());

-- ---- client_price_overrides : admin writes; rep reads own clients' overrides -
alter table public.client_price_overrides enable row level security;
drop policy if exists cpo_admin_all on public.client_price_overrides;
create policy cpo_admin_all on public.client_price_overrides for all
  using (app.is_admin()) with check (app.is_admin());
drop policy if exists cpo_rep_read on public.client_price_overrides;
create policy cpo_rep_read on public.client_price_overrides for select
  using (app.is_staff() and client_id in (select app.rep_client_ids()));

-- ---- manufacturer_payments : admin writes, staff read ----------------------
alter table public.manufacturer_payments enable row level security;
drop policy if exists mfr_pay_read on public.manufacturer_payments;
create policy mfr_pay_read on public.manufacturer_payments for select using (app.is_staff());
drop policy if exists mfr_pay_write on public.manufacturer_payments;
create policy mfr_pay_write on public.manufacturer_payments for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- order_expenses : admin writes; rep reads for accessible orders --------
alter table public.order_expenses enable row level security;
drop policy if exists order_exp_admin_all on public.order_expenses;
create policy order_exp_admin_all on public.order_expenses for all
  using (app.is_admin()) with check (app.is_admin());
drop policy if exists order_exp_rep_read on public.order_expenses;
create policy order_exp_rep_read on public.order_expenses for select
  using (app.can_access_invoice(invoice_id));
