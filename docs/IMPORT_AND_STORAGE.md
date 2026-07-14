# Aurum Supply House — Import & Storage Design

This document details the Excel import pipeline, duplicate detection, version history, storage
layout, and PDF generation. It expands §5 of `ARCHITECTURE.md`.

## 1. Design goal

An import must be **safe, previewable, and reversible in intent**: a user should always see exactly
what will change before anything is written, and no import may ever alter a historical invoice. This
is achieved by (a) staging every upload, (b) computing a diff against live data, (c) requiring an
explicit commit, and (d) writing cost/price changes as *new* history rows rather than overwrites.

## 2. Column mapping (tolerant header matching)

Catalog spreadsheets vary. The parser normalizes headers (lowercase, strip punctuation/whitespace)
and matches against a synonym table, so `SKU`, `Sku #`, and `item sku` all map to `sku`.

Catalog fields → columns:

| Field          | Accepted headers (examples)                        | Required |
|----------------|----------------------------------------------------|----------|
| `sku`          | sku, item, item #, product code                    | yes      |
| `name`         | product name, name, description, product           | yes      |
| `strength`     | strength, dosage, mg                               | no       |
| `pack_size`    | pack size, pack, size, count                       | no       |
| `manufacturer` | manufacturer, mfr, vendor, brand                   | no       |
| `true_cost`    | true cost, cost, unit cost, landed cost            | yes      |
| `lead_time`    | lead time, lead time (days), lt                    | no       |
| `moq`          | moq, min order, minimum order qty                  | no       |
| `notes`        | notes, comment, remarks                            | no       |

Pricing spreadsheets map `sku` + `selling_price` (`price`, `sell price`, `unit price`) and optional
tier columns (`qty`, `min qty`, `price @ qty`).

Unmatched columns are surfaced to the user as "ignored columns" rather than silently dropped.

## 3. The four stages

### Stage 1 — Upload
File is streamed to the `imports/` bucket. A `catalog_import_batches` (or `pricing_import_batches`)
row is created with `status = 'pending'`, `filename`, `storage_path`, `uploaded_by`.

### Stage 2 — Parse & preview
A Next.js route handler (or Supabase Edge Function) downloads the staged file, parses it with
SheetJS, applies the column mapper, validates each row, and returns a preview payload **without
writing to business tables**:

```jsonc
{
  "batchId": "…",
  "rows": [
    { "row": 2, "sku": "AUR-500", "classification": "new",       "issues": [] },
    { "row": 3, "sku": "AUR-750", "classification": "changed",   "changes": { "true_cost": ["12.00","12.85"] } },
    { "row": 4, "sku": "AUR-500", "classification": "duplicate", "issues": ["duplicate SKU within file"] },
    { "row": 5, "sku": "",        "classification": "error",     "issues": ["missing SKU"] }
  ],
  "summary": { "new": 1, "changed": 1, "unchanged": 0, "duplicate": 1, "error": 1, "ignoredColumns": ["margin%"] }
}
```

Batch flips to `previewed`. Rows are held in memory / a temp payload keyed by `batchId`; nothing
touches `products`.

### Stage 3 — Duplicate detection
Two layers:
- **Within-file:** repeated `sku` values are flagged `duplicate`; the user picks which row wins.
- **Against database:** each valid row is matched by `sku` (case-insensitive via `citext`) and
  classified `new` / `unchanged` / `changed`. For `changed`, the specific fields and old→new values
  are shown. Cost changes are highlighted because they create a new history entry.

### Stage 4 — Commit
The user confirms and chooses a policy for changed rows (default: apply). A single transactional RPC
(`app.commit_catalog_import(batchId, decisions)`) runs:

1. Insert `new` products.
2. For rows whose `true_cost` changed, insert a **new `product_cost_history`** row
   (`source = 'import'`, `import_batch_id = batchId`). The `refresh_current_cost` trigger updates
   `products.current_true_cost`. Existing invoices are untouched by construction.
3. Update non-cost descriptive fields (name, pack size, notes) in place — these are not financial and
   are safe to correct.
4. Write `summary` counts, set `status = 'committed'`, `committed_at = now()`.

Any failure raises and rolls back the whole transaction; the batch is set `failed` with the error
message. Because step 2 only ever appends, an import can never rewrite historical cost.

## 4. Version history

"Version history" is realized as the union of three durable records:
- the `*_import_batches` trail (who uploaded what file, when, with what result),
- the append-only `product_cost_history` (every cost the catalog has ever held), and
- the `pricing_item_history` journal (every price change on every sheet).

Together these answer "what did this SKU cost / sell for on date X, and where did that number come
from" — permanently and without affecting any invoice.

## 5. Storage layout

| Bucket           | Contents                                   | Read        | Write |
|------------------|--------------------------------------------|-------------|-------|
| `company`        | logo, letterhead assets                    | staff       | owner |
| `imports`        | raw uploaded spreadsheets (audit)          | admin       | admin |
| `po-attachments` | manufacturer invoice / COA / packing / trk | staff       | admin |
| `invoice-pdfs`   | generated invoice PDFs                      | staff       | admin |
| `po-pdfs`        | generated purchase-order PDFs              | staff       | admin |

Object paths are namespaced by entity id, e.g. `po-attachments/{po_id}/{uuid}-coa.pdf` and
`invoice-pdfs/{invoice_id}.pdf`. Downloads are served through short-lived **signed URLs** minted
server-side after an access check, so no bucket is ever public.

## 5a. v0.2 additions affecting imports & storage

**Customer pricing overrides** are managed in-app per client (the `client_price_overrides` table),
not via a bulk spreadsheet in Phase 1. The existing pricing-sheet import pipeline is unchanged; an
override is a single-SKU exception layered on top of a client's assigned sheet and resolved at order
time by `app.resolve_price` (priority: override → assigned model → default model → manual).

**Line-level lot COA storage.** In addition to PO-level attachments, an order line carries an optional
`coa_path` (plus lot number and dates) for future traceability. When used, the referenced COA lives in
the `po-attachments` bucket (or a future `lot-coas` bucket) and is served via signed URL like every
other document. These fields are optional and untouched by the Phase 1 order builder.

## 6. PDF generation

Branded invoice and PO PDFs render server-side from the record's **snapshot**, not live data:

- Invoice PDFs read `invoices.client_snapshot`, `invoice_items` (snapshotted sku/name/price), and
  `app_settings` branding — so re-downloading a year-old invoice reproduces it byte-for-byte.
- Rendering uses React-PDF (or headless Chromium) in a route handler; the output is written to
  `invoice-pdfs/` and its path stored on `invoices.pdf_path`.
- Internal economics (cost, margin, commission) are **never** included in the customer PDF template.
