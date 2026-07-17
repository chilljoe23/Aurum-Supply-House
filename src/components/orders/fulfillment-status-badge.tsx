import { Badge } from "@/components/ui/badge";
import {
  LINE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  lineStatusVariant,
  orderStatusVariant,
  type LineStatus,
  type OrderFulfillmentStatus,
} from "@/lib/orders/fulfillment";

// Restrained fulfillment badges in the Aurum cream/navy/muted-sage system. Kept
// visually distinct from the financial OrderStatusBadge so payment status and
// fulfillment status never read as the same thing.

export function LineFulfillmentBadge({ status }: { status: string }) {
  const label = LINE_STATUS_LABELS[status as LineStatus] ?? status;
  return <Badge variant={lineStatusVariant(status)}>{label}</Badge>;
}

export function OrderFulfillmentBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const label = ORDER_STATUS_LABELS[status as OrderFulfillmentStatus] ?? status;
  return (
    <Badge variant={orderStatusVariant(status)} className="gap-1">
      {!compact && <span className="text-[10px] uppercase tracking-wide opacity-70">Fulfillment</span>}
      {label}
    </Badge>
  );
}
