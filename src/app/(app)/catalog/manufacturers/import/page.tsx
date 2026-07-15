import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ManufacturerCostImportWizard } from "@/components/manufacturer-costs/manufacturer-cost-import-wizard";
import { getCurrentUser } from "@/lib/auth";
import { getManufacturers, getCatalogProducts } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Import Manufacturer Costs" };
export const dynamic = "force-dynamic";

export default async function ManufacturerCostImportPage({
  searchParams,
}: {
  searchParams: Promise<{ manufacturer?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog/manufacturers");

  const [manufacturers, products] = await Promise.all([getManufacturers(), getCatalogProducts()]);
  const { manufacturer } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Link href="/catalog/manufacturers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Manufacturers</Link>
      <PageHeader title="Import manufacturer cost file" description="Reuses the catalog import pipeline: map, validate, classify, then import atomically. Products are matched by SKU; unknown SKUs and catalog products are never created here." />
      <ManufacturerCostImportWizard
        manufacturers={manufacturers.map((m) => ({ id: m.id, name: m.name, status: m.status, default_currency: m.default_currency }))}
        knownSkus={products.map((p) => p.sku)}
        today={today}
        preselectedManufacturerId={manufacturer}
      />
    </div>
  );
}
