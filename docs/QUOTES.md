# Quotes — Customer-Facing Quoting Module

The complete customer-facing Quotes module, built additively on the approved
M0–M6 schema, security, and design system. A staff member builds a quote for an
active client; prices resolve server-side through the same `app.resolve_price`
brain the Order builder uses; the quote is snapshotted, sent under a monotonic
`QTE-####` number, moves through a DB-enforced lifecycle, prints on an
Aurum-branded document, and — once accepted — converts atomically into a **draft
order** that snapshots the current true cost. A quote never stores or exposes cost,
profit, margin, commission, or internal expense.

Nothing in migrations `0001–0370` was modified. All new objects are additive and
begin at `0380`.

---

## What was built

- **Navigation + `/quotes` list** — search, sortable columns, pagination, CSV
  export, and filters for status, client, representative, pricing model, quote
  date range, and expiration. Columns: number, client, representative, quote date,
  expiration, status, total, last updated.
- **`/quotes/new` + `/quotes/[id]/edit` builder** — pick an authorized client, load
  its assigned pricing model (or select another authorized model), search the
  active catalog, add products, enter quantity, and see the server-resolved unit
  price with its resolution source shown internally. Authorized manual overrides
  (Owner/Admin) require a reason. Quote date, expiration, payment terms, customer
  reference, notes, shipping, fees, discount, tax, subtotal, and total are all
  supported. An unresolved line is blocked, never silently zero.
- **`/quotes/[id]` detail** — status + number, client & addresses, line items with
  pricing-source diagnostics (internal), financial summary, expiration info, status
  timeline, audit history, the linked order when converted, and the full action set.
- **`/quotes/[id]/document`** — a customer-facing browser preview + print-to-PDF
  quote sharing the approved Invoice/PO visual language (white page, cream accents,
  deep-navy type, muted-sage labels, Aurum brand, US Letter, grayscale-safe,
  repeating column headings, long-name/long-description safe, customer acceptance
  area). Displays **no** cost, profit, margin, commission, diagnostics, or internal
  notes.
- **Quote → order conversion** — transactional, idempotent, one-order-per-quote.
- **Duplication** — into a fresh draft, re-resolving by default or retaining quoted
  prices, never mutating the original, never reusing the number.
- **Client integration** — a Quotes history panel on the client detail page and
  quote lifecycle events on the client timeline (non-sensitive metadata only).
- **Settings** — owner-configurable quote number prefix, default validity window,
  default quote terms, and quote footer/disclaimer.

---

## Additive migrations

| File | Purpose |
|------|---------|
| `0380_quotes_enums_settings.sql` | `quote_status` enum; `app_settings` quote fields (`quote_number_prefix`, `quote_terms`, `quote_footer`, `quote_expiration_days`); `quote_aur` sequence (start 1001); `app.next_quote_number()`. |
| `0381_quotes_schema.sql` | `quotes`, `quote_items`, `quote_status_history`; order↔quote link columns on `invoices` (+ unique index); money math (`app.recalc_quote`); lifecycle state machine; sent-quote immutability locks; status-history log; activity + client-timeline triggers; `app.can_access_quote()`. |
| `0382_quotes_rpcs.sql` | `save_quote_draft`, `send_quote`, `transition_quote_status`, `void_quote`, `duplicate_quote`, `convert_quote_to_order`, `expire_quotes`, `delete_quote_draft` (each `app.*` definer + permission-checked `public.*` wrapper). |
| `0383_quotes_views.sql` | Row-scoped, security-barrier staff surfaces `v_quotes`, `v_quote_items`. |
| `0384_quotes_rls.sql` | Admin-only base-table RLS + rep read of `quote_status_history`; privileges. |

### Objects created

- **Tables:** `public.quotes`, `public.quote_items`, `public.quote_status_history`.
- **Columns added (additive, existing tables):** `invoices.source_quote_id`,
  `invoices.source_quote_number` (+ partial unique index `uq_invoices_source_quote`);
  `app_settings.quote_number_prefix`, `.quote_terms`, `.quote_footer`,
  `.quote_expiration_days`.
- **Enum:** `quote_status` (`draft, sent, accepted, declined, expired, converted, void`).
- **Views:** `public.v_quotes`, `public.v_quote_items`.
- **Functions (app.\*):** `next_quote_number`, `recalc_quote`,
  `trg_recalc_quote_from_items`, `trg_recalc_quote_from_header`,
  `enforce_quote_transition`, `enforce_quote_lock`, `enforce_quote_items_lock`,
  `log_quote_status`, `trg_activity_quote`, `trg_client_activity_from_quote`,
  `can_access_quote`, `save_quote_draft`, `send_quote`, `transition_quote_status`,
  `void_quote`, `duplicate_quote`, `convert_quote_to_order`, `expire_quotes`.
- **Functions (public.\* wrappers):** `save_quote_draft`, `send_quote`,
  `transition_quote_status`, `void_quote`, `duplicate_quote`,
  `convert_quote_to_order`, `expire_quotes`, `delete_quote_draft`.
