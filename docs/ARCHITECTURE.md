# Aurum Supply House — System Architecture (Phase 1)

**Status:** Approved · **Version:** 0.2 · **Date:** 14 July 2026
**Scope:** Complete data & security architecture, import/storage design, folder structure, and implementation roadmap. No UI code is written in Phase 1.

---

## Change log — v0.2 (approved revisions)

Six approved changes were folded into the existing design (no redesign):

1. **Orders naming, lifecycle-ready.** The section stays labeled **Orders**; the financial document is still stored as an `invoice` in Phase 1. A reserved `invoices.stage` (`order_stage` enum: quote → approved_order → invoice → paid → fulfilled → complete) leaves room for the future order lifecycle without building fulfillment now. (§3.6)
2. **Customer-specific pricing overrides.** New `client_price_overrides` table + `app.resolve_price()` resolver with priority: customer SKU override → assigned model → default model → manual entry (recorded on the line). Orders still snapshot the resolved price. (§3.4)
3. **External commission recipients.** `commissions.recipient_id` stays nullable; added `recipient_type`, `recipient_email`, `recipient_company`, `payment_notes`. Internal recipients require a user; external partners must not have one (checked). (§3.8)
4. **Manufacturer payment ledger.** New `manufacturer_payments` table (deposit / balance / additional / refund_credit) tracked separately from PO status; PO now shows `total`, `amount_paid`, `balance_due`. (§3.5)
5. **Future-ready lot references.** Optional nullable `lot_number`, `manufacturing_date`, `expiration_date`, `retest_date`, `coa_path` on order lines. Not inventory; not surfaced in the Phase 1 builder. (§3.6)
6. **Clarified profit + expense model.** Gross Profit = product sales − true cost. Net Profit = gross profit − commission − order expenses. New `order_expenses` table (payment_processing_fee, outbound_shipping, packaging, testing, referral_expense, other). Customer-paid shipping revenue (`invoices.shipping`) is stored separately from company-paid freight (an `outbound_shipping` expense). Expenses never appear on customer invoices. (§3.6a, §6)

---

## 0. How to read this document

This is the full Phase 1 design. It is organized so you can review it top to bottom or jump to a module:

1. Principles & assumptions — the decisions everything else rests on.
2. The immutability model — the single most important architectural idea in this system.
3. Data architecture — every table, relationship, and enum, module by module.
4. Row Level Security — how roles map to what each person can see and do.
5. Import & storage — the Excel pipeline, previews, duplicate detection, version history, and files.
6. Money & calculation rules — how cost, profit, margin, and commission are computed and frozen.
7. Folder structure — how the eventual Next.js codebase is laid out.
8. Implementation roadmap — the module-by-module build order after approval.

The runnable SQL lives alongside this document under `supabase/migrations/`. The entity-relationship diagram is in `ERD.md`. This document is the "why"; the SQL is the "what".

---

## 1. Principles & working assumptions

The clarifying questions couldn't be captured before this draft, so the following defaults are baked in. **Each is a reversible decision — flag any you'd like changed and it's a small edit at this stage, an expensive one later.**

**Single company, internal users only (portal-ready).** Aurum Supply House is one wholesale company. The people who log in are employees: Owner, Admin, and Sales Representative. Clients and manufacturers are *records*, not accounts. The schema is nonetheless built so a customer-facing portal (a client seeing only their own invoices) can be layered on later without migration pain — every table that a client might one day read is already scoped by `client_id`, and the role system reserves room for a future `client` role.

**USD now, currency-ready.** Every monetary document carries a `currency` (default `USD`) and an `fx_rate` (default `1`). Nothing in the UI needs to expose currency yet, but no table will need reshaping to add it.

**Tax supported, optional per document.** Invoices carry a tax rate and a computed tax amount; both default to zero. A default rate lives in settings.

**A real payments ledger.** Because "Partial Payment" is a first-class invoice status, partial payments are modeled as their own ledger rather than a single "amount paid" field. Outstanding balance is always derivable and always correct.

