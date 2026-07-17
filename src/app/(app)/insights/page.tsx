import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { getCurrentUser } from "@/lib/auth";
import { getInsightsData } from "@/lib/insights/queries";
import { InsightsManager } from "@/components/insights/insights-manager";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getInsightsData(user);

  return (
    <>
      <PageHeader
        title="Insights"
        description={
          data.canSeeInternal
            ? "Revenue, gross & net profit, sales & profit by client / product / rep, receivables, commissions and purchase spend — from the same immutable snapshots as your orders."
            : "Your revenue, sales by client and product, receivables, commissions and quote conversion — from the same immutable snapshots as your orders."
        }
      />
      <InsightsManager data={data} />
    </>
  );
}
