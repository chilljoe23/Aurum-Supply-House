# M3 · Complete Client Management

Full client CRUD, a filterable/sortable client list, and a rich client detail page with
derived (M4-ready) panels — built on the M0–M2 schema and security without altering them.

## What shipped

- **Client CRUD** — create, edit, and status changes (`active` / `prospect` / `inactive`).
  No hard deletes; deactivation is a status. Company name, contact, email, phone, payment
  terms, notes, assigned rep, pricing model, and structured billing/shipping addresses are
  validated and normalized through shared Zod schemas.
- **Near-duplicate guard** — creating a client whose normalized company name matches an
  existing one is blocked with a clear warning and an explicit "Create anyway" override
  (mirrors the M1 manufacturer flow). The database does not enforce name uniqueness by design.
- **Premium client list** — "New client" action, search, status/representative/pricing-model
  filters, sortable columns, and pagination via the shared `DataTable`. Columns: company,
  contact, email/phone, representative, pricing model, terms, status, plus inline edit and
  activate/deactivate actions. All rows are RLS-scoped.
- **Client detail** — preserves the complete M2 pricing panel (assigned model, overrides,
  assignment history) and adds: full client information, billing/shipping addresses,
  assigned rep, pricing model, payment terms, status, notes, created/updated metadata, edit
  and status actions, and six derived panels — Invoices, Purchase History (KPIs), Profit
  Generated, Commission Paid, Products Purchased, and Timeline. Every panel reads existing
  tables/views only and shows an honest empty state until M4 produces invoices. Profit and
  commission figures are gated to owner/admin, consistent with M2 cost masking.

## Permissions (server- and database-enforced)

| Actor | Create | Edit | Assign rep | Visibility |
|-------|--------|------|-----------|------------|
| Owner / Admin | any client | any client | any active rep | all clients |
| Sales rep | own book only | own book only | self only | own book only |

- Rep self-assignment and admin any-rep assignment are enforced in the server actions
  **and** by the existing `clients` RLS policies (`clients_rep_insert` / `clients_rep_update`
  require `assigned_rep_id = auth.uid()`; `clients_admin_all` covers owner/admin). RLS was not
  weakened.
- A rep who edits a client cannot reassign it away from themselves (the field is omitted for
  reps and would be rejected by RLS regardless).

## Additive migration

`supabase/migrations/0160_m3_client_activity.sql` — **purely additive**. Adds
`app.trg_activity_client()` and an `AFTER INSERT OR UPDATE` trigger on `public.clients` that
journals `created`, `status_changed`, `rep_reassigned`, `model_changed`, and `updated` events
into the existing `public.activity_log` via `app.record_activity` (from `0075`). Metadata is
non-sensitive (ids, statuses, changed-field names — never contact PII). No table, column,
enum, or policy was changed; migrations `0001`–`0150` are untouched. Because nothing about the
public schema shape changed, `src/types/database.types.ts` did not need regeneration.

`supabase/migrations/0170_m3_client_activity_fix.sql` — **purely additive** follow-up. Saving a
client edit raised `malformed array literal: "email"` because the generic-edit branch appended
changed-field names to a `text[]` with `v_changed || 'email'`, where the untyped literal let
PostgreSQL resolve `||` to `anyarray || anyarray` and parse the scalar as an array. `0170`
`CREATE OR REPLACE`s `app.trg_activity_client()` to append via `array_append(v_changed, '…'::text)`,
which is unambiguous. `0160` is left untouched (already applied); the trigger keeps pointing at
the same function, so no trigger DDL runs and all emitted metadata is preserved.

## Files

**New**
- `supabase/migrations/0160_m3_client_activity.sql`
- `src/lib/clients/schemas.ts`
- `src/lib/clients/queries.ts`
- `src/components/clients/client-form-dialog.tsx`
- `src/components/clients/client-actions.tsx`
- `src/components/clients/clients-manager.tsx`
- `supabase/tests/m3_clients.sql`
- `docs/M3_CLIENTS.md`

**Changed**
- `src/app/(app)/clients/actions.ts` — added `createClient` / `updateClient` / `setClientStatus`
  (pricing actions preserved).
- `src/app/(app)/clients/page.tsx` — renders the new `ClientsManager`.
- `src/app/(app)/clients/[id]/page.tsx` — full detail + derived panels; M2 pricing panel preserved.

**Removed**
- `src/components/clients/clients-table.tsx` — superseded by `clients-manager.tsx`.

## Tests

`supabase/tests/m3_clients.sql` — non-destructive (`BEGIN … ROLLBACK`), `ASSERT`-based. Run with
`psql "$DATABASE_URL" -f supabase/tests/m3_clients.sql` against a database with migrations
`0001`–`0160` applied. Covers owner/admin creation, rep self-assigned creation, rep-cannot-assign-
another-rep, rep-cannot-view/edit another rep's client, admin assign-any-rep, address persistence,
same-as-billing equality, status transitions, inactive-client retention, pricing-assignment
preservation, and activity-log emission.

## Known limitations

- The derived transactional panels are empty until **M4** issues invoices — by design; no data
  is fabricated.
- Duplicate-company prevention is application-layer (normalized-name match), not a DB constraint.
- Timeline shows `client`-entity activity; invoice/payment cross-references arrive with M4/M5.