**Inventory is designed-for, not built-yet.** Purchasing and Orders are fully modeled, but on-hand stock reconciliation (received quantity minus sold quantity per SKU) is left as a clearly-marked future layer so Phase 1 stays focused. The cost-history and PO-receipt tables it would build on already exist.

**Postgres via Supabase is the system of record.** Auth, database, storage, RLS, and realtime all come from Supabase. Business-critical invariants (immutability, numbering, profit math) are enforced in the database with constraints and triggers — never only in application code — so they hold regardless of which client writes to them.

**Money is `numeric`, never floating point.** All amounts are `numeric(14,4)`; all rates and margins are `numeric(9,6)`. No `float`/`double` touches money.

---

## 2. The immutability model (read this first)

Three business rules dominate the entire design:

> Historical invoices never change. Historical costs never change. Historical pricing never changes.

Getting this right is what separates a trustworthy operating system from a spreadsheet that quietly rewrites the past. The system enforces it two ways at once — **snapshotting** and **locking** — because either alone is insufficient.

### 2.1 Snapshotting — freeze the inputs at the moment of truth

When an invoice is created, it does not *reference* the client's current pricing, the product's current cost, or the rep's current commission rate and trust those to stay put. It **copies** them. Each invoice and each invoice line stores its own permanent snapshot of:

- the customer (name, addresses, contact, payment terms) — `invoices.client_snapshot`
- the pricing model used and each unit selling price — `invoice_items.unit_price`, `invoices.pricing_sheet_name`
- the product's true cost at that moment — `invoice_items.unit_true_cost`
- the sales representative — `invoices.sales_rep_id` + `sales_rep_name`
- the full commission structure — the `commissions` rows attached to the invoice, each with its own rate and computed amount

Because the numbers are copied, later edits to a pricing sheet, a product cost, a client record, or a rep's default commission have **zero effect** on any invoice already written. The same principle governs purchase orders (they snapshot manufacturer and product cost) and commissions (they snapshot their basis amount).

### 2.2 Locking — make the frozen record physically unwritable

Snapshots protect against *upstream* change. Locking protects against *direct* change. Once an invoice leaves `draft` (i.e. it has been sent), a database trigger rejects any `UPDATE` or `DELETE` that would alter a financial column or a line item. Only an explicit, audited whitelist of transitions is permitted afterward: advancing status (`sent → paid`), recording a payment, or voiding. A void never deletes and never rewrites amounts — it sets status to `void` and the record stays legible forever.

Product costs are append-only: a new cost is a new row in `product_cost_history`, never an overwrite. The product's "current cost" is a cached convenience maintained by trigger from the latest history row. Pricing works the same way — sheets are versioned and item changes are journaled, but the invoice never depends on the live sheet, so a price change is safe by construction.

### 2.3 Why both

Snapshotting without locking would let someone edit a sent invoice's copied numbers. Locking without snapshotting would freeze a *reference* that still points at mutable upstream data. Together they guarantee that every historical document is both self-contained and tamper-evident, which is exactly what accurate historical reporting requires.

---

## 3. Data architecture

The schema is grouped into eight domains. Full column definitions, types, defaults, indexes, and triggers are in the SQL migrations; this section explains the shape and the reasoning. See `ERD.md` for the visual map.

### 3.1 Identity & configuration

**`profiles`** — one row per employee, keyed to `auth.users.id`. Holds `full_name`, `email`, `role` (`owner` | `admin` | `sales_rep`), `status` (`active` | `inactive`), `phone`, `avatar_url`, and a nullable `default_commission_rate`/`default_commission_type` used to pre-fill new invoices (never to alter existing ones). A trigger creates the profile row automatically when a Supabase auth user is created.

**`app_settings`** — a single-row table (enforced) holding company identity used on branded PDFs and throughout the UI: legal name, logo path, address, contact details, invoice/PO number prefixes and next-number seeds, default payment terms, default tax rate, and default currency.

**`document_sequences`** — atomic counters for human-readable `INV-2026-000123` / `PO-2026-000045` numbers. Numbers are allocated by a `SECURITY DEFINER` function that increments under a row lock, so two simultaneous invoices can never collide on a number.

