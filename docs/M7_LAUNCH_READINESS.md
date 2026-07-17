# Aurum Supply House — M7 Production Launch Readiness

Milestone: `milestone/m7-launch-readiness` (from `c195eb3`). This audit reflects
the codebase as of M7. Items marked **BLOCKER** must be resolved before a public
launch; **RECOMMENDED** items are strongly advised but not release-gating.

---

## 0. Launch scope — Owner-only (single user)

The initial production launch has **exactly one user: the Owner**. There is no
sales-rep login, invitation, or rep-management workflow to ship for launch.

- **UI:** a single presentation flag, `SALES_REPS_ENABLED` (`src/lib/launch.ts`,
  default `false`), hides every rep-specific control — client rep-assignment field,
  the Representative column/filter on Clients / Orders / Quotes, and the
  Representative info rows on the client / order / quote detail pages. New clients
  default to **unassigned** (`clients.assigned_rep_id` is nullable — no Owner
  self-assignment is forced).
- **Database is unchanged and unweakened.** Role-based security stays fully on:
  RLS policies, column masking (`app.is_admin()`), the `sales_rep` role, and the
  row-scoped views/RPCs all remain exactly as built. The flag is presentation-only.
- **Enabling multi-user later is a config flip, not a rebuild:** provision rep
  accounts, set `SALES_REPS_ENABLED = true`, and run the
  "Future multi-user / sales-rep checks" below. No migration or schema change.
- **Sales-rep impersonation and rep UI testing are post-launch validation**, not a
  launch blocker (the DB guarantees are already proven by the SQL suites in
  `supabase/tests/`).

Checklists at the end of this document are split into **Owner-only launch
blockers** and **Future multi-user / sales-rep checks** accordingly.

---

## 1. Authentication & redirect behavior — READY

- Session refresh + gate in `src/proxy.ts` → `updateSession()`
  (`src/lib/supabase/middleware.ts`). `PUBLIC_PATHS = ["/login", "/auth"]`.
- Unauthenticated request to a protected path → `redirect /login?next=<path>`.
- Authenticated request to `/login` → `redirect /command-center`.
- Second gate in the app layout (`src/app/(app)/layout.tsx`): `getCurrentUser()`
  null → `redirect("/login")` (defense in depth; every server page is
  `dynamic = "force-dynamic"`).
- All Supabase reads use the anon key + the caller's cookies; **no service-role
  key is present anywhere in `src/`** (verified). RLS is the real gate.

## 2. Owner / Admin / Sales-Rep permissions — READY

Roles: `owner`, `admin`, `sales_rep` (`profiles.role`). See the permission matrix
in `docs/M7_REPORTING.md`. Enforced at the DB via `app.is_admin()` /
`app.is_staff()` / `app.rep_client_ids()`, and mirrored in the UI via
`canSeeInternal = role ∈ {owner, admin}`.

**Owner-only launch:** the `sales_rep` role and all its DB enforcement remain in
place, but the rep-facing UI is hidden behind `SALES_REPS_ENABLED = false`
(see §0). The Owner retains complete access to Clients, Catalog, Pricing, Quotes,
Orders, Invoices, Payments, Commissions, Purchasing, Reports, Settings, and PDFs —
nothing in the Owner's surface is gated by this flag.

## 3. RLS coverage — READY (with an M7 fix)

- Every cost/profit base table is admin-only: `invoices`, `invoice_items`,
  `commissions`, `order_expenses`, `purchase_orders`/items, `manufacturer_payments`.
  Reps read only through row-scoped, column-masked views and definer RPCs.
- **M7 security fix (0391):** the legacy `0075` insights views
  (`v_profit_by_client`, `v_revenue_monthly`, …) ran with **owner rights and no
  masking** — a rep with `SELECT` could have read company-wide profit. They are
  recreated `security_invoker = true` so base-table RLS applies (reps get zero
  rows / NULL profit). Only `getClientProfit` (admin-gated) consumed one of them,
  so no behavior changes for admins.
- Adversarial coverage: `supabase/tests/m7_security_assertions.sql` (structural)
  and `m7_reporting_rls_behavioral.sql` (rep/admin impersonation). See
  `supabase/tests/README.md`.

## 4. Environment-variable validation — READY

- `getSupabaseEnv()` (`src/lib/env.ts`) throws a clear, actionable error at call
  time if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing.
- Full list of variables the running app reads: **only**
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `PUPPETEER_EXECUTABLE_PATH`, `CHROME_PATH`. `SUPABASE_PROJECT_ID` is used
  **only** by the local `npm run gen:types` script, never at runtime.
