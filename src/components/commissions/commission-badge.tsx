import { Badge } from "@/components/ui/badge";
import { COMMISSION_STATUS_LABELS } from "@/lib/commissions/schemas";

// Lifecycle: pending → earned → approved → paid, or void.
const VARIANT: Record<string, "default" | "outline" | "success" | "warning" | "destructive"> = {
  pending: "outline",
  earned: "warning",
  approved: "default",
  paid: "success",
  void: "destructive",
};

export function CommissionStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? "outline"}>{COMMISSION_STATUS_LABELS[status] ?? status}</Badge>;
}
