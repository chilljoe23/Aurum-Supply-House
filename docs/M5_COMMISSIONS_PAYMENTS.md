# M5 — Commissions, Customer Payments & Accounts Receivable

Multi-recipient commissions (internal users and external partners, four
calculation methods, a pending → earned → approved → paid lifecycle), a completed
customer-payment workflow with aged receivables, printable commission statements,
and real Command Center / client integration — all on the frozen M0–M4 schema and
security model, without redesigning the approved invoice.

M5 is **additive**: it extends the M0 `commissions` / `payments` tables and reuses
the M4 recalc, immutability, masking, and activity infrastructure. Migrations
0001–0210 are untouched.

---

## 1. Summary of what was built

- **Multi-recipient commissions** on any invoice — internal users (require a
  profile) and external referral partners (name / email / company / pay-notes, no
  login). All four calculation methods, computed from the invoice's **frozen**
  economics and never silently recalculated.
- **Lifecycle** — `pending → earned → approved → paid`, plus `void`. A commission
  **earns automatically when its invoice is fully paid**; Owner/Admin approve an
  earned commission and then mark an approved one paid. Voiding an unpaid invoice
  voids its unpaid commissions; paid commissions are permanent.
- **Commissions section** (`/commissions`) — KPI cards (Pending, Earned, Approved,
  Owed, Paid), search + filters (status, recipient type, recipient, client, date),
  sortable/paginated table, bulk approve, bulk mark-paid, CSV export, and a detail
  drawer with payment + audit context.
- **Order-detail commission panel** — Owner/Admin add/edit/approve/pay/void
  recipients with a live preview and a net-profit-after-commissions explanation;
  reps see only their own commission amount + status. Never on the customer PDF.
- **Commission statements** (`/commissions/statements`) — printable per-recipient
  statements in the Aurum visual language, clearly marked internal, with **no**
  client cost / gross profit / margin / net profit.
- **Customer payments** — the M4 ledger completed with a duplicate-submission
  guard on top of the existing zero/negative, overpayment, and draft/void
  rejections and the automatic Partial/Paid rollups.
- **Accounts Receivable** (`/orders/receivables`) — outstanding + aged buckets
  (current / 1–30 / 31–60 / 61–90 / 90+), search, bucket/client/rep/date filters,
  sort, pagination, CSV, links to invoice + client. Void and fully-paid invoices
  are excluded.
- **Command Center** — real Revenue (MTD), Net Profit (MTD, admin), Outstanding &
  Overdue receivables, Commission owed, Commission paid (MTD), and a live Recent
  Activity feed. No fabricated charts (trends remain honestly deferred to M7).
- **Client detail** — outstanding balance, invoices, commission owed/paid (admin),
  and a timeline that now surfaces payment and commission events — all real.

The approved invoice document was **not** modified. It already renders amount
paid, balance due, and payment status from the real payment rollups.

---

## 2. Additive migrations (0220–0260)

| File | What it adds |
|------|--------------|
| `0220_m5_commissions_schema.sql` | `earned` status on `commission_status`; commission snapshot columns (`invoice_subtotal`, `invoice_gross_profit`, `paid_by`, `paid_method`, `paid_reference`, `paid_note`, `updated_by`); rewrites `app.compute_commission` to snapshot + never recompute a frozen amount; adds the lifecycle transition guard, the invoice→commission automation (earn-on-paid / void-on-void), and the commission audit trigger |
| `0230_m5_commission_rpcs.sql` | SECURITY DEFINER RPCs `create_commission`, `update_commission`, `approve_commission`, `pay_commission`, `void_commission`, `bulk_approve_commissions`, `bulk_pay_commissions`, `preview_commission` + hardened public wrappers + grants |
| `0240_m5_payments.sql` | `app.enforce_no_duplicate_payment` — rejects an identical customer payment recorded within 2 minutes (double-submit guard) |
| `0250_m5_views.sql` | Masked, row-scoped `v_commissions`; `v_commission_summary`; `v_ar_aging` (deterministic buckets from due date vs `current_date`); `v_ar_summary` |
| `0260_m5_rls.sql` | Locks `commissions` base reads to admins (drops `commissions_rep_read` / `commissions_rep_insert`); reps read via `v_commissions` only; mirrors non-sensitive commission events onto client timelines |

