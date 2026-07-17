import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/patterns/page-header";
import { getCompanySettings } from "@/lib/settings/queries";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Defense in depth: the nav hides Settings for reps; this also blocks a direct visit.
  const user = await getCurrentUser();
  if (!user || user.role === "sales_rep") {
    redirect("/command-center");
  }
  const settings = await getCompanySettings();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company profile, invoice branding, numbering, tax defaults, and payment instructions."
      />
      {/* Admins can view; only the Owner may edit (enforced in the action + RLS). */}
      <CompanySettingsForm settings={settings} readOnly={user.role !== "owner"} />
    </>
  );
}
