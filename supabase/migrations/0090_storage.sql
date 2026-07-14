-- ============================================================================
-- Aurum Supply House · 0090 · Storage buckets & policies
-- ============================================================================
-- All buckets are private. Access mirrors table RLS via storage.objects policies.

insert into storage.buckets (id, name, public) values
  ('company',        'company',        false),
  ('imports',        'imports',        false),
  ('po-attachments', 'po-attachments', false),
  ('invoice-pdfs',   'invoice-pdfs',   false),
  ('po-pdfs',        'po-pdfs',        false)
on conflict (id) do nothing;

-- Staff may read business documents; admins write; owner controls branding.
drop policy if exists storage_company_read  on storage.objects;
create policy storage_company_read  on storage.objects for select
  using (bucket_id = 'company' and app.is_staff());
drop policy if exists storage_company_write on storage.objects;
create policy storage_company_write on storage.objects for all
  using (bucket_id = 'company' and app.is_owner())
  with check (bucket_id = 'company' and app.is_owner());

drop policy if exists storage_imports_rw on storage.objects;
create policy storage_imports_rw on storage.objects for all
  using (bucket_id = 'imports' and app.is_admin())
  with check (bucket_id = 'imports' and app.is_admin());

drop policy if exists storage_po_attach_read on storage.objects;
create policy storage_po_attach_read on storage.objects for select
  using (bucket_id = 'po-attachments' and app.is_staff());
drop policy if exists storage_po_attach_write on storage.objects;
create policy storage_po_attach_write on storage.objects for all
  using (bucket_id = 'po-attachments' and app.is_admin())
  with check (bucket_id = 'po-attachments' and app.is_admin());

drop policy if exists storage_po_pdf_read on storage.objects;
create policy storage_po_pdf_read on storage.objects for select
  using (bucket_id = 'po-pdfs' and app.is_staff());
drop policy if exists storage_po_pdf_write on storage.objects;
create policy storage_po_pdf_write on storage.objects for all
  using (bucket_id = 'po-pdfs' and app.is_admin())
  with check (bucket_id = 'po-pdfs' and app.is_admin());

-- Invoice PDFs: readable by staff who can access the invoice is enforced in-app
-- via signed URLs; bucket policy keeps it to staff, admin writes.
drop policy if exists storage_invoice_pdf_read on storage.objects;
create policy storage_invoice_pdf_read on storage.objects for select
  using (bucket_id = 'invoice-pdfs' and app.is_staff());
drop policy if exists storage_invoice_pdf_write on storage.objects;
create policy storage_invoice_pdf_write on storage.objects for all
  using (bucket_id = 'invoice-pdfs' and app.is_admin())
  with check (bucket_id = 'invoice-pdfs' and app.is_admin());
