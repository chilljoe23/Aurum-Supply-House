# M7 — Command Center & Insights reporting reference

Everything the reporting layer computes, where it comes from, and who may see it.
All figures read the **frozen invoice/line snapshots** — never recomputed from
current catalog cost or current pricing.

## Data sources (all row-scoped & column-masked at the DB)

| Surface | Used for | Scope / masking |
|---|---|---|
| `v_orders` | revenue, GP, net profit, receivables inputs | rep = own book; GP/net/margin/cost masked to admin |
| `v_report_order_lines` *(new, 0390)* | sales/profit by product | rep = own book; line cost/GP masked to admin |
| `v_quotes` | quote activity & conversion | rep = own book |
| `v_ar_aging` / `v_ar_summary` | outstanding & overdue | rep = own book; no cost columns |
| `v_commissions` / `v_commission_summary` | commission owed/paid | rep = own recipient rows; invoice GP masked |
| `v_purchase_orders` | open POs by stage | **admin-only** (reps: 0 rows) |
| `v_manufacturer_payments` | manufacturer spend (cash) | **admin-only** (reps: 0 rows) |
| `report_recent_activity()` *(new, 0390)* | recent activity | rep = own book (definer-scoped) |

## Reporting formulas & exclusions (exact)

**Earned set (revenue-bearing):** `status ∈ {sent, partial, paid}`. `draft` and
`void` are **excluded** (void retains its frozen totals, so it must be filtered by
status, not by a zero amount).

- **Revenue** = `Σ invoices.total` over the earned set. `total = (subtotal −
  discount) + shipping + fees + tax_amount`, i.e. **includes customer-paid
  shipping and fees and tax** (matches the frozen invoice total and the AR
  balance). Company-paid freight is **not** here — it lives in `order_expenses`.
- **Net product sales** = `subtotal − discount` (basis for GP; excludes shipping,
  fees, tax).
- **Gross profit** = `Σ invoices.gross_profit` = `Σ (net_sales − total_true_cost)`.
  Excludes shipping/fees/tax. **Admin-only** (NULL for reps).
- **Net profit** = `Σ invoices.net_profit` = `Σ (gross_profit − total_commission −
  total_expenses)`. **Admin-only** (NULL for reps).
- **Product revenue** = `Σ invoice_items.line_subtotal` (frozen, pre header-level
  discount); **product gross profit** = `Σ line_gross_profit` (admin-only). Matches
  the existing `v_profit_by_product` definition.
- **Outstanding receivables** = `Σ balance_due` where `status ∈ {sent, partial}`
  and `balance_due > 0`.
- **Overdue receivables** = `Σ balance_due` where `aging_bucket ≠ current`
  (due date < today).
- **Commission owed** = `Σ amount` where `status ∈ {earned, approved}`
  (not `pending`, not `paid`). **Commission paid** = `Σ amount` where
  `status = paid`; **paid MTD** filters `paid_at ≥ date_trunc('month', now())`.
- **Manufacturer spend:** *committed* = `Σ purchase_orders.total` over non-void
  POs by manufacturer; *paid (cash)* = `Σ signed_amount` from
  `v_manufacturer_payments` (a `refund_credit` is negated, so refunds net out).
- **Open purchase orders** = `status ∉ {draft, closed, void}`; "by stage" groups
  the open set by `po_status`.
- **Quote conversion rate** = `converted ÷ (quotes that ever left draft)` =
  `count(status='converted') ÷ count(status ≠ 'draft')`.

**No double-counting:** payments, manufacturer payments and commissions are each
recomputed from their ledgers (voided rows excluded, refunds netted) by DB
triggers — the reports sum the already-reconciled frozen columns, never the raw
ledgers. Partial payments are reflected in `amount_paid` / `balance_due`.

**Currency:** each invoice carries its own `currency` (default USD). Aggregates
assume a single reporting currency (USD), consistent with the app default and the
existing Command Center; figures are formatted with the row's own currency. Mixed-
currency books should be read per currency (FX normalization is out of M7 scope).

## Permission matrix