- **RECOMMENDED:** add a startup fail-fast (e.g. in `instrumentation.ts`) that
  asserts the two Supabase vars and, in production, that a Chromium path resolves
  — today a missing Chromium is only discovered on first PDF request (returns 503,
  which is handled, but late).

## 5. Supabase production configuration — see §"Supabase production checklist"

## 6. Storage bucket privacy & signed URLs — READY

- All five buckets are **private** (`public = false`): `company`, `imports`,
  `po-attachments`, `invoice-pdfs`, `po-pdfs` (`0090_storage.sql`).
- `storage.objects` policies mirror table RLS; `0350` tightened `po-attachments`
  (manufacturing docs, carry cost) to **admin-only** read.
- Customer PDFs are generated **on demand** by the authorized routes (no public
  URLs, `Cache-Control: no-store`). If/when PDFs are persisted to a bucket, serve
  them via **short-lived signed URLs** (`createSignedUrl`) — never `getPublicUrl`.

## 7. Secrets & sensitive-file scan — READY

- No `service_role` / secret keys in `src/` (verified by grep).
- `.gitignore` excludes `.env`, `.env*.local`, `*.pem`, `AURUM LOGO/`,
  `aurum_invoice 2/`, `supabase/.temp/`. `.env.example` contains placeholders only.
- **Pre-launch action:** rotate any keys that were ever shared in chat/screens;
  confirm the production anon key is the project's current one.

## 8. Error handling — READY (route level) / RECOMMENDED (UI level)

- Route handlers return correct status codes: PDF routes `401` (no session),
  `404` (out-of-scope id via RLS-scoped model), `503` (`ChromiumNotFoundError`).
- Env misconfig throws a descriptive error.
- **RECOMMENDED (not implemented — would be a feature change):** add
  `src/app/(app)/error.tsx`, `not-found.tsx`, and a `global-error.tsx` so an
  unexpected server error renders a branded fallback instead of the default Next
  error page. Left for a follow-up per the "no additional feature changes" scope.

## 9. Audit logging — READY

- `activity_log` (append-only; writes only via `security definer`
  `app.record_activity`, invoked by triggers on invoices, payments, quotes,
  commissions, clients). Surfaced rep-safely via `report_recent_activity()`.
- **RECOMMENDED:** add explicit activity events for report **CSV exports** of
  internal financials if export auditing is required by policy (not present today).

## 10. Database backups & recovery — RECOMMENDED (operational)

- Enable Supabase **Point-in-Time Recovery** (Pro plan) or, at minimum, verify
  daily automated backups are on and retention meets policy.
- Document and **rehearse** a restore into a scratch project at least once.
- Because all migrations are forward-only and additive, schema recovery = replay
  `supabase/migrations/` in order.

## 11. Rate limiting — RECOMMENDED (not implemented)

No app-level rate limiting today. Before launch, add limits on sensitive/abusable
actions at the edge (host WAF / reverse proxy) or in middleware:
- Auth endpoints (login) — rely on Supabase Auth's built-in limits + a WAF rule.
- **PDF routes** (`/**/pdf`) — CPU-heavy (headless Chromium). Cap per-user
  concurrency/requests to prevent resource exhaustion.
- CSV export / report RPCs — modest per-user limits.

## 12. PDF runtime requirements — READY (see §"PDF / Chromium")

## 13. Production Chromium for puppeteer-core — ACTION REQUIRED (deploy-time)

See the dedicated section below — this is the one true deployment prerequisite
for direct PDF downloads.

## 14. Invoice / Quote / PO PDF downloads — READY & UNCHANGED

- All three routes re-check the session and load through the **same RLS-scoped
  view models** and **customer-safe document components** approved in the prior
  milestone — M7 did not modify them:
  - `src/app/(app)/orders/[id]/invoice/pdf/route.ts` → `getInvoiceViewModel` →
    `InvoiceDocument`
  - `src/app/(app)/quotes/[id]/document/pdf/route.ts` → `getQuoteViewModel` →
    `QuoteDocument`
  - `src/app/(app)/purchasing/[id]/document/pdf/route.ts` →
    `getPurchaseOrderViewModel` → `PurchaseOrderDocument`
- Customer-safe models structurally omit cost/profit/margin/commission/internal
  fields. Out-of-book id → `404`. No service-role key.

## 15. Mobile & desktop behavior — READY

