import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ManufacturerCostDetail } from "@/components/manufacturer-costs/manufacturer-cost-detail";
import { getCurrentUser } from "@/lib/auth";
import { getCatalogProducts } from "@/lib/catalog/queries";
import {
  getManufacturerDetail,
  getManufacturerProductCosts,
  getManufacturerCostBands,
  getManufacturerCostHistory,
  getManufacturerImportBatches,
} from "@/lib/manufacturer-costs/queries";

export const metadata: Metadata = { title: "Manufacturer" };
export const dynamic = "force-dynamic";

export default async function ManufacturerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog");
  const { id } = await params;

  const manufacturer = await getManufacturerDetail(id);
  if (!manufacturer) notFound();

  const [costs, bands, history, batches, products] = await Promise.all([
    getManufacturerProductCosts(id),
    getManufacturerCostBands(id),
    getManufacturerCostHistory(id),
    getManufacturerImportBatches(id),
    getCatalogProducts(),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/catalog/manufacturers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Manufacturers
      </Link>
      <PageHeader title={manufacturer.name} description="Products supplied, current manufacturer costs, quantity tiers, cost history, and cost-file imports." />
      <ManufacturerCostDetail
        manufacturer={manufacturer}
        costs={costs}
        bands={bands}
        history={history}
        batches={batches}
        activeProducts={products.filter((p) => p.status === "active").map((p) => ({ id: p.id, sku: p.sku, name: p.name }))}
      />
    </div>
  );
}
