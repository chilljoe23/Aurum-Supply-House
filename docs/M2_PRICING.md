# M2 — Pricing Models & Customer-Specific Pricing (delivered)

Additive on M0/M1. No prior migration rewritten. Design system preserved.

## What shipped

Reusable pricing models with effective-dated quantity bands (tiers), per-client model assignment,
client-specific SKU overrides, a deterministic price resolver, bulk adjustments, model duplication,
a reused import wizard for pricing sheets, and role-gated cost/margin visibility.

## New additive migrations

- `0130_m2_pricing_schema.sql` — quantity bands + effective-dating + audit on `pricing_sheet_items`
  and `client_price_overrides`; non-overlap `EXCLUDE` (btree_gist) constraints; `client_pricing_assignments`;
  append-only guards on closed pricing/override records; `pricing_import_rows` + batch counters;
  default-per-currency uniqueness.
- `0140_m2_pricing_functions.sql` — `app.set_price`, `app.set_override`, `app.assign_pricing_model`,
  `app.resolve_price` (jsonb), `app.commit_pricing_import`, `app.bulk_adjust_prices`,
  `app.duplicate_pricing_model`; public admin-checked wrappers + staff-callable `public.resolve_price`.
- `0150_m2_pricing_rls.sql` — rep read limited to active bands; import admin-only; assignment RLS;
  `pricing_item_margins` security-invoker view (cost/margin admin-only).

## Changed/new tables, views, functions

Tables: `client_pricing_assignments`, `pricing_import_rows` (new); extended `pricing_sheets`,
`pricing_sheet_items`, `client_price_overrides`, `pricing_import_batches`.
Views: `pricing_item_margins` (new). Functions/RPCs as listed above.

## Resolver priority (exact)

`app.resolve_price(client, product, quantity, currency, selected_model, effective, manual_price, manual_reason)`
resolves in strict order and returns `{resolved, price, currency, source, pricing_sheet_id,
pricing_sheet_name, override_id, tier_min_quantity, effective_date, manual, warning}`:

1. **client_override** — active override for SKU/qty/currency/date (highest applicable min_quantity wins)
2. **selected_model** — an explicitly passed model
3. **assigned_model** — the client's `default_pricing_sheet_id`
4. **default_model** — the active `is_default` model for the currency
5. **manual** — an explicitly supplied price (requires a reason; never zero)
6. **unresolved** — price `null` + warning. Never falls back to cost. Never returns zero.

Examples (validated): C1 assigned Pricing A → q1 = 42 (assigned), q150 = 39 (tier), q600 = 30 (override
beats everything); q1 with selected=B = 40 (selected); client's P2 not in A → 50 (default); P3 nowhere
= unresolved; P3 + manual 99 + reason = manual.

## Routes & components

Routes: `/pricing`, `/pricing/[id]`, `/pricing/import`, `/clients` (real list), `/clients/[id]`
(pricing surface). Lib: `src/lib/pricing/{fields,mapping,normalize,classify,schemas,queries}.ts`
(reuses M1 parser). Actions: `pricing/actions.ts`, `clients/actions.ts`. Components: pricing table,
model dialog, price-band dialog, bulk-adjust dialog, model detail + bands table, pricing import wizard,
clients table, assign-model dialog, override dialog, client pricing panel.

## Security (DB-enforced)

Reps: read active selling prices, view assigned model for permitted clients; **no** cost, margin,
import, edit, assignment, override, or bulk. Cost/margin is exposed only via the security-invoker
`pricing_item_margins` view, which inherits products' admin-only RLS — reps get zero rows. RPC wrappers
re-check `app.is_admin()`.

## Tests

- `supabase/tests/m2_pricing.sql` — resolver chain, overlap rejection, effective/expired/future dating,
  bulk adjust + history, append-only, RLS masking.
- Pricing parse/classify — 20 assertions (price/qty/date/currency validation, all classifications,
  duplicate-in-file, future/expired).

## Guarantees

Products matched by SKU. Pricing never overwrites destructively (close + append). Overlapping active
bands rejected. Below-cost pricing is flagged, not blocked. Manual pricing requires a reason. Nothing
here touches historical order snapshots (orders arrive in M4).