| Metric / report | Owner | Admin | Sales Rep |
|---|---|---|---|
| Revenue (own book for rep) | ✅ all | ✅ all | ✅ own book |
| Gross profit / Net profit | ✅ | ✅ | ❌ NULL (masked) |
| Sales by client / product / rep (revenue) | ✅ all | ✅ all | ✅ own book |
| Profit by client / product / rep | ✅ | ✅ | ❌ masked |
| Outstanding / overdue receivables | ✅ all | ✅ all | ✅ own book |
| Commission owed / paid | ✅ all | ✅ all | ✅ own only |
| Manufacturer spend | ✅ | ✅ | ❌ 0 rows |
| Open POs by stage | ✅ | ✅ | ❌ 0 rows |
| Quote activity & conversion | ✅ all | ✅ all | ✅ own book |
| Top clients / products | ✅ (rev+profit) | ✅ | ✅ revenue only |
| Recent activity | ✅ all | ✅ all | ✅ own book |
| True cost / margin / internal expenses | ✅ | ✅ | ❌ never |
| Settings | ✅ | ❌ | ❌ |

Enforced twice: DB (masked views + admin-only tables + definer RPCs) **and** UI
(`canSeeInternal` hides profit columns and admin-only reports).

> **Owner-only launch note.** This matrix describes the full role model, which
> stays enforced at the DB at all times. The initial launch has a single Owner
> user and hides the **Sales Rep** UI behind `SALES_REPS_ENABLED = false`
> (`src/lib/launch.ts`); the "Sales Rep" column becomes relevant when that flag is
> turned on post-launch. See §0 of `docs/M7_LAUNCH_READINESS.md`.

## New additive migrations, views, functions

- **`0390_m7_reporting.sql`** —
  - `v_report_order_lines` (view): per-line sales joined to its invoice; row-scoped
    like `v_orders`; masks `line_true_cost` / `line_gross_profit` to admins.
  - `report_recent_activity(p_limit)` (SECURITY DEFINER function): rep-safe
    activity feed (admins company-wide; reps own book).
- **`0391_m7_reporting_hardening.sql`** — recreates the seven legacy `0075`
  insights views `WITH (security_invoker = true)` (security fix; see launch doc §3).

No base tables, columns, RPCs, historical figures, or existing views' semantics
were changed. Migrations were **not applied** (per instruction).

## Routes & components added / changed

- `src/app/(app)/insights/page.tsx` — placeholder → real server page
  (`getInsightsData` → `InsightsManager`).
- `src/components/insights/insights-manager.tsx` *(new)* — filters (date range,
  client, product, rep, manufacturer, status, granularity), report selector,
  KPI tiles, sortable/paginated `DataTable`, CSV export per report, empty states.
- `src/lib/insights/{calculations,types,queries}.ts` *(new)* — pure reporting math
  (unit-tested), shared types, server loaders (masked views + RPC).
- `src/app/(app)/command-center/page.tsx` — real metric grid for both roles +
  Insights entry points.
- `src/lib/dashboard/queries.ts` — full metric set (revenue/GP/net MTD, receivables,
  commissions owed/paid, active clients, quotes + conversion, open POs, manufacturer
  spend); recent activity switched to the rep-safe `report_recent_activity` RPC.
- **Unchanged:** all Invoice/Quote/PO PDF routes, document components, view models,
  branding, and existing migrations.

## Manual click-through checklist

Log in as **Owner/Admin**:
- [ ] Command Center shows Revenue, Gross & Net Profit, receivables, commissions,
      open POs, manufacturer spend, quote counts + conversion, recent activity.
- [ ] Insights → each report renders; date-range + client/product/rep/manufacturer/
      status filters change the numbers; KPIs reconcile with tables.
- [ ] Export CSV on 2–3 reports; open the files — profit columns present.
- [ ] Download one **Invoice**, one **Quote**, one **PO** PDF → `200`, correct
      content, no internal figures on the customer documents.

Log in as **Sales Rep**:
- [ ] Command Center shows revenue/receivables/commissions for **their book only**,
      **no** Gross/Net Profit, **no** manufacturer spend / open POs.
- [ ] Insights shows no "Purchase spend" / "Open POs" reports; profit columns are
      absent from every table and every CSV export.
- [ ] Only their own clients/products/reps appear in filters; recent activity shows
      only their book.
- [ ] Requesting another rep's invoice/quote PDF by id → `404`.

Responsive:
- [ ] At 375px width the report selector and filter bar wrap; tables scroll
      horizontally; nothing overflows the viewport.
