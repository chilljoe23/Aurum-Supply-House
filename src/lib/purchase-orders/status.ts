// ============================================================================
// Aurum Supply House — purchase-order lifecycle (client + server safe).
// Mirrors the DB state machine in app.enforce_po_transition (migration 0320):
// forward-stepwise, with void allowed only from pre-receipt states.
// ============================================================================

export const PO_STATUSES = [
  "draft",
  "sent",
  "confirmed",
  "deposit_paid",
  "production",
  "testing",
  "ready_to_ship",
  "shipped",
  "received",
  "closed",
  "void",
] as const;

export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  deposit_paid: "Deposit paid",
  production: "Production",
  testing: "Testing",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  received: "Received",
  closed: "Closed",
  void: "Void",
};

// The forward moves an operator can pick from the detail page (void handled
// separately as a reason-required action). Matches the DB transition guard.
const FORWARD: Record<PoStatus, PoStatus[]> = {
  draft: [], // draft → sent is the "Send PO" action, not a status pick
  sent: ["confirmed"],
  confirmed: ["deposit_paid", "production"],
  deposit_paid: ["production"],
  production: ["testing"],
  testing: ["ready_to_ship"],
  ready_to_ship: ["shipped"],
  shipped: ["received"],
  received: ["closed"],
  closed: [],
  void: [],
};

export function nextStatuses(current: PoStatus): PoStatus[] {
  return FORWARD[current] ?? [];
}

// Void is permitted only before goods are received.
export function canVoid(current: PoStatus): boolean {
  return !["draft", "received", "closed", "void"].includes(current);
}

export function canRecordPayment(current: PoStatus): boolean {
  return !["draft", "void", "closed"].includes(current);
}

export function isTerminal(current: PoStatus): boolean {
  return current === "closed" || current === "void";
}

// Badge variant mapping (uses the shared ui/badge variants).
export function poStatusVariant(
  status: string,
): "default" | "outline" | "success" | "warning" | "destructive" {
  switch (status) {
    case "void":
      return "destructive";
    case "received":
    case "closed":
      return "success";
    case "draft":
      return "outline";
    case "deposit_paid":
    case "shipped":
      return "warning";
    default:
      return "default";
  }
}
