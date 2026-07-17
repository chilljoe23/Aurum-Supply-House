# M7 test suite

Two layers, matching what can be proven where.

## 1. Pure-logic unit tests — always green, no database

Node's built-in test runner (`node:test`) + TypeScript type-stripping. **Zero new
dependencies** (keeps `npm audit` at 0 vulnerabilities).

```bash
npm test
```

Covers (`tests/insights/*.test.ts`):

- Currency-safe money math — `numeric`-as-string parsing, no float drift, no
  string concatenation (`toMoney`, `roundMoney`, `sumMoney`).
- **Cost/profit masking** — `maskedSum` returns `null` (unknown), never a
  misleading `0`, when any row is masked (the rep case). This is the unit-level
  proof that reps never receive a fabricated profit figure.
- Revenue / gross / net profit over time, group-aggregates, top-N.
- Quote conversion rate (converted ÷ post-draft), date-range filtering, period
  bucketing.
- **CSV export safety** — RFC-4180 escaping, and that a rep column set never
  contains profit columns (the exact shape the Insights manager builds).

## 2. Adversarial RLS / reporting tests — require a migrated database

RLS, row-scoping and column masking are database guarantees, so these run against
a real Postgres with all migrations (`0001`–`0391`) applied:

```bash
supabase db reset
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m7_security_assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m7_reporting_rls_behavioral.sql
```

- **`m7_security_assertions.sql`** (no fixtures) — structural proof that the
  masking `CASE app.is_admin()` guards, the `security_invoker=true` hardening of
  the legacy insights views, the admin-only base-table policies, the definer +
  rep-scoped activity RPC, and the `anon`-denied grants are all actually present.
  Restricted fields cannot be reached via **dashboard views, insights views,
  RPCs, joins, or direct base-table access** — each raises if the guarantee is
  missing.

  > **Whitespace note:** `pg_get_viewdef(..., true)` pretty-prints every `CASE`
  > across multiple indented lines, so the masking checks first collapse whitespace
  > (`regexp_replace(def, '\s+', ' ', 'g')`) before the substring match — otherwise a
  > single-space pattern could never match a correctly-masked view. A companion
  > runtime proof lives in
  > **`sql-editor/m7_v_orders_masking_diagnostic.sql`**: it impersonates an owner and
  > a sales rep (same `request.jwt.claims` mechanism) and prints a side-by-side proof
  > that the owner sees real economics while the rep gets `NULL` on all six internal
  > fields — proving the live *behavior*, not just the definition text.

- **`m7_reporting_rls_behavioral.sql`** (fixtures + impersonation, rolled back) —
  creates two reps with separate books and an admin, then switches `auth.uid()`
  identity to prove at runtime: a rep sees only their own order; `gross_profit` /
  `net_profit` / line cost are `NULL` for reps on every surface; the cost-bearing
  base tables (`invoices`, `invoice_items`, `commissions`, `order_expenses`,
  `purchase_orders`) return **zero rows** to a rep; the PO/manufacturer surfaces
  return zero rows; the hardened `v_profit_by_client` leaks no profit to a rep;
  the activity feed excludes the other rep's book; and the admin sees everything.

## 3. Fulfillment / shipments — pure + database

Pure unit tests (`tests/orders/fulfillment.test.ts`, run by `npm test`) prove the
line/order **fulfillment derivation** (a TypeScript mirror of
`0398_fulfillment_views.sql`) and that the **packing-slip view model** exposes no
pricing/cost/profit/commission field (banned-substring scan + exact key
allow-list, with internal figures planted as bait on the client snapshot).

Database suites (migrations `0001`–`0399` applied):

```bash
supabase db reset
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m8_fulfillment.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/m8_fulfillment_security.sql
```

- **`m8_fulfillment.sql`** (fixtures, rolled back) — independent per-line status;
  partial + multi-shipment shipping on different dates; over-ship / zero /
  negative rejection; atomic rollback (a bad line ships nothing); fully/partially
  derivation; cancelled-line handling; **financial snapshot unchanged by
  shipping**; issued-invoice immutability; lot snapshotting; append-only
  (finalized shipments reject UPDATE/DELETE) + audited void; Owner/Admin-only
  writes with Sales-Rep refused; and rep row-scoped read isolation (`v_order_*`).
- **`m8_fulfillment_security.sql`** (structural) — RLS on the three base tables,
  admin-only write policies, **no direct INSERT/UPDATE/DELETE grant** to
  `authenticated` (writes only via the definer RPCs), read views row-scoped via
  `can_access_invoice` with zero financial columns, RPCs `SECURITY DEFINER` +
  `anon`-denied, and the append-only lock triggers present.

`sql-editor/` twins of both files (psql meta-commands stripped) are provided for
pasting into the Supabase SQL Editor.

## Direct-PDF authorization

The Invoice / Quote / Purchase-Order PDF routes
(`src/app/(app)/**/pdf/route.ts` and `.../document/pdf/route.ts`) enforce
authorization by (1) re-checking the session (`getCurrentUser` → `401`) and
(2) loading through the same **RLS-scoped view model** (`v_orders` / `v_quotes`)
used by the on-screen preview — an out-of-book id resolves to `null` → `404`, and
the model handed to the document is the customer-safe view model with no
cost/profit fields. The behavioral suite proves the underlying view scoping that
these routes inherit; the manual click-through (see `docs/M7_LAUNCH_READINESS.md`)
verifies the `401`/`404`/`200` responses end-to-end.
