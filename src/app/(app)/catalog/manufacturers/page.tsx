import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { ManufacturersManager } from "@/components/catalog/manufacturers-manager";
import { getCurrentUser } from "@/lib/auth";
import { getManufacturers } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Manufacturers" };
export const dynamic = "force-dynamic";

export default async function ManufacturersPage() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog");

  const manufacturers = await getManufacturers();

  return (
    <div className="space-y-6">
      <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>
      <PageHeader title="Manufacturers" description="Suppliers you purchase from. Used across the catalog and, later, purchasing." />
      <ManufacturersManager manufacturers={manufacturers} />
    </div>
  );
}
