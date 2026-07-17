import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getPurchaseOrdersList } from "@/lib/purchase-orders/queries";
import { PurchasingManager } from "@/components/purchasing/purchasing-manager";
import { RestrictedNotice } from "@/components/purchasing/restricted-notice";

export const metadata: Metadata = { title: "Purchasing" };
export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Manufacturer purchase orders — a ten-stage lifecycle, private attachments, and a manufacturer payment ledger."
        actions={
          isAdmin ? (
            <Button asChild>
              <Link href="/purchasing/new"><Plus className="h-4 w-4" /> New purchase order</Link>
            </Button>
          ) : null
        }
      />
      {isAdmin ? <PurchasingManager orders={await getPurchaseOrdersList()} /> : <RestrictedNotice />}
    </>
  );
}
