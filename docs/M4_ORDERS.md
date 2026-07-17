# M4 — Orders, Invoices & Invoice Template

The core transactional module. An authorized user builds an order for an active
client, prices resolve automatically through `app.resolve_price`, financial
snapshots persist, drafts are editable, invoices issue with an immutable lock,
customer payments drive status, and a branded invoice renders identically on
screen and as a US-Letter PDF.

M4 is **additive**: the M0 schema already defined `invoices`, `invoice_items`,
`payments`, `order_expenses`, `commissions`, the recalc/immutability triggers,
activity logging, and concurrency-safe numbering. M4 adds the order RPCs, the
discount + settings columns, the Aurum numbering format, the masked read
surfaces, and the entire app layer.

## Additive migrations (0180–0210)

| File | What it adds |
|------|--------------|
| `0180_m4_settings_numbering.sql` | `app_settings` columns (`invoice_number_prefix` default `AUR`, `payment_instructions`, `remittance_details`, `invoice_terms`, `invoice_footer`); `invoices.discount`; the `invoice_aur` sequence (seeded 1001); `app.next_invoice_number()` → `AUR-1001…` |
| `0190_m4_recalc_discount.sql` | `CREATE OR REPLACE app.recalc_invoice` folding discount into the math; extends the immutability lock + header-recalc trigger for `discount` (discount = 0 reproduces pre-M4 results exactly) |
| `0200_m4_order_rpcs.sql` | `invoice_items` per-line snapshot columns (`price_source`, `price_source_sheet`, `manual_reason`); transactional RPCs `save_order_draft`, `issue_invoice`, `record_payment`, `void_invoice`, `add_order_expense`, `delete_order_expense`, `delete_draft`; the status-transition permission guard + overpayment guard triggers |
| `0210_m4_masking_rls.sql` | Locks `invoices`/`invoice_items`/`order_expenses` base SELECT to admins; adds row-scoped, column-masked views `v_orders` + `v_order_items`; mirrors non-sensitive order lifecycle events onto client timelines |

All order mutations flow through the SECURITY DEFINER RPCs, so permissions,
snapshots, price resolution, and money math are enforced at the DB — never
trusted from the client. Each RPC is a single transaction: any failure rolls the
whole order back (atomic create).

## Routes & components

**Routes**
- `/orders` — searchable/sortable/paginated list with filters (status, client,
  rep, pricing model, paid/unpaid, date range). Gross profit + margin columns for
  Owner/Admin only.
- `/orders/new` — order builder.
- `/orders/[id]` — premium detail: line items, pricing-resolution info, financial
  summary, payment history, internal expenses (admin), status timeline, audit
  history, and actions.
- `/orders/[id]/edit` — edit a draft (redirects to detail if not a draft).
- `/orders/[id]/invoice` — browser preview + print/PDF.

**Library** (`src/lib/orders/`)
- `calculations.ts` — pure, fixed-precision money math mirroring `app.recalc_invoice` (integer ten-thousandths, half-up rounding) for live UI preview only.
- `schemas.ts` — Zod schemas for draft/line/payment/void/expense/issue.
- `queries.ts` — server reads through the masked views + builder inputs + the invoice view model.
- `invoice-view-model.ts` — the normalized, **customer-facing-only** invoice shape shared by preview and PDF.

**Components** (`src/components/orders/`)
- `order-builder.tsx`, `orders-manager.tsx`, `order-actions.tsx` (issue/payment/void/discard dialogs), `expense-manager.tsx`, `invoice-document.tsx` (branded template), `print-button.tsx`, `status-badge.tsx`.
- `src/components/settings/company-settings-form.tsx` + `/settings` now edits company profile, invoicing defaults, and **payment instructions (sourced from settings, owner-editable)**.

**Server actions**: `src/app/(app)/orders/actions.ts`, `src/app/(app)/settings/actions.ts`.

## Exact calculation rules