All commission and payment mutations flow through the SECURITY DEFINER RPCs;
every one is a single transaction (atomic).

## 3. Tables, views, functions, triggers, RPCs added or changed

**Table changed:** `public.commissions` — new snapshot + payment columns (above);
`commission_status` enum gains `earned`.

**Views added:** `v_commissions`, `v_commission_summary`, `v_ar_aging`,
`v_ar_summary`.

**Functions/triggers added or replaced:** `app.compute_commission` (replaced,
immutability-safe), `app.enforce_commission_transition` (+trigger),
`app.trg_commissions_follow_invoice` (+trigger on `invoices`),
`app.trg_activity_commission` (+trigger), `app.trg_client_activity_from_commission`
(+trigger), `app.enforce_no_duplicate_payment` (+trigger),
`app.validate_commission_inputs`, and the RPCs listed above.

**Unchanged and relied upon:** `app.recalc_invoice` (already nets commissions into
`net_profit`), the invoice immutability lock (`total_commission` / `net_profit`
were always outside the frozen set, so post-issue commissions update net profit
without touching the customer invoice), the payment rollups, activity logging.

## 4. Routes & components

**Routes**
- `/commissions` — commissions manager (KPIs, filters, table, bulk actions, CSV, drawer).
- `/commissions/statements` — per-recipient statement builder + print/PDF.
- `/orders/receivables` — Accounts Receivable (aging, filters, CSV).
- `/orders/[id]` — now includes the staff commission panel.
- `/command-center` — real metrics + recent activity.

**Library** — `src/lib/commissions/{schemas,calculations,queries}.ts`,
`src/lib/ar/{types,queries}.ts`, `src/lib/dashboard/queries.ts`,
`src/lib/supabase/untyped.ts` (loosely-typed client for the new views/RPCs until
`gen:types` is re-run), `src/app/(app)/commissions/actions.ts`.

**Components** — `commissions/commissions-manager.tsx`, `commission-panel.tsx`,
`commission-form-dialog.tsx`, `commission-actions.tsx`, `commission-badge.tsx`,
`commission-statement.tsx`, `statement-builder.tsx`, `ar/ar-manager.tsx`.

## 5. Exact commission formulas

`rate` is stored canonically: a fraction for percent types (0.05 = 5%), a dollar
amount for `flat` / `per_unit`. All rounding is half-up to 2 decimals via
`app.money_round`. Bases are the invoice's **frozen** figures.

```
percent_of_sale          amount = round(invoice.subtotal      × rate, 2)   basis = subtotal
percent_of_gross_profit  amount = round(invoice.gross_profit  × rate, 2)   basis = gross_profit
flat                     amount = round(rate, 2)                           basis = 0
per_unit                 amount = round(units × rate, 2)                   basis = units
```

Each commission snapshots `invoice_subtotal` and `invoice_gross_profit` at
computation time. Invoice roll-ups (unchanged from M4):

```
total_commission = Σ commissions.amount where status <> 'void'
net_profit       = gross_profit − total_commission − total_expenses
```

Worked example (subtotal 25,000; GP 9,000): rep 5% of sales = 1,250; partner flat
500; owner 10% of GP = 900 → total commission 2,650 → net profit = 9,000 − 2,650 −
expenses.

## 6. Exact lifecycle rules

```
pending  → earned  (auto when the invoice is fully paid; a commission created on an
                    already-paid invoice starts earned)
earned   → approved (Owner/Admin)
approved → paid     (Owner/Admin; records method/reference/notes/paid_by/paid_at)
any of pending|earned|approved → void (Owner/Admin, or automatically when the
                    invoice is voided)
paid     → (terminal, immutable — never edited, never deleted)
void     → (terminal)
```

Enforced by `app.enforce_commission_transition` (guard trigger) and the RPCs:
approve requires `earned`; pay requires `approved` (so a duplicate pay is rejected
because the row is no longer approved); editing is refused once approved/paid;
economics are locked once the invoice leaves draft (correct by void + recreate).
Commissions are never auto-deleted; corrections are auditable.

