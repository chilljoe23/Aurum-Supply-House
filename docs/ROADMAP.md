# Aurum Supply House — Implementation Roadmap

Each milestone is production-quality and independently shippable. No milestone begins until the
previous one is complete and verified. Nothing here is scaffolded with fake data — every module is
wired to real Supabase tables from the start.

## M0 · Foundation
**Goal:** a beautiful empty shell an owner can log into.
- Create Supabase project; apply migrations `0001`–`0090`; generate TypeScript types.
- Scaffold Next.js (App Router) + TypeScript + Tailwind + shadcn/ui.
- Design-token system: warm-cream/ivory/deep-navy palette, Geist→Inter fallback, thin dividers,
  spacing scale, light/dark themes — the single source of the "calm, premium" feel.
- App shell: sidebar (Command Center, Clients, Catalog, Pricing, Purchasing, Orders, Commissions,
  Insights, Settings), top bar, ⌘K command palette, searchable-select and data-table primitives.
- Auth: Supabase email/password login, role-aware routing, profile bootstrap.
**Exit:** owner logs in; navigation works; RLS verified with a seeded owner + rep.

## M1 · Catalog & Manufacturers
- Manufacturer CRUD.
- Product catalog: searchable/filterable table, product detail with cost history timeline.
- Excel import pipeline end-to-end: upload → preview → duplicate detection → commit; append-only
  cost history; ignored-column reporting.
**Exit:** your real catalog is imported from a spreadsheet and searchable instantly.

## M2 · Pricing
- Unlimited pricing sheets; item editor; optional quantity tiers.
- Pricing import (reuses M1 pipeline).
- Assign a pricing model to clients (default sheet supported).
- Customer-specific SKU price overrides (`client_price_overrides`) and the `app.resolve_price`
  resolver (override → assigned → default → manual).
**Exit:** every product has prices under one or more sheets; per-client overrides resolve correctly;
changes journal to history.

## M3 · Clients
- Client CRUD, rep assignment, billing/shipping addresses, payment terms, status.
- Client detail page with derived panels (Invoices, Purchase History, Profit Generated, Commission
  Paid, Products Purchased, Timeline) — empty until M4 produces invoices.
**Exit:** clients exist, each with an assigned rep and pricing model.

## M4 · Orders / Invoices  ← the core
- Invoice builder: select client → resolve price per line via `app.resolve_price` (override →
  assigned → default → manual) → set quantity → live subtotal/shipping/fees/tax/total.
- Order expenses (processing fee, company-paid freight, packaging, testing, referral, other) feeding
  net profit — never shown on the customer invoice.
- Internal economics panel: true cost, gross profit, gross margin, expenses, commission, net profit
  (staff-only).
- Snapshotting on create; status workflow (draft→sent→paid/partial/void) with the immutability lock.
  Reserved `stage` left NULL. Optional lot fields present but not surfaced in the builder.
- Branded PDF invoice from snapshot.
**Exit:** first real invoice issued, downloadable as a branded PDF, provably immutable once sent, with
net profit correctly net of expenses and commissions.

## M5 · Commissions & Payments
- Multi-recipient commissions per invoice — **internal users and external referral partners** (external
  payees need no login; name/email/company/payment-notes captured); all four types; approve/paid/void.
- Customer payments ledger; partial-payment status automation; outstanding-balance math.
- Commission dashboard: owed, paid, by rep/partner, by month.
**Exit:** commissions compute from frozen invoice economics; internal and external payees supported;
payments drive status automatically.

## M6 · Purchasing
- Manufacturer PO builder: select manufacturer → search product → quantity → auto true cost →
  totals → branded PO PDF.
- 10-state lifecycle with status history; attachments (manufacturer invoice, COA, packing list,
  tracking); optional cost-on-receipt feeding catalog cost history.
- **Manufacturer payment ledger** (deposit / balance / additional / refund_credit) tracked separately
  from status; PO shows total, amount paid, remaining balance.
**Exit:** POs created, tracked through their lifecycle, with documents attached and payments reconciled
independently of workflow status.

## M7 · Command Center & Insights
- KPI cards: revenue, gross/net profit, outstanding invoices, commission owed, open POs, top
  customers, top products, monthly sales, recent activity.
- Insights reports from the SQL views; CSV export; profit by client/product/rep; purchase spend.
**Exit:** everything glanceable; reports reconcile exactly with invoices.

## M8 · Polish & Hardening
- Realtime where it helps (activity feed, KPI refresh).
- Keyboard-first refinement, tasteful loading/skeleton states, empty states.
- Dark-mode QA; responsive passes.
- RLS penetration review (rep cannot reach another rep's book; immutability cannot be bypassed).
- Backups/PITR confirmation.

## Explicitly deferred (schema already supports)
- Inventory / on-hand stock reconciliation.
- Customer-facing client portal (add a `client` role + scoped policies).
- Multi-currency UI (columns already present).

## Verification discipline (every milestone)
- SQL migrations parse and apply cleanly against a fresh database.
- RLS tested from each role with automated checks.
- Money math cross-checked with unit tests (line → invoice → commission → net profit).
- Immutability tests: sent invoices reject financial edits; costs/prices never rewrite invoices.
