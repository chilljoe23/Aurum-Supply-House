import { Badge } from "@/components/ui/badge";
import { PO_STATUS_LABELS, poStatusVariant, type PoStatus } from "@/lib/purchase-orders/status";

export function PoStatusBadge({ status }: { status: string }) {
  const label = PO_STATUS_LABELS[status as PoStatus] ?? status;
  return <Badge variant={poStatusVariant(status)}>{label}</Badge>;
}