- **Triggers on `quotes`:** touch, header recalc, transition state machine,
  immutability lock, status log, activity feed, client timeline.
  **On `quote_items`:** header recalc, items lock.
- **Sequence key:** `document_sequences('quote_aur')`.

---

## Exact lifecycle

```
draft ──▶ sent ──▶ accepted ──▶ converted   (happy path)
  │         ├──▶ declined                    (terminal)
  │         └──▶ expired                      (terminal)
  └──▶ void   sent ──▶ void                   (terminal)
```

- **draft** — fully editable via `save_quote_draft` (replaces lines wholesale).
- **sent** — customer-facing financial fields, parties, dates, and number are frozen
  (immutability lock); the quote may be accepted, declined, expired, or voided.
- **accepted** — the only forward move is `convert_quote_to_order`.
- **declined / expired / converted / void** — terminal; no further status change.
- Every transition writes an actor, timestamp, prior status, new status, and an
  optional reason to `quote_status_history`. Illegal transitions raise `23514` at
  the DB layer (`app.enforce_quote_transition`).
- **Expiration is deterministic:** `expire_quotes()` sweeps `sent` quotes whose
  `expiration_date < current_date` to `expired`; the list/detail also compute a live
  `is_expired` flag. Expiration is set at draft time and frozen once sent.

### Numbering

`QTE-####` (prefix owner-configurable). Allocated only at **send** via
`app.next_quote_number()` — a row-locked, monotonic counter that starts at 1001,
never reuses a retired number, and is safe under concurrent sends. Drafts carry a
throwaway `QDRAFT-…` identity and consume no number.

---

## Exact conversion behavior

`convert_quote_to_order(quote)`:

1. Requires the quote to be **accepted** (else it raises and the whole transaction
   rolls back — no partial order).
2. **Idempotent:** if the quote already links to an order (or an order already
   references the quote — enforced by `uq_invoices_source_quote`), the existing
   order id is returned. Concurrent double-submit is caught via `unique_violation`.
3. Creates a **draft** order (`DRAFT-…` number — no AUR invoice number consumed),
   copying the client snapshot (incl. terms + billing/shipping addresses),
   representative, pricing model, currency, shipping, fees, discount, tax rate, and
   notes.
4. For each line: preserves the **quoted selling price**, marks the order line
   `price_source = 'quote'`, and snapshots the **current** `products.current_true_cost`
   (order rules) — never a quote cost (a quote has none). `app.recalc_invoice`
   recomputes internal profitability from that cost snapshot.
5. Stores both link directions: `quotes.converted_order_id` and
   `invoices.source_quote_id` / `.source_quote_number`.
6. Marks the quote **converted** only after the order and all lines succeed.
7. Does **not** issue the invoice — the order stays a draft for normal issuing.

### Duplication

`duplicate_quote(quote, retain_prices)` creates a new **draft** with a new
`QDRAFT-…` identity: re-resolves each line against current pricing by default, or
(when `retain_prices`) keeps the quoted selling price marked `quote_retained`. If a
re-resolve finds no current price, the prior real price is retained (never zeroed).
The original quote is never mutated. The builder re-opens the draft with live
resolution so any difference from the original resolved price is visible.

---

## Permission matrix

| Action | Owner | Admin | Sales Rep |
|--------|:-----:|:-----:|:---------:|
| View quotes | all | all | own book only (own quotes / clients in book) |
| Create / edit **own** draft | ✅ | ✅ | ✅ (own-book clients only) |
| Manual price override (+ reason) | ✅ | ✅ | ❌ |
| Send (allocate number) | ✅ | ✅ | ❌ |
| Accept / Decline / Mark expired | ✅ | ✅ | ❌ |
| Void (reason required) | ✅ | ✅ | ❌ |
| Duplicate | ✅ | ✅ | ✅ (own book) |
| Convert to order | ✅ | ✅ | ✅ (own book — follows Order permissions) |
| Delete draft | ✅ (any) | ✅ (any) | ✅ (own draft) |
| Expire sweep | ✅ | ✅ | ❌ |
| Assign another representative | ❌ (rep is derived from the client) | — | ❌ |
| See cost / profit / margin / commission / expense | n/a — **quotes store none** | n/a | ❌ |

Enforcement is at the **database** layer: base tables are admin-only (RLS); reps
read only through the row-scoped `v_quotes` / `v_quote_items` security-barrier views
and mutate only through the SECURITY DEFINER RPCs — never a direct table write. A rep
can never flip a status, edit a frozen financial field, apply an override, or read
another rep's quote. There is no cost column anywhere in the module to leak.

---

## Tests

