# Aurum Supply House

A premium internal operating system for a private wholesale company — purchasing, pricing, invoicing,
commissions, profitability, and customer management.

This repository contains **M0 — Foundation**: the design-token system, authenticated app shell,
role-aware routing, Supabase wiring, reusable primitives, and empty premium pages for every section.
The full data architecture and validated SQL migrations live in `supabase/migrations/` and `docs/`.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui-style components · Supabase
(Auth, Postgres, Storage, RLS). Geist typography with an Inter fallback.

## Prerequisites

- Node.js 18.18+ (or 20+)
- A Supabase project (cloud or local via the Supabase CLI)

## 1. Install

```bash
npm install
```

> Note: this must be run in an environment with npm-registry access. The build sandbox these files
> were authored in blocks the npm registry, so `npm install` / `next build` were not run there — the
> database layer was validated separately against Postgres 16 (see `docs/` and `supabase/tests/`).

## 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in from your Supabase project's **Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```

## 3. Apply the database migrations

Using the Supabase CLI (recommended):

```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/*.sql in order
```

Or paste each file in `supabase/migrations/` (numeric order) into the SQL editor.

Then (optionally) regenerate types from your live project:

```bash
supabase gen types typescript --project-id <ref> --schema public > src/types/database.types.ts
```

## 4. Create the first user

Sign up one user in **Supabase → Authentication → Users** (or via the app once running). The database
trigger `handle_new_user` makes the **first** user an `owner` automatically; subsequent users default
to `sales_rep`. Change roles in the `profiles` table as needed.

## 5. Run

```bash
npm run dev            # http://localhost:3000
```

Unauthenticated visits redirect to `/login`; after sign-in you land on the Command Center.

## Validation

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run build          # production build
```

Database-layer validation (already performed against Postgres 16; rerun any time):

```bash
psql "$DATABASE_URL" -f supabase/tests/smoke.sql        # M0 business rules + RLS
psql "$DATABASE_URL" -f supabase/tests/m1_catalog.sql   # M1 catalog import + cost history + RLS
psql "$DATABASE_URL" -f supabase/tests/m2_pricing.sql   # M2 resolver chain + bands + RLS masking
```

The smoke test asserts price resolution priority, invoice math, the immutability lock, PO payment
tracking, order-expense-aware net profit, internal/external commissions, and role-based RLS isolation.
The M1 test asserts import classification, atomic rollback, valid-rows-only, cost-history
preservation, manual-cost reason enforcement, and rep cost-hiding.

## Catalog & Excel import (M1)

Catalog lives at `/catalog`: searchable/filterable/sortable table, CSV export, and — for Owners and
Admins — Add Product, Manufacturers, and an 8-step **Import Excel** wizard (upload → worksheet →
preview → map → validate → review → confirm → results). Uploaded files are stored in the private
`imports` Storage bucket (created by migration `0090`); no extra bucket setup is required. True cost
and cost history are visible only to Owners/Admins, enforced at the database layer via the
`catalog_products` view and admin-only RLS on the base tables.

## Project layout

```
src/
  app/
    (app)/                 authenticated area (sidebar + top bar shell)
      command-center/ clients/ catalog/ pricing/ purchasing/
      orders/ commissions/ insights/ settings/
    login/                 sign-in
    layout.tsx globals.css
  components/
    ui/                    shadcn-style primitives
    patterns/              data-table, searchable-select, command-palette, kpi-card, …
    shell/                 sidebar, topbar, user-menu, theme, logo
  lib/
    supabase/              browser + server + middleware clients
    auth.ts navigation.ts utils.ts env.ts
  types/database.types.ts  generated from the schema
supabase/
  migrations/              production SQL (tables, triggers, RLS, storage)
  tests/smoke.sql          business-rule + RLS assertions
docs/                      ARCHITECTURE.md, ERD.md, IMPORT_AND_STORAGE.md, ROADMAP.md, README.md
```

## Pricing (M2)

`/pricing` manages reusable pricing models with effective-dated quantity bands (tiers). Each client is
assigned a default model (`/clients/[id]`) and may have client-specific SKU overrides. Price resolution
is deterministic via `app.resolve_price`: client override → explicitly selected model → assigned model →
default model → authorized manual price → unresolved (never zero, never cost). True cost and margins are
Owner/Admin-only, enforced at the DB layer by the `pricing_item_margins` security-invoker view. Pricing
sheets import through the same wizard as the catalog (`/pricing/import`).

## What ships after M0

Modules are built one at a time on this foundation: M1 Catalog, M2 Pricing, M3 Clients, M4 Orders,
M5 Commissions & Payments, M6 Purchasing, M7 Insights, M8 polish. See `docs/ROADMAP.md`.
