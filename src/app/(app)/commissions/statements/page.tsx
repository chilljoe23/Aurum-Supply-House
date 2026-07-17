import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { StatementBuilder } from "@/components/commissions/statement-builder";
import { getCommissionsList } from "@/lib/commissions/queries";

export const metadata: Metadata = { title: "Commission Statements" };
export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  const commissions = await getCommissionsList();

  return (
    <>
      <Link href="/commissions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Commissions
      </Link>
      <PageHeader
        title="Commission Statements"
        description="Generate a printable statement for any recipient — internal user or external partner. Statements show commissions only; no client cost or profit ever appears."
      />
      <StatementBuilder commissions={commissions} />
    </>
  );
}
