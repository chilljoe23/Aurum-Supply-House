import type { Metadata } from "next";
import Link from "next/link";
import { Factory } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { CatalogTable } from "@/components/catalog/catalog-table";
import { getCatalogProducts, getManufacturers } from "@/lib/catalog/queries";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [user, products, manufacturers] = await Promise.all([
    getCurrentUser(),
    getCatalogProducts(),
    getManufacturers(),
  ]);
  const canManage = user?.role === "owner" || user?.role === "admin";
  const canSeeCost = canManage;

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Your product master — searchable, filterable, and imported from manufacturer spreadsheets."
        actions={
          canManage ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/catalog/manufacturers"><Factory className="h-4 w-4" /> Manufacturers</Link>
            </Button>
          ) : undefined
        }
      />
      <CatalogTable
        products={products}
        manufacturers={manufacturers}
        canManage={!!canManage}
        canSeeCost={canSeeCost}
      />
    </>
  );
}
