import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Defense in depth: the nav hides Settings for reps; this also blocks a direct visit.
  const user = await getCurrentUser();
  if (!user || user.role === "sales_rep") {
    redirect("/command-center");
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company profile, branding, numbering, tax defaults, and team roles."
      />
      <EmptyState
        icon={SlidersHorizontal}
        title="Settings arrive alongside the modules"
        description="Company details and PDF branding are configured here as Purchasing and Orders come online. Only Owners and Admins can reach this section."
      />
    </>
  );
}
