import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

export const metadata: Metadata = { title: "Commissions" };

export default function CommissionsPage() {
  return (
    <>
      <PageHeader
        title="Commissions"
        description="Multiple recipients per order — internal reps and external referral partners — across all commission types."
      />
      <EmptyState
        icon={HandCoins}
        title="No commissions yet"
        description="Commissions arrive in milestone M5 — computed from each order's frozen economics, with an approve → paid workflow and owed/paid dashboards by rep and month."
      />
    </>
  );
}
