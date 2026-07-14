import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { PricingImportWizard } from "@/components/pricing/import/pricing-import-wizard";
import { getCurrentUser } from "@/lib/auth";
import { getPricingModels } from "@/lib/pricing/queries";
import { getCatalogProducts } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Import Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingImportPage() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/pricing");

  const [models, products] = await Promise.all([getPricingModels(), getCatalogProducts()]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Link href="/pricing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Pricing</Link>
      <PageHeader title="Import pricing sheet" description="Reuses the catalog import pipeline: map, validate, classify, then import atomically. Unknown SKUs are never created here." />
      <PricingImportWizard models={models} knownSkus={products.map((p) => p.sku)} today={today} />
    </div>
  );
}