## 7. Exact permissions behavior

| Capability | Owner/Admin | Sales rep |
|---|---|---|
| View commissions | all | **own only** (`v_commissions`, `recipient_id = them`) |
| Create / edit / approve / pay / void | ✓ | **blocked** (RPC 42501 + base table admin-only) |
| Bulk approve / pay | ✓ | blocked |
| See invoice gross profit / GP-basis | ✓ | **never** (NULL at the DB in `v_commissions`) |
| Record customer payment | ✓ | blocked (unchanged from M4) |
| Company-wide AR | ✓ | **own book only** (`v_ar_aging` row scope) |
| Commission statements | any recipient | (reps have no statements UI action; view is own-scoped) |

Enforced in RLS (base tables admin-only), the masked views, the SECURITY DEFINER
RPCs, server actions, and the statement/PDF surfaces (which structurally omit
cost/profit) — never only in hidden buttons.

## 8. Tests and exact results

`supabase/tests/m5_commissions_payments.sql` — non-destructive (`BEGIN … ROLLBACK`),
`ASSERT`-driven, run through the real public RPCs and masked views from each role.
Twelve sections cover: order economics; all four calculations + external recipient;
multi-recipient rollup + net-profit reduction; issue → partial → full payment →
pending-to-earned; earned→approved→paid + invalid transitions + duplicate-action
rejection + paid immutability; invoice-void (unpaid voided, paid retained);
duplicate / draft / void / over payments; AR aging buckets + paid/void exclusion +
summary; rep permission denials; masking + cross-rep isolation + own-only
visibility; audit events (present and amount-free); atomic rollback.

Run with:

```
psql "$DATABASE_URL" -f supabase/tests/m5_commissions_payments.sql
```

## 9. Tests not executed and why

The SQL suite was **authored but not executed** here: this workspace has no local
Postgres, no `psql`, and no Docker, and the task explicitly forbids applying
migrations to Supabase. Apply `0001`–`0260` to a scratch database and run the
command above to execute it (matches the M3/M4 convention).

Executed here and **passing**:

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — succeeds; all M5 routes compile.
- `npm audit` — **0 vulnerabilities** (no `--force`).

## 10. Manual click-through checklist

1. As Owner, open an issued order → **Commissions** panel → add an internal rep
   (5% of sales) and an external partner (flat $500). Confirm the live preview and
   the net-profit-after-commissions line; the flat > GP shows a non-blocking warning.
2. Record customer payments until the invoice is **Paid** → commissions flip to
   **Earned** automatically.
3. `/commissions` → filter to Earned → **bulk approve** → **bulk mark paid** (pick
   method) → statuses advance; KPIs update.
4. Try to pay an earned (not approved) commission → rejected; re-pay a paid one →
   rejected.
5. `/commissions/statements` → pick the external partner → **Generate** → **Print /
   PDF**. Confirm it says "Internal · not a customer invoice" and shows **no**
   cost/GP/margin.
6. `/orders/receivables` → confirm aging buckets, filter by 31–60, export CSV; a
   fully-paid or void invoice does not appear.
7. Record a payment, immediately click Record again with identical details →
   duplicate rejected.
8. Log in as a **sales rep**: `/commissions` shows only their own rows with no GP
   column; the order commission panel shows their amount only; `/orders/receivables`
   shows only their book; Command Center shows no profit figure.
9. Command Center reflects real Outstanding, Overdue, Commission owed, Commission
   paid (MTD), and a live activity feed.
10. Re-download an existing invoice PDF → unchanged (amount paid / balance / status
    reflect real payments).

## 11. Recommendation for M6

Proceed to **M6 — Purchasing** per the roadmap: the manufacturer PO builder, the
10-state lifecycle with status history and attachments, optional cost-on-receipt
feeding catalog cost history, and the manufacturer payment ledger (deposit /
balance / additional / refund_credit) — reusing the same money-rounding, masked-
view, SECURITY DEFINER-RPC, and activity patterns proven in M4/M5. Then M7
(Command Center & Insights) can graduate the deferred trend/top-customer/top-product
cards from honest empty states to full reports over the now-complete order,
payment, and commission history.