- Command Center and Insights use responsive grids
  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4`); Insights tables scroll
  horizontally inside `overflow-x-auto`; filter bar and report selector wrap.
- **RECOMMENDED:** manual pass on a 375px-wide viewport (see click-through).

## 16. Empty states — READY

Every Insights report renders a branded `EmptyState` when its dataset is empty;
Command Center shows empty states for no activity. Reps with no book see zeros /
empties, never errors.

## 17. Accessibility basics — READY / RECOMMENDED

- Semantic tables, labelled filter controls (`<label>` wraps each select/date),
  buttons are real `<button>`s, focus-visible styles from the design system.
- **RECOMMENDED:** verify color-contrast of the KPI/aging accents in both themes
  and add `aria-label`s to icon-only buttons if any are added later.

## 18. Production build — READY

`npm run build` succeeds; the three PDF routes appear as dynamic
(`ƒ`) route handlers. `puppeteer-core` is in `serverExternalPackages` so Chromium
tooling is never bundled.

## 19. npm audit — READY

`npm audit` → **0 vulnerabilities**. The M7 test runner is Node's built-in
`node:test` (zero new dependencies), specifically to keep the audit clean.
**Do not** run `npm audit fix --force`.

## 20. Git hygiene — READY

Working tree contains only the M7 additive changes (migrations, insights lib +
components, dashboard/command-center updates, tests, docs). No secrets, no build
output, no generated PDFs/PNGs committed. Left uncommitted for review.

---

## PDF / Chromium — production requirement (the one deploy prerequisite)

Direct PDF generation uses **`puppeteer-core`**, which **does not bundle a
browser**. The deployment MUST provide a compatible Chrome/Chromium executable
and point the app at it. Resolution order (`src/lib/documents/pdf.ts` →
`resolveChromeExecutable()`):

1. `PUPPETEER_EXECUTABLE_PATH` (preferred), else `CHROME_PATH`
2. Common Linux paths (`/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, …)
3. Common macOS paths (local dev)

If none resolves, the route returns **HTTP 503 "PDF renderer unavailable"** and
the on-screen **print-to-PDF fallback still works** — no crash, no data leak.

### What to configure per platform

