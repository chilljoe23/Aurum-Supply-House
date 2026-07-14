# M1 — Catalog & Excel Import (delivered)

Builds on M0 additively. No M0 migration was rewritten. Preserves the design system exactly.

## What shipped

A full product catalog and a safe, reusable 8-step Excel import pipeline. Owners/Admins can upload a
manufacturer spreadsheet, choose a worksheet, preview, map columns, validate, review a per-row
classification, then import atomically (or valid-rows-only) — with original files stored privately,
cost changes preserved as effective-dated history, and role-enforced true-cost visibility.

## New migrations (additive)

- `0100_m1_catalog_extend.sql` — adds `products` fields (description, product_form, unit_of_measure,
  manufacturer_sku, category); `manufacturers` fields (legal_name, payment_terms, default_currency,
  generated `normalized_name`); `product_cost_history` effective-dating (`effective_to`,
  `previous_cost`, `reason`); relaxes the append-only guard to allow *closing* a record only;
  `app.normalize_name`, `app.find_manufacturer`, `app.record_cost_change`; and hardens
  `app.refresh_current_cost` to resolve the open record deterministically.
- `0110_m1_import.sql` — extends `catalog_import_batches` (file_type, worksheet, mode, counters,
  error_report_path, kind); adds `catalog_import_rows`; the atomic `app.commit_catalog_import` RPC;
  and public admin-checked wrappers `public.import_catalog`, `public.record_product_cost`.
- `0120_m1_rls_catalog.sql` — locks base `products`, `product_cost_history`, and import tables to
  admins; adds the security-barrier `catalog_products` view that masks `true_cost` for reps.

## New tables / functions

Tables: `catalog_import_rows`. Extended: `products`, `manufacturers`, `product_cost_history`,
`catalog_import_batches`. View: `catalog_products`.
Functions: `app.record_cost_change`, `app.commit_catalog_import`, `app.normalize_name`,
`app.find_manufacturer`, `public.import_catalog`, `public.record_product_cost`, hardened
`app.refresh_current_cost`.

## Routes & components

Routes: `/catalog` (table), `/catalog/[id]` (detail), `/catalog/import` (wizard),
`/catalog/imports` + `/catalog/imports/[batchId]` (history), `/catalog/manufacturers`.
Server actions: `src/app/(app)/catalog/actions.ts`.
Library: `src/lib/catalog/{fields,mapping,normalize,classify,parse,schemas,csv,queries}.ts`.
Components: `catalog-table`, `product-form-dialog`, `product-detail-actions`,
`manufacturer-form-dialog`, `manufacturers-manager`, `download-button`, and
`import/import-wizard`. New primitive: `ui/textarea`.

## Security (DB-enforced)

Reps: read active catalog via `catalog_products` (true_cost = NULL, cost history & base tables
denied), cannot import or manage manufacturers/products. Owners/Admins: full access. The RPC
wrappers re-check `app.is_admin()` server-side; the view masks cost at the column level.

## Tests

- `supabase/tests/m1_catalog.sql` — new import, update + cost history, atomic rollback, valid-only
  skip, deactivation, manual-cost-requires-reason, append-only guard, RLS cost hiding.
- Parsing/classification logic — 28 assertions (mapping, cost/MOQ/date/formula/active validation,
  duplicate-in-file, all classifications).

## Business guarantees

Products matched by SKU (never name). Products absent from a newer sheet are never deleted. Cost
changes close the prior record and append a new one; historical invoices/POs keep their own
snapshots. Imports are atomic by default; valid-only preserves an exact skipped-row report.
