import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
  void: "Void",
};

export function QuoteStatusBadge({ status, isExpired }: { status: string; isExpired?: boolean }) {
  // A sent quote past its expiration date reads as expired until the sweep runs.
  if (isExpired && status === "sent") {
    return <Badge variant="warning">Expired</Badge>;
  }
  const variant =
    status === "accepted" || status === "converted"
      ? "success"
      : status === "declined" || status === "void"
        ? "destructive"
        : status === "expired"
          ? "warning"
          : status === "sent"
            ? "default"
            : "outline";
  return <Badge variant={variant}>{LABELS[status] ?? status}</Badge>;
}
