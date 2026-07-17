// ============================================================================
// Aurum Supply House — fulfillment status vocabulary + derivation (pure).
// ----------------------------------------------------------------------------
// The single source of truth for fulfillment status LABELS, badge variants, and
// the DERIVATION rules — a faithful TypeScript mirror of the SQL in
// supabase/migrations/0398_fulfillment_views.sql. Quantities are authoritative:
// "Partially shipped" and "Shipped" are derived here and in SQL, never selected
// by hand. Kept dependency-free so it is unit-testable with node:test.
// ============================================================================

// The manually settable operational statuses (a Line's editable state).
export const OPERATIONAL_STATUSES = [
  "not_yet_shipped",
  "in_production",
  "ready_to_ship",
  "backordered",
  "cancelled",
] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

// The full derived per-line status set (superset of operational + two derived).
export type LineStatus =
  | OperationalStatus
  | "partially_shipped"
  | "shipped";

export type OrderFulfillmentStatus =
  | "not_started"
  | "in_progress"
  | "partially_shipped"
  | "fully_shipped"
  | "cancelled";

export const OPERATIONAL_LABELS: Record<OperationalStatus, string> = {
  not_yet_shipped: "Not yet shipped",
  in_production: "In production",
  ready_to_ship: "Ready to ship",
  backordered: "Backordered",
  cancelled: "Cancelled",
};

export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  not_yet_shipped: "Not yet shipped",
  in_production: "In production",
  ready_to_ship: "Ready to ship",
  partially_shipped: "Partially shipped",
  shipped: "Shipped",
  backordered: "Backordered",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_LABELS: Record<OrderFulfillmentStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  partially_shipped: "Partially shipped",
  fully_shipped: "Fully shipped",
  cancelled: "Cancelled",
};

// Restrained badge variants keyed to the Aurum system (navy default, muted-sage
// success, soft-amber warning, muted terracotta destructive, outline neutral).
type Variant = "default" | "success" | "warning" | "destructive" | "outline";

export function lineStatusVariant(status: string): Variant {
  switch (status) {
    case "shipped":
      return "success";
    case "partially_shipped":
    case "ready_to_ship":
      return "warning";
    case "in_production":
    case "backordered":
      return "default";
    case "cancelled":
      return "destructive";
    default:
      return "outline"; // not_yet_shipped
  }
}

export function orderStatusVariant(status: string): Variant {
  switch (status) {
    case "fully_shipped":
      return "success";
    case "partially_shipped":
      return "warning";
    case "in_progress":
      return "default";
    case "cancelled":
      return "destructive";
    default:
      return "outline"; // not_started
  }
}

// A line status is manually selectable only when nothing has shipped and it is
// not a derived state. Once quantity has shipped, the state is derived.
export function isManuallySelectable(status: string): status is OperationalStatus {
  return (OPERATIONAL_STATUSES as readonly string[]).includes(status);
}

// ---- Derivation (mirrors 0398 exactly) --------------------------------------

export type LineFacts = {
  operationalStatus: OperationalStatus;
  quantityOrdered: number;
  quantityShipped: number;
};

// Per-line derived status. shipped==0 → operational; 0<shipped<ordered →
// partially_shipped; shipped>=ordered → shipped.
export function deriveLineStatus(l: LineFacts): LineStatus {
  const shipped = Number(l.quantityShipped) || 0;
  const ordered = Number(l.quantityOrdered) || 0;
  if (shipped <= 0) return l.operationalStatus;
  if (shipped >= ordered) return "shipped";
  return "partially_shipped";
}

// Per-order derived summary from the set of line facts.
export function deriveOrderStatus(lines: LineFacts[]): OrderFulfillmentStatus {
  const n = lines.length;
  if (n === 0) return "not_started";

  let cancelledLines = 0;
  let shippedLines = 0;
  let partiallyLines = 0;
  let activeLines = 0;
  let totalShipped = 0;
  let shippableRemaining = 0;

  for (const l of lines) {
    const ordered = Number(l.quantityOrdered) || 0;
    const shipped = Number(l.quantityShipped) || 0;
    const status = deriveLineStatus(l);
    totalShipped += shipped;
    if (l.operationalStatus !== "cancelled") {
      shippableRemaining += Math.max(0, ordered - shipped);
    }
    if (status === "cancelled") cancelledLines += 1;
    else if (status === "shipped") shippedLines += 1;
    else if (status === "partially_shipped") partiallyLines += 1;
    else if (status === "in_production" || status === "ready_to_ship" || status === "backordered") activeLines += 1;
  }

  if (cancelledLines === n) return "cancelled";
  if (shippedLines === n - cancelledLines) return "fully_shipped";
  if (totalShipped > 0 && shippableRemaining > 0) return "partially_shipped";
  if (partiallyLines > 0 || activeLines > 0) return "in_progress";
  return "not_started";
}