- **Docker / VM / bare host:** install Chrome or Chromium in the image and set
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable` (or the chromium
  path). Debian/Ubuntu also needs the headless system libs
  (`libnss3 libatk-bridge2.0-0 libgbm1 libasound2 libpangocairo-1.0-0 fonts-liberation …`).
  The launch flags already include `--no-sandbox --disable-setuid-sandbox
  --disable-gpu` for containers.
- **AWS Lambda / Vercel functions / other read-only serverless:** the system
  Chrome approach doesn't fit. Use a Lambda-compatible Chromium
  (e.g. `@sparticuz/chromium`) and set `PUPPETEER_EXECUTABLE_PATH` to the path it
  unpacks (`await chromium.executablePath()`), keeping the Node.js runtime
  (`export const runtime = "nodejs"` is already set on every PDF route). Ensure the
  function has enough memory (≥1024 MB) and timeout (≥15 s) for cold-start Chromium.
- Verify after deploy: hit each PDF route once and confirm a `200 application/pdf`
  (see click-through). A `503` means the executable/env var isn't wired up yet.

---

## Production environment-variable checklist

| Variable | Required | Where | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | build + runtime | Public; project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | build + runtime | Public anon key; RLS is the gate. |
| `PUPPETEER_EXECUTABLE_PATH` | ✅ (for PDF) | runtime | Absolute path to Chrome/Chromium. |
| `CHROME_PATH` | alt | runtime | Fallback if `PUPPETEER_EXECUTABLE_PATH` unset. |
| `SUPABASE_PROJECT_ID` | ⛔ runtime | local only | Used by `gen:types` script only. |

Never set a `service_role` key in the web app environment.

## Supabase production checklist

- [ ] Apply migrations `0001` → `0392` to the production project (`supabase db push`
      or CI). **This milestone did not apply them.**
- [ ] Regenerate `src/types/database.types.ts` (`npm run gen:types`) after applying,
      so the new `v_report_order_lines` view and `report_recent_activity` RPC are
      typed (the app runs today via `createUntypedClient`, so this is a
      correctness/DX improvement, not a blocker).
- [ ] Confirm RLS is **enabled** on every table (it is, in-migration) and run
      `supabase/tests/m7_security_assertions.sql` against production-clone.
- [ ] Verify the five storage buckets exist and are private.
- [ ] Auth: production redirect/site URLs configured; email templates set. For the
      Owner-only launch the roster is a single user — **disable public sign-up**.
- [ ] Enable PITR / confirm backups; set a strong DB password; restrict network if
      applicable.
- [ ] Confirm the first real user is provisioned as `owner`.

## Deployment checklist

1. [ ] Merge/approve `milestone/m7-launch-readiness`.
2. [ ] Apply DB migrations to production; run the two SQL security suites green.
3. [ ] Provision Chromium + set `PUPPETEER_EXECUTABLE_PATH` in the runtime env.
4. [ ] Set the two `NEXT_PUBLIC_SUPABASE_*` vars.
5. [ ] `npm ci && npm run build` in CI; deploy the build.
6. [ ] Smoke test **as the Owner**: login → Command Center metrics load → Insights
       renders → export a CSV → download one Invoice, one Quote, one PO PDF
       (expect `200`).
7. [ ] Confirm the Owner sees no rep controls (no Representative column/filter on
       Clients / Orders / Quotes; no rep-assignment field when adding a client).
8. [ ] Confirm backups/PITR active and a restore has been rehearsed.

   > Sales-Rep login verification moves to the **Future multi-user / sales-rep
   > checks** section — it is post-launch validation, not a launch gate.

## Rollback checklist

- **App:** redeploy the previous release artifact / revert to the prior commit
  (`c195eb3`). The M7 UI changes are additive; reverting the frontend is safe.
- **Database:** M7 migrations are **additive and non-destructive** — they add one
  view + one function (0390) and harden seven existing views in place (0391). To
  roll back without a full restore:
  - `0390`: `drop view if exists public.v_report_order_lines;`
    `drop function if exists public.report_recent_activity(integer);`
  - `0391`: re-run the original `0075` `create or replace view …` bodies (they
    differ only by the `security_invoker` flag). **Note:** doing so re-opens the
    profit-leak, so only revert `0391` together with the frontend that never
    exposed those views to reps. Prefer leaving `0391` in place.
- No data migration occurred, so there is no data to un-migrate; a PITR restore is
  only needed if unrelated writes must be undone.

## Remaining launch blockers — Owner-only launch

These are the only items gating the single-user Owner launch:

1. **Apply migrations `0001`–`0392` to production** (not done by this milestone,
   by instruction). Until applied, `v_report_order_lines` / `report_recent_activity`
   don't exist and Insights/Command-Center reads will error. Run the SQL security
   suites green as part of this step (see the Supabase checklist).
2. **Provision Chromium + `PUPPETEER_EXECUTABLE_PATH`** in production, or accept
   the print-to-PDF fallback (direct download returns 503 without it).
3. **Provision the single Owner account** (`profiles.role = 'owner'`) and, because
   the roster is one user, **disable public sign-up** in Supabase Auth.
4. **Confirm `SALES_REPS_ENABLED = false`** in the deployed build (the default) so
   no rep UI is exposed. Owner access to every module is unaffected by the flag.

## Future multi-user / sales-rep checks (post-launch — NOT launch blockers)

Do these only when adding a second user / turning on the rep experience. The DB
guarantees below **already hold today** (proven by the SQL suites in
`supabase/tests/`), so this is enablement + validation, not new build:

1. [ ] Provision sales-rep account(s) and assign clients to reps (the Owner can
       assign/reassign once the flag is on).
2. [ ] Set `SALES_REPS_ENABLED = true` (`src/lib/launch.ts`) and redeploy — this
       restores the rep-assignment field and the Representative column / filter /
       detail rows across Clients, Orders, and Quotes. No schema change.
3. [ ] Verify a Sales-Rep login sees only their own book, and that gross / net /
       margin / cost / commission / expense are **NULL** for the rep on every
       surface (dashboard, insights, CSV, PDFs). Re-run
       `supabase/tests/m7_reporting_rls_behavioral.sql` and
       `sql-editor/m7_v_orders_masking_diagnostic.sql` against a prod-clone.
4. [ ] Confirm rep row-isolation across two reps' separate books.
5. [ ] Decide the invitation / onboarding flow (email invite vs. admin-provisioned).
       No in-app invitation UI exists yet — intentionally out of scope for the
       Owner-only launch.

## Recommended (non-blocking) before or shortly after launch

- Add `error.tsx` / `not-found.tsx` / `global-error.tsx` branded boundaries.
- Startup env fail-fast (Supabase vars + Chromium resolvable).
- Rate limiting on PDF/report routes (edge or middleware).
- Regenerate `database.types.ts` and drop the `createUntypedClient` usage for the
  new objects.
- Backups/PITR enabled and a restore rehearsed.