`supabase/tests/quotes.sql` — transaction-wrapped, rollback-safe, ASSERT-driven,
runs through the real public RPCs and masked views from each role. Covers: draft
creation; assigned-model, explicit-model, tier, and client-override pricing;
unresolved-price rejection; rep scoping and isolation; authorized manual pricing
(admin-only + reason) and its snapshot; customer money math (discount → net_sales →
tax → total); snapshot preservation across a later price change; draft editing
(replace, not append); `QTE` numbering (monotonic, drafts don't consume, no reuse);
valid + invalid lifecycle transitions; deterministic expiration sweep; sent-quote
financial immutability; owner/admin vs rep permissions; **cost/profit non-exposure**
(asserts the quote tables and views contain zero cost/profit/margin/commission/
expense columns); duplication (re-resolve + retain, original immutable, new number);
atomic + idempotent quote→order conversion; double-conversion prevention;
quote-derived price preservation; current-cost snapshot at conversion; conversion
abort/rollback on a non-accepted quote; and non-sensitive client-timeline events.

**Result:** not yet executed here — the suite requires a database with the new
migrations applied, which per the handoff instructions has **not** been done. Run it
with the command in *Exact commands* below; every ASSERT passes silently and the
final `\echo` prints on success (any regression aborts loudly).

---

## Manual click-through checklist

1. **Settings** (Owner) → set a Quote prefix, default validity days, quote terms and
   footer; save.
2. **Quotes → New quote** → pick a client; confirm the assigned model loads; add a
   product; confirm the unit price resolves with a source badge; add a second line
   with an unresolvable product and confirm Save is blocked.
3. (Admin) toggle **Override price** on a line, enter a price with **no** reason →
   blocked; add a reason → saves; confirm the detail shows "overridden (was …)".
4. Set quote date, expiration, terms, customer reference, shipping/fees/discount/tax;
   confirm the summary total matches the detail after save.
5. **Preview quote** → confirm the document shows QUOTE, number, status, dates,
   terms, Bill/Ship to, lines, totals, notes, acceptance area, and footer — and shows
   **no** cost/profit/source. Print to PDF; confirm one clean US-Letter page.
6. **Send** → confirm a `QTE-####` number is allocated and financial fields lock.
7. **Accept** → **Convert to order** → confirm a draft order opens with the quoted
   prices, `price_source = quote`, and (Admin) internal profit from the current cost;
   confirm the invoice is **not** issued.
8. Return to the quote → confirm status **Converted** and the linked order; click
   **Convert** is replaced by **View order**; a second convert attempt is prevented.
9. **Duplicate** a quote (both re-resolve and retain) → confirm a new draft with a
   new number and the original unchanged.
10. **Decline** / **Void** (reason) another sent quote; set a past expiration on a new
    draft, send, and confirm it reads as expired (and the sweep expires it).
11. **Client detail** → confirm the Quotes panel and the timeline show the events.
12. **Sales rep login** → confirm only own-book quotes are visible, no override/send/
    accept controls, and no cost/profit anywhere.
13. **CSV export** from the list → confirm the file matches the current filters.

---

## Known limitations

- **Regenerated types not committed.** The new tables/views/RPCs and the four new
  `app_settings` columns are not yet in `src/types/database.types.ts`, so quote reads/
  writes (and the settings read/write) go through the existing loosely-typed client
  (`createUntypedClient`) — the same convention M5/M6 used pre-regeneration. Runtime
  behavior is identical; only compile-time relation typing is relaxed. Regenerate
  after applying migrations to restore full typing (see below).
- **Expiration is frozen once sent** (for determinism). Extending a sent quote's
  validity is not supported; duplicate into a new draft instead.
- **Duplicate price-difference warning** is surfaced live in the builder on re-open
  (source badges + resolved price), not as a one-shot diff dialog.
- The expiration sweep is **on-demand** (`expire_quotes()` / an Admin action). No cron
  is wired; schedule it externally if you want passive expiry.
- Order-side display of the source quote is intentionally omitted from the approved
  M4 order views to avoid touching approved surfaces; the link is stored on
  `invoices` and shown from the quote side.

---

## Exact commands to run next

```bash
# 1. Apply the new migrations to your database (review first).
supabase db push          # or your migration runner of choice

# 2. Regenerate types so the quote objects are fully typed (optional but recommended;
#    the app already compiles without this via the loosely-typed client).
npm run gen:types

# 3. Run the rollback-safe test suite (non-destructive; wraps BEGIN…ROLLBACK).
psql "$DATABASE_URL" -f supabase/tests/quotes.sql

# 4. Re-verify.
npm run typecheck && npm run lint && npm run build && npm audit
```

Local verification already run in this branch: `npm run typecheck` ✓,
`npm run lint` ✓, `npm run build` ✓ (all quote routes present), `npm audit` → **0
vulnerabilities**.

---

## M7 launch-readiness recommendation

The Quotes module is feature-complete and internally consistent with the approved
architecture. Before an M7 launch: (1) apply the migrations and run
`supabase/tests/quotes.sql` — treat a green run as the gate; (2) regenerate and commit
`database.types.ts`, then re-run typecheck/build; (3) do the manual click-through as
both an Admin and a Sales Rep, paying special attention to rep isolation and the
absence of any cost/profit on the quote document; (4) decide whether to schedule the
expiration sweep. No approved Invoice or Purchase Order behavior, calculation,
permission, or document layout was changed — the additive columns on `invoices` are
NULL for all existing rows and untouched by the approved order views.
