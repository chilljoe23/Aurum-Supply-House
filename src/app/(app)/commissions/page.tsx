import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { CommissionsManager } from "@/components/commissions/commissions-manager";
import { getCurrentUser } from "@/lib/auth";
import { getCommissionsList, getCommissionSummary } from "@/lib/commissions/queries";

export const metadata: Metadata = { title: "Commissions" };
export const dynamic = "force-dynamic";

export default async function CommissionsPage() {
  const [user, commissions, summary] = await Promise.all([
    getCurrentUser(),
    getCommissionsList(),
    getCommissionSummary(),
  ]);
  const canManage = user?.role === "owner" || user?.role === "admin";

  return (
    <>
      <PageHeader
        title="Commissions"
        description={
          canManage
            ? "Every recipient across all orders — internal reps and external partners. Approve earned commissions and record payments."
            : "Your commissions across all orders, with live status from pending to paid."
        }
      />
      <CommissionsManager commissions={commissions} summary={summary} canManage={!!canManage} />
    </>
  );
}
