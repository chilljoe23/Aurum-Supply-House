// Unit tests for the shared commission-statement view-model builder. Run: npm test
// (Node's built-in node:test + TypeScript type-stripping — no new deps.)
//
// These prove the recipient-facing statement (a) carries the fixed Aurum brand
// identity — name + Sarasota location only, matching the approved documents — and
// (b) structurally cannot leak internal economics: the builder's output has no
// cost / gross-profit / margin / net-profit / expense fields at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatementModel, statementRecipients, recipientKey } from "../../src/lib/commissions/statement-model.ts";
import { COMPANY_NAME, COMPANY_LOCATION } from "../../src/lib/documents/branding.ts";
import type { CommissionRow } from "../../src/lib/commissions/queries.ts";

// Minimal CommissionRow factory (only the fields the builder reads).
function row(over: Partial<CommissionRow>): CommissionRow {
  return {
    id: "c1",
    invoice_id: "i1",
    invoice_number: "AUR-1001",
    invoice_status: "paid",
    invoice_issue_date: "2026-06-01",
    invoice_due_date: null,
    invoice_paid_at: "2026-06-15",
    client_id: "cl1",
    company_name: "Acme Corp",
    invoice_rep_id: null,
    invoice_rep_name: null,
    recipient_type: "internal_user",
    recipient_id: "u1",
    recipient_name: "Rita Rep",
    recipient_email: "rita@a.test",
    recipient_company: null,
    payment_notes: null,
    commission_type: "percent_of_sale",
    rate: 0.05,
    units: null,
    amount: 12.5,
    status: "earned",
    invoice_subtotal: 250,
    note: null,
    approved_by: null,
    approved_at: null,
    paid_by: null,
    paid_at: null,
    paid_method: null,
    paid_reference: null,
    paid_note: null,
    created_by: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    invoice_gross_profit: 150,
    basis_amount: 250,
    can_see_internal: false,
    ...over,
  } as CommissionRow;
}

const GENERATED = "Jul 17, 2026";

test("company header is the fixed Aurum identity (name + location only)", () => {
  const rows = [row({})];
  const m = buildStatementModel(rows, { recipientKey: "u1", statusFilter: "active", from: "", to: "", generatedOn: GENERATED })!;
  assert.equal(m.company.name, COMPANY_NAME);
  assert.equal(m.company.location, COMPANY_LOCATION);
  assert.equal(m.company.location, "Sarasota, Florida, USA");
  // No settings-derived address / email / phone leaks onto the recipient document.
  assert.deepEqual(Object.keys(m.company).sort(), ["location", "name"]);
});

test("model structurally omits all internal economics (no leakage surface)", () => {
  const m = buildStatementModel([row({})], { recipientKey: "u1", statusFilter: "all", from: "", to: "", generatedOn: GENERATED })!;
  const flat = JSON.stringify(m).toLowerCase();
  for (const banned of ["true_cost", "gross_profit", "grossprofit", "margin", "net_profit", "netprofit", "expense", "cost"]) {
    assert.equal(flat.includes(banned), false, `statement must not expose "${banned}"`);
  }
  // And the row shape carries only recipient-safe columns.
  assert.deepEqual(
    Object.keys(m.rows[0]).sort(),
    ["amount", "calcType", "client", "commissionPaidDate", "invoiceNumber", "invoicePaidDate", "paymentMethod", "paymentReference", "rate", "status"].sort(),
  );
});

test("builds for exactly one recipient and never bleeds other recipients", () => {
  const rows = [
    row({ id: "c1", recipient_id: "u1", recipient_name: "Rita Rep", amount: 10 }),
    row({ id: "c2", recipient_id: "u2", recipient_name: "Raj Rep", amount: 999, invoice_number: "AUR-1002" }),
  ];
  const m = buildStatementModel(rows, { recipientKey: "u1", statusFilter: "all", from: "", to: "", generatedOn: GENERATED })!;
  assert.equal(m.rows.length, 1);
  assert.equal(m.recipient.name, "Rita Rep");
  assert.equal(m.rows[0].amount, 10);
  assert.equal(JSON.stringify(m).includes("Raj Rep"), false);
  assert.equal(JSON.stringify(m).includes("999"), false);
});

test("status filter: active excludes void & pending; totals split earned/approved/paid", () => {
  const rows = [
    row({ id: "a", status: "earned", amount: 10, invoice_number: "AUR-1001" }),
    row({ id: "b", status: "approved", amount: 20, invoice_number: "AUR-1002" }),
    row({ id: "c", status: "paid", amount: 30, invoice_number: "AUR-1003", paid_at: "2026-07-01" }),
    row({ id: "d", status: "void", amount: 40, invoice_number: "AUR-1004" }),
    row({ id: "e", status: "pending", amount: 50, invoice_number: "AUR-1005" }),
  ];
  const m = buildStatementModel(rows, { recipientKey: "u1", statusFilter: "active", from: "", to: "", generatedOn: GENERATED })!;
  assert.equal(m.rows.length, 3); // void + pending excluded
  assert.equal(m.earnedTotal, 10);
  assert.equal(m.approvedTotal, 20);
  assert.equal(m.paidTotal, 30);
  assert.equal(m.owedTotal, 30); // earned + approved
});

test("date-range filter uses issue date (falls back to created_at)", () => {
  const rows = [
    row({ id: "a", invoice_issue_date: "2026-01-10", amount: 10, invoice_number: "AUR-1001" }),
    row({ id: "b", invoice_issue_date: "2026-06-10", amount: 20, invoice_number: "AUR-1002" }),
  ];
  const m = buildStatementModel(rows, { recipientKey: "u1", statusFilter: "all", from: "2026-05-01", to: "2026-12-31", generatedOn: GENERATED })!;
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].amount, 20);
});

test("external partner keyed by name; unknown recipient → null", () => {
  const rows = [row({ recipient_id: null, recipient_type: "external_partner", recipient_name: "Referral Co" })];
  const recs = statementRecipients(rows);
  assert.equal(recs[0].key, "ext:Referral Co");
  assert.equal(recipientKey(rows[0]), "ext:Referral Co");
  assert.equal(buildStatementModel(rows, { recipientKey: "nobody", statusFilter: "all", from: "", to: "", generatedOn: GENERATED }), null);
});
