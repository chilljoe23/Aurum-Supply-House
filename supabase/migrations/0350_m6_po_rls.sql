-- ============================================================================
-- Aurum Supply House · 0350 · M6 · Purchase-order RLS — Owner/Admin only (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Purchase orders carry manufacturer COST data, so the entire subsystem is
-- Owner/Admin-only at the DB layer. The 0080 baseline granted Sales Reps STAFF
-- READ on the PO tables and manufacturer_payments; this migration REVOKES that by
-- replacing those policies with single admin-only `for all` policies (same shape
-- as 0300). A Sales Rep now gets ZERO rows from any PO table, view, or join, and
-- cannot obtain a cost through any route. New tables (shipments, receipts) are
-- created default-deny with the same admin-only policy.
--
-- Storage: the private 'po-attachments' bucket read policy (0090) is tightened
-- from app.is_staff() to app.is_admin(), so reps cannot read manufacturing docs.
-- ============================================================================

-- ---- Base PO tables : replace staff-read + admin-write with admin-only -------
do $$
declare t text;
begin
  foreach t in array array[
    'purchase_orders','purchase_order_items','purchase_order_attachments','purchase_order_status_history'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('drop policy if exists %I_admin_all on public.%I;', t, t);
    execute format('create policy %I_admin_all on public.%I for all using (app.is_admin()) with check (app.is_admin());', t, t);
  end loop;
end $$;

-- ---- manufacturer_payments : was staff-read; now admin-only ------------------
alter table public.manufacturer_payments enable row level security;
drop policy if exists mfr_pay_read on public.manufacturer_payments;
drop policy if exists mfr_pay_write on public.manufacturer_payments;
drop policy if exists mfr_pay_admin_all on public.manufacturer_payments;
create policy mfr_pay_admin_all on public.manufacturer_payments for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- New receiving tables : default-deny, admin-only -------------------------
alter table public.purchase_order_shipments enable row level security;
drop policy if exists po_shipments_admin_all on public.purchase_order_shipments;
create policy po_shipments_admin_all on public.purchase_order_shipments for all
  using (app.is_admin()) with check (app.is_admin());

alter table public.purchase_order_receipts enable row level security;
drop policy if exists po_receipts_admin_all on public.purchase_order_receipts;
create policy po_receipts_admin_all on public.purchase_order_receipts for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- Table privileges: reachable by `authenticated` (RLS is the real gate),
--       never by `anon`. RLS above restricts every row to admins. ------------
revoke all on public.purchase_order_shipments from anon;
revoke all on public.purchase_order_receipts  from anon;
grant select, insert, update, delete on public.purchase_order_shipments to authenticated;
grant select, insert, update, delete on public.purchase_order_receipts  to authenticated;

-- ---- Storage: private manufacturing attachments become Owner/Admin-only ------
-- (0090 created the private 'po-attachments' bucket with a staff read policy.)
drop policy if exists storage_po_attach_read on storage.objects;
create policy storage_po_attach_read on storage.objects for select
  using (bucket_id = 'po-attachments' and app.is_admin());
-- write policy (admin-only) from 0090 is unchanged; PO PDFs bucket 'po-pdfs'
-- likewise remains admin-gated.
