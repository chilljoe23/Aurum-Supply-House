import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Issued",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const variant =
    status === "paid" ? "success" : status === "partial" ? "warning" : status === "void" ? "destructive" : status === "sent" ? "default" : "outline";
  return <Badge variant={variant}>{LABELS[status] ?? status}</Badge>;
}