All persisted money is fixed-precision `numeric(14,4)`; rounding is half-up via
`app.money_round`. The database is the source of truth (`app.recalc_invoice`);
`calculations.ts` mirrors it exactly for preview.

```
line_subtotal   = round(quantity × unit_price, 4)
line_true_cost  = round(quantity × unit_true_cost, 4)     -- snapshotted at save
subtotal        = Σ line_subtotal
total_true_cost = Σ line_true_cost
discount        = min(discount, subtotal)                 -- clamped, never negative
net_sales       = subtotal − discount
tax_amount      = round(net_sales × tax_rate, 2)
total           = net_sales + shipping + fees + tax_amount
gross_profit    = net_sales − total_true_cost             -- customer shipping/fees excluded
gross_margin    = gross_profit / net_sales                (0 if net_sales = 0)
total_expenses  = Σ order_expenses                         -- internal only
net_profit      = gross_profit − total_commission − total_expenses
balance_due     = total − amount_paid
```

- **Customer-paid shipping** (`invoices.shipping`) is revenue inside `total`.
  **Company-paid freight** is an internal `order_expense` (`outbound_shipping`)
  that reduces `net_profit` and never appears on the invoice — the two are
  deliberately separate.
- Historical orders never change: costs, prices, models, clients and commission
  rules changing later do not touch an issued invoice (everything is snapshotted;
  the DB immutability lock rejects financial edits once out of draft).

## Permissions

| Capability | Owner/Admin | Sales rep |
|---|---|---|
| View orders | all | own book only (own orders / own clients) |
| Create & edit drafts | ✓ | ✓ (own clients only; can't reassign the rep) |
| See true cost / GP / margin / net / internal expenses | ✓ | **never** (NULL at the DB via `v_orders`/`v_order_items`) |
| Manual price override | ✓ (reason required) | **blocked** (RPC raises 42501) |
| Issue invoice | ✓ | blocked |
| Record payment | ✓ | blocked |
| Void invoice | ✓ (reason required) | blocked |
| Manage internal expenses | ✓ | blocked |
| Edit company settings | Owner only | — |

Enforced in RLS (base tables admin-only), masked views, SECURITY DEFINER RPCs, a
status-transition guard trigger, server actions, and the customer PDF/view model
(which structurally omits every internal field) — not only in the UI.

## Numbering

`app.next_invoice_number()` allocates `AUR-1001`, `AUR-1002`, … from the
`invoice_aur` document sequence under a row lock (concurrency-safe). Drafts carry
a throwaway `DRAFT-…` identifier and only receive a real AUR number at issue, so
numbers are never wasted on abandoned drafts and voided numbers are never reused
(the counter is monotonic). The prefix is configurable in Settings.

## Invoice template / PDF

`InvoiceDocument` renders the normalized `invoiceViewModel`. The **same**
component powers the on-screen preview and the printable output, so they cannot
drift. "Download PDF" uses the browser's print-to-PDF against a US-Letter
`@page` layout, isolated from the app shell via print CSS — no new dependencies
(keeps `npm audit` clean). The document is warm-ivory/navy/sage with a white body
and light backgrounds so it prints cleanly in grayscale. Branding is modular
(colors + layout live only in `invoice-document.tsx`), and the view model is
decoupled so a future `@react-pdf` renderer can drop in without touching order
logic.

## Tests

`supabase/tests/m4_orders.sql` (non-destructive, `ROLLBACK`, `ASSERT`-driven):
client/rep scoping, resolution priority + tiers + client override, manual
override (reason + admin gate), money math, customer-shipping-vs-freight, draft
editing, AUR numbering (monotonic, no reuse), issued immutability + cost/price
snapshot preservation, partial/full/invalid/over payments, void behavior,
owner/admin vs rep permissions, rep isolation, cost/profit masking, and atomic
rollback on a failed create. Run with:

```
psql "$DATABASE_URL" -f supabase/tests/m4_orders.sql
```

Requires the migrations applied to a scratch/live database (no local Postgres in
this workspace, so the suite was authored but not executed here).
