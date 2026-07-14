import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { PricingTable } from "@/components/pricing/pricing-table";
import { getPricingModels } from "@/lib/pricing/queries";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [user, models] = await Promise.all([getCurrentUser(), getPricingModels()]);
  const canManage = user?.role === "owner" || user?.role === "admin";
  return (
    <>
      <PageHeader
        title="Pricing"
        description="Reusable pricing models with quantity tiers, per-client overrides, and deterministic resolution."
      />
      <PricingTable models={models} canManage={!!canManage} />
    </>
  );
}