### 3.2 Clients

**`clients`** — `company_name`, `primary_contact_name`, `email`, `phone`, `billing_address` and `shipping_address` (structured `jsonb`: line1/line2/city/state/postal/country), `assigned_rep_id → profiles`, `default_pricing_sheet_id → pricing_sheets`, `payment_terms`, `notes`, `status` (`active` | `inactive` | `prospect`), and audit columns. A reserved nullable `portal_user_id` anticipates the future client login without being used yet.

The client detail page's panels (Invoices, Purchase History, Profit Generated, Commission Paid, Products Purchased, Timeline) are **derived views**, not stored columns — they are computed from `invoices`, `invoice_items`, `commissions`, and `activity_log` filtered by `client_id`. Nothing about a client's history is duplicated or can drift.

### 3.3 Catalog

**`manufacturers`** — supplier master: `name`, contact fields, `address` jsonb, `default_lead_time_days`, `notes`, `status`.

**`products`** — the catalog: `sku` (unique), `name`, `strength`, `pack_size`, `manufacturer_id`, `current_true_cost` (cached), `currency`, `lead_time_days`, `moq`, `notes`, `status` (`active` | `discontinued`), audit columns. `current_true_cost` is never edited directly by application code — it is maintained by trigger from the cost history.

**`product_cost_history`** — append-only ledger of true cost over time: `product_id`, `true_cost`, `currency`, `effective_date`, `source` (`manual` | `import` | `purchase_order`), `import_batch_id`, `created_by`, `created_at`. This is what makes "historical costs never overwrite invoices" true at the data layer: the record of what a thing cost on a given date is permanent, and invoices additionally snapshot their own copy.

**`catalog_import_batches`** — one row per Excel upload (details in §5).

### 3.4 Pricing

**`pricing_sheets`** — a named model (`Pricing A`, `VIP`, `Distributor`, …): `name`, `description`, `status` (`active` | `archived`), `is_default`, `version`, audit columns. Unlimited sheets are supported.

**`pricing_sheet_items`** — `pricing_sheet_id`, `product_id`, `selling_price`, `currency`. Unique on `(pricing_sheet_id, product_id)`.

**`pricing_tiers`** — optional quantity breaks per item: `pricing_sheet_item_id`, `min_qty`, `max_qty` (nullable = "and up"), `unit_price`. Absent tiers simply means flat pricing.

**`pricing_item_history`** — journals every price change to a sheet item for auditability. Invoices don't depend on it (they snapshot), but it answers "what was VIP charging for this SKU in March".

**`client_price_overrides`** — a per-customer, per-SKU price that overrides the assigned sheet without needing a whole separate sheet: `client_id`, `product_id`, `selling_price`, `currency`, `note`. Unique on `(client_id, product_id)`.

Price resolution is centralized in `app.resolve_price(client_id, product_id, quantity)`, which returns the price and its source in strict priority order: (1) a customer-specific SKU override, (2) the customer's assigned pricing model (honoring quantity tiers), (3) the default pricing model, (4) `manual` — no rule found, so the builder takes a manual price and records `price_overridden = true` on the line. A customer's price for a line is resolved at order time and immediately copied onto the invoice line. Changing a sheet or an override afterward is therefore always safe — historical orders keep their snapshot.

### 3.5 Purchasing

**`purchase_orders`** — `po_number` (unique), `manufacturer_id`, `manufacturer_snapshot` (jsonb), `status` (10-state enum below), `currency`, `fx_rate`, `subtotal`, `shipping`, `fees`, `tax`, `total`, `deposit_amount`, `expected_date`, `notes`, and per-transition timestamps, audit columns.

PO status enum, in order: `draft`, `sent`, `confirmed`, `deposit_paid`, `production`, `testing`, `ready_to_ship`, `shipped`, `received`, `closed`.

