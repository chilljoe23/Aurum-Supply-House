import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ArManager } from "@/components/ar/ar-manager";
import { getArAging, getArSummary } from "@/lib/ar/queries";

export const metadata: Metadata = { title: "Accounts Receivable" };
export const dynamic = "force-dynamic";

export default async function ReceivablesPage() {
  const [rows, summary] = await Promise.all([getArAging(), getArSummary()]);
  return (
    <>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>
      <PageHeader
        title="Accounts Receivable"
        description="Every issued invoice with an open balance, aged by due date. Void and fully-paid invoices are excluded."
      />
      <ArManager rows={rows} summary={summary} />
    </>
  );
}
