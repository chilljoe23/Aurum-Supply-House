# Aurum Supply House — Phase 1 Architecture

A premium internal operating system for a private wholesale company: purchasing, pricing, invoicing,
commissions, profitability, and customer management. This folder is the **Phase 1 design deliverable**
— complete data & security architecture and a build roadmap. No UI code is written until this is
approved.

## What's here

| File | What it is |
|------|------------|
| `ARCHITECTURE.md` | The master design: principles, the immutability model, every table & relationship, RLS, money math, folder structure, roadmap summary. **Start here.** |
| `ERD.md` | Entity-relationship diagram (Mermaid). |
| `IMPORT_AND_STORAGE.md` | Excel import pipeline, duplicate detection, version history, storage buckets, PDF generation. |
| `ROADMAP.md` | Module-by-module build order (M0–M8) with exit criteria. |
| `supabase/migrations/` | Production-ready SQL: tables, enums, indexes, triggers, RLS, storage. Apply in numeric order. |

## The one idea that shapes everything

Historical invoices, costs, and pricing **never change**. This is enforced two ways at once:
every invoice **snapshots** its inputs (customer, price, cost, commission, rep) at creation, and once
sent it is **locked** by database triggers against any financial edit. See `ARCHITECTURE.md §2`.

## Migration order

```
0001_extensions_and_enums.sql      extensions, private schema, enums, utils
0010_identity_and_settings.sql     profiles, settings, numbering, RLS helpers
0020_clients.sql                   clients
0030_catalog.sql                   manufacturers, products, append-only cost history
0040_pricing.sql                   pricing sheets, items, tiers, history
0045_client_price_overrides.sql    per-customer SKU overrides + app.resolve_price
0050_purchasing.sql                purchase orders, items, attachments, status,
                                   manufacturer payment ledger
0060_orders_invoices.sql           invoices, items (+lot refs), calc + immutability lock
0065_order_expenses.sql            internal per-order expenses feeding net profit
0070_commissions_payments.sql      commissions (internal+external), payments ledger
0075_activity_and_views.sql        activity log, insights views
0080_rls_policies.sql              Row Level Security for every table
0090_storage.sql                   storage buckets + policies
```

Apply with the Supabase CLI (`supabase db push`) or paste each file into the SQL editor in order.

## Status — Approved (v0.2)

Six approved revisions are folded in: Orders naming + reserved lifecycle stage; customer-specific
pricing overrides; internal **and external** commission recipients; manufacturer payment ledger on POs;
optional lot references on order lines; and a clarified profit model with a separate order-expense
ledger (`net_profit` = gross profit − commission − order expenses; customer-paid shipping stored
separately from company freight). All 13 migrations validated against Postgres 16. See
`ARCHITECTURE.md` change log. Implementation has begun at **M0 — Foundation**.