**`purchase_order_items`** — `purchase_order_id`, `product_id`, `sku`/`name` snapshots, `quantity`, `unit_cost` (auto-populated from `products.current_true_cost` but overridable), `line_total`, `notes`. On receipt, each line can write a `product_cost_history` entry so real landed costs feed the catalog.

**`purchase_order_attachments`** — `type` (`manufacturer_invoice` | `coa` | `packing_list` | `tracking` | `other`), `storage_path`, `filename`, `uploaded_by`, `created_at`.

**`purchase_order_status_history`** — `from_status`, `to_status`, `changed_by`, `note`, `created_at`. Drives the PO timeline and is the audit trail.

**`manufacturer_payments`** — a payment ledger tracked **separately from PO status**: `type` (`deposit` | `balance` | `additional` | `refund_credit`), `amount`, `payment_date`, `method`, `reference`, `notes`, `created_by`. A trigger rolls the ledger into the PO's `amount_paid` and `balance_due` (refund/credit rows subtract), so a PO always shows total, paid, and remaining regardless of which workflow status it's in. Status like "Deposit Paid" is no longer the source of truth for money — the ledger is.

### 3.6 Orders (Invoices)

**`invoices`** — the heart of the system:

- Identity & parties: `invoice_number` (unique), `client_id`, `client_snapshot` (jsonb), `sales_rep_id`, `sales_rep_name`, `pricing_sheet_id`, `pricing_sheet_name`.
- Status: `draft` | `sent` | `paid` | `partial` | `void`. Plus a reserved `stage` (`order_stage`) that stays NULL in Phase 1 and exists so a future Orders lifecycle (quote → approved_order → invoice → paid → fulfilled → complete) can be layered on without a rename or restructure.
- Customer-facing money (appears on the invoice): `subtotal` (product sales), `shipping` (**customer-paid** shipping revenue — not company freight), `fees` (an explicit customer-charged surcharge), `tax_rate`, `tax_amount`, `total`, `currency`, `fx_rate`.
- Internal-only economics (never shown to a customer): `total_true_cost`, `gross_profit`, `gross_margin`, `total_commission`, `total_expenses`, `net_profit`.
- Payment rollups (maintained by trigger from `payments`): `amount_paid`, `balance_due`.
- Dates: `issue_date`, `due_date`, `sent_at`, `paid_at`. Audit columns.

**`invoice_items`** — `invoice_id`, `product_id` (nullable — a line survives even if a product is later removed), snapshots of `sku`/`product_name`/`strength`/`pack_size`/`manufacturer_name`, `quantity`, `unit_price`, `unit_true_cost`, `price_overridden` (bool), `original_unit_price` (what the sheet said before override), and computed `line_subtotal`/`line_true_cost`/`line_gross_profit`. Plus **optional, nullable lot references** for future traceability — `lot_number`, `manufacturing_date`, `expiration_date`, `retest_date`, `coa_path` — left empty by the Phase 1 builder (this is not inventory management).

### 3.6a Order expenses

**`order_expenses`** — internal costs attached to an order that reduce net profit but are **never** shown on the customer invoice: `type` (`payment_processing_fee` | `outbound_shipping` | `packaging` | `testing` | `referral_expense` | `other`), `amount`, `note`, `incurred_on`, `created_by`. A trigger rolls these into `invoices.total_expenses` and recomputes `net_profit`. Expenses may be recorded *after* an order is sent (e.g. a processing fee realized on payment); the immutability lock guards customer-facing amounts, not these internal roll-ups, so late expenses update net profit without ever touching the frozen invoice total. Company-paid freight is an `outbound_shipping` expense here — deliberately separate from the customer-paid shipping revenue stored on `invoices.shipping`.

**`invoice_status_history`** — same shape and purpose as the PO history table.

Line-level and invoice-level economics are computed by trigger on write (see §6) so the stored totals are always internally consistent and can never be out of step with the lines.

### 3.7 Payments

**`payments`** — `invoice_id`, `amount`, `method` (`cash` | `check` | `wire` | `card` | `ach` | `other`), `reference`, `received_at`, `note`, `created_by`. Inserting or voiding a payment recomputes the parent invoice's `amount_paid`/`balance_due` and auto-advances status among `sent`/`partial`/`paid` (never touching frozen amounts).

