// ============================================================================
// Owner-only permanent-deletion — shared pure logic for the UI gate and the
// confirmation dialog. These mirror (but never replace) the authoritative
// server-side rules in app.hard_delete_order: the RPC re-verifies Owner status,
// Draft/Void state, no payment history, and no retained commission on every call.
// Keeping the predicates here as pure functions makes them unit-testable and
// keeps the button/dialog and the detail page in exact agreement.
// ============================================================================

// The exact word the Owner must type to arm the destructive action.
export const DELETE_CONFIRM_WORD = "DELETE";

// The confirm button stays disabled until BOTH are satisfied: the exact
// confirmation word AND a non-empty reason.
export function deletionConfirmed(confirmText: string, reason: string): boolean {
  return confirmText.trim() === DELETE_CONFIRM_WORD && reason.trim().length > 0;
}

export type DeletionEligibility = {
  role: string | null | undefined;
  status: string;
  paymentCount: number;
  commissionStatuses: string[];
};

// Commission states that represent confirmed / owed / paid money and therefore
// forbid permanent deletion (must be retained via Void). pending/void are safe.
const RETAINED_COMMISSION_STATUSES = new Set(["paid", "approved", "earned"]);

// Whether the "Delete order permanently" control should be offered at all.
// Owner only; Draft or Void only; no payment history; no retained commission.
export function isOrderDeletable({ role, status, paymentCount, commissionStatuses }: DeletionEligibility): boolean {
  if (role !== "owner") return false;
  if (status !== "draft" && status !== "void") return false;
  if (paymentCount > 0) return false;
  if (commissionStatuses.some((s) => RETAINED_COMMISSION_STATUSES.has(s))) return false;
  return true;
}
