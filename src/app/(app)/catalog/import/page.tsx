import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "@/components/catalog/import/import-wizard";
import { getCurrentUser } from "@/lib/auth";
import { getCatalogProducts } from "@/lib/catalog/queries";
import type { ExistingProduct } from "@/lib/catalog/classify";

export const metadata: Metadata = { title: "Import Catalog" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) {
    redirect("/catalog");
  }

  const products = await getCatalogProducts();
  const existing: ExistingProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    strength: p.strength,
    product_form: p.product_form,
    pack_size: p.pack_size,
    unit_of_measure: p.unit_of_measure,
    manufacturer_sku: p.manufacturer_sku,
    category: p.category,
    moq: p.moq,
    lead_time_days: p.lead_time_days,
    notes: p.notes,
    current_true_cost: p.true_cost,
    status: p.status,
  }));

  return (
    <div className="space-y-6">
      <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>
      <PageHeader
        title="Import catalog"
        description="Upload a manufacturer spreadsheet, map columns, preview and validate, then import. Historical invoices and costs are never overwritten."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/catalog/imports">Import history</Link>
          </Button>
        }
      />
      <ImportWizard existing={existing} />
    </div>
  );
}