### 3.8 Commissions

**`commissions`** — one row per recipient per invoice, so an invoice can split commission across several people, **internal or external**. Columns: `invoice_id`, `recipient_type` (`internal_user` | `external_partner`), `recipient_id → profiles` (**required** for internal users, **NULL** for external partners — no login needed), `recipient_name` (snapshot, required for both), `recipient_email`/`recipient_company`/`payment_notes` (for paying external referral partners), `commission_type` (`percent_of_sale` | `percent_of_gross_profit` | `flat` | `per_unit`), `rate` (the percent, flat dollars, or per-unit amount depending on type), `basis_amount` (the sale or gross-profit figure the percentage was applied to, snapshotted), `units` (for per-unit), `amount` (computed & frozen), `status` (`pending` | `approved` | `paid` | `void`), `approved_by`/`approved_at`/`paid_at`, `note`. A check constraint enforces that internal recipients reference a user and external ones do not. The amount is computed at creation from the invoice's snapshotted economics and then locked with the invoice.

### 3.9 Activity & audit

**`activity_log`** — `actor_id`, `entity_type`, `entity_id`, `action`, `summary`, `metadata` jsonb, `created_at`. Written by triggers on significant events (invoice sent, PO status change, payment recorded, client created). Powers Command Center "Recent Activity" and each client's "Timeline" from a single source.

### 3.10 Insights

Insights adds **no base tables**. Every figure — revenue, gross/net profit, profit by client/product/rep, purchase spend, outstanding invoices, commission reports — is a query over the tables above, delivered through a set of Postgres **views** and RPC functions (`v_revenue_monthly`, `v_profit_by_client`, `v_commission_by_rep`, …). This keeps reporting expandable "for free": a new report is a new view, never a schema change, and because it reads the same immutable snapshots, every report reconciles with every invoice.

---

## 4. Row Level Security

