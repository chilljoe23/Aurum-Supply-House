// Unit tests for the Owner-only permanent-deletion UI gate + confirmation logic.
// Run: npm test  (node:test + TypeScript type-stripping — no new deps.)
//
// These mirror the authoritative DB rules in app.hard_delete_order and prove the
// UI never offers, or arms, a deletion that the server would refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deletionConfirmed, isOrderDeletable, DELETE_CONFIRM_WORD } from "../../src/lib/orders/deletion.ts";

test("confirmation requires the exact word DELETE AND a non-empty reason", () => {
  assert.equal(DELETE_CONFIRM_WORD, "DELETE");
  assert.equal(deletionConfirmed("DELETE", "entered twice by mistake"), true);
  assert.equal(deletionConfirmed("  DELETE  ", "trimmed ok"), true); // outer whitespace trimmed
  // Blocked: wrong text.
  assert.equal(deletionConfirmed("delete", "reason"), false); // case-sensitive
  assert.equal(deletionConfirmed("DELET", "reason"), false);
  assert.equal(deletionConfirmed("DELETE NOW", "reason"), false);
  assert.equal(deletionConfirmed("", "reason"), false);
  // Blocked: missing reason.
  assert.equal(deletionConfirmed("DELETE", ""), false);
  assert.equal(deletionConfirmed("DELETE", "   "), false);
});

test("eligibility: Owner may delete an eligible Draft or Void order", () => {
  assert.equal(isOrderDeletable({ role: "owner", status: "draft", paymentCount: 0, commissionStatuses: [] }), true);
  assert.equal(isOrderDeletable({ role: "owner", status: "void", paymentCount: 0, commissionStatuses: ["void", "pending"] }), true);
});

test("eligibility: only the Owner — Admin and Sales Rep are never offered it", () => {
  assert.equal(isOrderDeletable({ role: "admin", status: "draft", paymentCount: 0, commissionStatuses: [] }), false);
  assert.equal(isOrderDeletable({ role: "sales_rep", status: "void", paymentCount: 0, commissionStatuses: [] }), false);
  assert.equal(isOrderDeletable({ role: null, status: "draft", paymentCount: 0, commissionStatuses: [] }), false);
});

test("eligibility: only Draft or Void — Sent/Partial/Paid are never deletable", () => {
  for (const status of ["sent", "partial", "paid"]) {
    assert.equal(isOrderDeletable({ role: "owner", status, paymentCount: 0, commissionStatuses: [] }), false, status);
  }
});

test("eligibility: any payment history blocks deletion", () => {
  assert.equal(isOrderDeletable({ role: "owner", status: "void", paymentCount: 1, commissionStatuses: [] }), false);
});

test("eligibility: retained (paid/approved/earned) commission blocks; pending/void do not", () => {
  assert.equal(isOrderDeletable({ role: "owner", status: "void", paymentCount: 0, commissionStatuses: ["paid"] }), false);
  assert.equal(isOrderDeletable({ role: "owner", status: "void", paymentCount: 0, commissionStatuses: ["approved"] }), false);
  assert.equal(isOrderDeletable({ role: "owner", status: "void", paymentCount: 0, commissionStatuses: ["earned"] }), false);
  assert.equal(isOrderDeletable({ role: "owner", status: "draft", paymentCount: 0, commissionStatuses: ["pending", "void"] }), true);
});
