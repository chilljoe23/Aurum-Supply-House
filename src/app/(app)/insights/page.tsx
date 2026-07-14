import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <>
      <PageHeader
        title="Insights"
        description="Revenue, gross & net profit, profit by client / product / rep, purchase spend, and commission reports."
      />
      <EmptyState
        icon={BarChart3}
        title="No data to report yet"
        description="Insights arrive in milestone M7, reading the same immutable snapshots as your orders — so every report reconciles exactly. CSV export included."
      />
    </>
  );
}
