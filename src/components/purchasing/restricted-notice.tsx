import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";

export function RestrictedNotice() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Purchasing is Owner/Admin only"
      description="Purchase orders carry manufacturer cost data and are restricted to Owners and Admins. Ask an administrator if you need access."
    />
  );
}