RLS is on for every table. No row is reachable except through a policy. Policies are expressed against three helper functions (in a private `app` schema, `SECURITY DEFINER`, so they don't recurse through RLS):

- `app.role()` → the caller's role from `profiles`
- `app.is_admin()` → true for `owner` or `admin`
- `app.is_staff()` → true for any active employee

The model in plain language:

**Owner** — everything. The only role that can edit `app_settings` and delete records.

**Admin** — full operational read/write across all modules (clients, catalog, pricing, purchasing, orders, commissions), can approve and mark commissions paid, but cannot change company settings or hard-delete.

**Sales Representative** — sees *their book*: clients where they are the assigned rep, invoices where they are the rep (or for their clients), and their own commissions. They can create and edit *draft* invoices and their own clients, read the catalog and pricing, and read purchase orders. They cannot edit costs or pricing sheets, cannot approve or pay commissions, and cannot see other reps' commissions or unrelated clients.

**Reference data** (products, manufacturers, pricing sheets) is readable by all staff and writable only by admin/owner — reps need to read prices to build invoices but must never alter cost or pricing data that feeds profit math.

**Immutability outranks RLS.** Even an owner cannot rewrite a sent invoice's amounts — that is blocked by the locking trigger regardless of role. RLS decides *who can reach a row*; the triggers decide *what may change about it*.

**Portal-ready.** Because reps are already scoped by relationship (`assigned_rep_id`, `client_id`), adding a future `client` role that sees only `invoices` where `client_id = their client` is an additive change: new policies, no restructuring.

The complete policy set is in `supabase/migrations/0080_rls_policies.sql` with one policy block per table and inline comments.

---

## 5. Import, upload & storage

### 5.1 The Excel import pipeline (Catalog & Pricing)

Both catalog and pricing imports follow the same four-stage, preview-before-commit flow so a bad spreadsheet can never silently corrupt live data:

1. **Upload.** The file lands in a private Storage bucket (`imports/`). A row is written to `catalog_import_batches` (or `pricing_import_batches`) with status `pending`.
2. **Parse & preview.** A parser (SheetJS in a Next.js route/Edge Function) maps columns to fields with a tolerant header matcher (`SKU`/`Sku`/`sku #` all resolve). It returns a preview: proposed new rows, detected changes to existing rows, and flagged problems (missing SKU, non-numeric cost, duplicate SKU within the file). Nothing is committed yet; the batch is `previewed`.
3. **Duplicate detection.** Existing records are matched by `sku`. Within-file duplicates are surfaced. Against the database, each row is classified **new**, **unchanged**, or **changed** (e.g. cost moved). The user chooses per-batch how changed rows are handled.
4. **Commit.** On confirm, new products are inserted; changed costs are written as **new `product_cost_history` rows** (never overwrites), which updates the cached `current_true_cost` via trigger; pricing changes journal to `pricing_item_history`. The batch flips to `committed` with a stored summary (counts of inserted/updated/skipped). A failed commit rolls back atomically and marks the batch `failed` with the error.

**Version history** is the batch trail plus the append-only history tables: every import is a durable record of what changed, when, from which file, by whom — and critically, no import ever reaches back into an existing invoice.

### 5.2 Storage buckets

Private Supabase Storage buckets, each guarded by Storage RLS mirroring the table rules:

- `company/` — logo and branding assets for PDFs (owner-writable, staff-readable).
- `imports/` — raw uploaded spreadsheets, retained for audit.
- `po-attachments/` — manufacturer invoices, COAs, packing lists, tracking docs, keyed by PO id.
- `invoice-pdfs/` — generated invoice PDFs.
- `po-pdfs/` — generated purchase-order PDFs.

### 5.3 PDF generation

Branded invoice and PO PDFs are rendered server-side (React-PDF or a headless-Chrome renderer in a Next.js route/Edge Function) from the invoice's **snapshot**, not from live data — so a re-download of a year-old invoice reproduces it exactly. The rendered file is written to the appropriate bucket and linked from the record.

---

## 6. Money & calculation rules

All computation happens in the database via triggers, so totals can never disagree with their line items and cannot be faked by a client.

**Per line (`invoice_items`):**
- `line_subtotal = quantity × unit_price`
- `line_true_cost = quantity × unit_true_cost`
- `line_gross_profit = line_subtotal − line_true_cost`

**Per invoice (`invoices`), recomputed on any line change:**
- `subtotal = Σ line_subtotal`
- `total_true_cost = Σ line_true_cost`
- `tax_amount = round(subtotal × tax_rate, 2)`
- `total = subtotal + shipping + fees + tax_amount` (shipping/fees here are amounts **charged to the customer**)
- `gross_profit = subtotal − total_true_cost` (product sales − true product cost)
- `gross_margin = gross_profit / subtotal` (guarded against divide-by-zero)
- `total_commission = Σ commissions.amount` (non-void) for the invoice
- `total_expenses = Σ order_expenses.amount` (payment processing, company-paid freight, packaging, testing, referral, other)
- `net_profit = gross_profit − total_commission − total_expenses`

Customer-paid shipping revenue (`invoices.shipping`) and company-paid freight (an `outbound_shipping` order expense) are stored and computed **separately** — shipping is never automatically treated as pass-through. Payment-processing fees are an expense, not a customer charge. Nothing in `order_expenses` appears on the customer invoice unless the user separately adds a customer charge via `fees` or a line item.

**Commission amount by type:**
- `percent_of_sale` → `round(subtotal × rate, 2)`
- `percent_of_gross_profit` → `round(gross_profit × rate, 2)`
- `flat` → `rate`
- `per_unit` → `round(units × rate, 2)`

Each commission stores the `basis_amount` it was computed from, so the figure is auditable and immune to later recomputation.

**Rounding:** half-up to 4 decimals internally, presented at 2. Amounts are `numeric`, never float.

**The lock:** once an invoice is `sent`, the trigger forbids changes to `quantity`, `unit_price`, `unit_true_cost`, any total, and to the attached commissions — while still permitting status advancement and payment recording. This is where §2's promise becomes physically true.

---

## 7. Folder structure (target Next.js app)

No app code is written in Phase 1. This is the agreed layout the build will follow.

```
aurum/
├─ app/
│  ├─ (auth)/login/
│  ├─ (app)/
│  │  ├─ command-center/          # KPI dashboard
│  │  ├─ clients/[id]/
│  │  ├─ catalog/
│  │  ├─ pricing/
│  │  ├─ purchasing/[id]/
│  │  ├─ orders/[id]/             # invoices
│  │  ├─ commissions/
│  │  ├─ insights/
│  │  └─ settings/
│  ├─ api/                         # route handlers: imports, PDF, RPC wrappers
│  └─ layout.tsx
├─ components/
│  ├─ ui/                          # shadcn/ui primitives
│  ├─ patterns/                    # KPI card, data table, command palette, searchable select
│  └─ modules/                     # per-domain composed components
├─ lib/
│  ├─ supabase/                    # browser + server + service clients
│  ├─ money/                       # numeric helpers, formatting, calc mirrors
│  ├─ import/                      # SheetJS parsers, column matchers
│  ├─ pdf/                         # invoice & PO templates
│  └─ validators/                  # zod schemas shared client/server
├─ hooks/
├─ types/                          # generated Supabase types + domain types
├─ supabase/
│  ├─ migrations/                  # the SQL in this deliverable
│  └─ seed/                        # settings + enum seed only (no fake business data)
├─ styles/                         # tokens: cream/ivory/navy palette, Geist/Inter
└─ config/
```

Design tokens (the warm-cream/ivory/deep-navy palette, Geist→Inter fallback, thin dividers, generous spacing) live in `styles/` and Tailwind config as the single source of truth, so the "calm, premium, intentional" feel is enforced systematically rather than page by page. Dark mode ships as a token theme from day one.

---

## 8. Implementation roadmap

Each milestone is production-quality and shippable before the next begins. Detail is in `ROADMAP.md`; the sequence:

- **M0 — Foundation.** Apply migrations to a Supabase project, generate types, scaffold Next.js + Tailwind + shadcn/ui, wire the three Supabase clients, build the design-token system and app shell (sidebar, command palette, auth). *Exit: an owner can log in to an empty, beautiful shell.*
- **M1 — Catalog & Manufacturers.** Products, manufacturers, the Excel import pipeline with preview/duplicate-detection, cost history. *Exit: real catalog imported from your spreadsheet.*
- **M2 — Pricing.** Pricing sheets, items, optional tiers, imports, per-client assignment. *Exit: every client has a pricing model.*
- **M3 — Clients.** Client CRUD, rep assignment, detail page with (initially empty) derived panels.
- **M4 — Orders/Invoices.** The core: build invoice → snapshot pricing & cost → live profit math → statuses → branded PDF. *Exit: first real invoice issued.*
- **M5 — Commissions & Payments.** Multi-recipient commissions, approval/paid flow, payments ledger, partial-payment status automation.
- **M6 — Purchasing.** PO workflow, 10-state lifecycle, attachments, branded PO PDF, optional cost-on-receipt.
- **M7 — Command Center & Insights.** KPI cards, reporting views, CSV export.
- **M8 — Polish.** Realtime, keyboard-first refinement, loading states, dark mode QA, RLS penetration review.

Inventory reconciliation, the client portal, and multi-currency UI are explicitly post-Phase-1, and the schema already accommodates all three.

---

## 9. Status

**Approved (v0.2).** The six revisions above are folded into this document, the ERD, and the SQL
migrations, all validated against Postgres 16 (schema applies in order; business rules, immutability,
pricing resolution, PO payments, order expenses, external commissions, and role-based RLS all pass).
Implementation has begun at **M0 — Foundation**.

One modeling note worth confirming as we go: per the approved formula, `net_profit` is computed from
product gross profit minus commissions and order expenses; customer-paid shipping/fees revenue is
billed on the invoice `total` but does not add into `net_profit`. If you later want customer-paid
shipping to offset company freight inside net profit, that's a one-line change to `app.recalc_invoice`.
