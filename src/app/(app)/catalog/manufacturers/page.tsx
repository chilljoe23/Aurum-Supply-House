import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ManufacturersManager } from "@/components/catalog/manufacturers-manager";
import { getCurrentUser } from "@/lib/auth";
import { getManufacturers } from "@/lib/catalog/queries";
import { getManufacturerCostStats } from "@/lib/manufacturer-costs/queries";

export const metadata: Metadata = { title: "Manufacturers" };
export const dynamic = "force-dynamic";

export default async function ManufacturersPage() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog");

  const [manufacturers, stats] = await Promise.all([getManufacturers(), getManufacturerCostStats()]);
  const withStats = manufacturers.map((m) => ({
    ...m,
    products_supplied: stats.get(m.id)?.products_supplied ?? 0,
    last_cost_update: stats.get(m.id)?.last_cost_update ?? null,
  }));

  return (
    <div className="space-y-6">
      <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>
      <PageHeader title="Manufacturers" description="Suppliers you purchase from. Upload manufacturer-specific cost files and manage per-manufacturer product costs here." />
      <ManufacturersManager manufacturers={withStats} />
    </div>
  );
}
