import type { Metadata } from "next";
import { Factory, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Purchasing" };

export default function PurchasingPage() {
  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Manufacturer purchase orders — a ten-stage lifecycle, attachments, and a manufacturer payment ledger."
        actions={
          <Button disabled>
            <Plus className="h-4 w-4" />
            New purchase order
          </Button>
        }
      />
      <EmptyState
        icon={Factory}
        title="No purchase orders yet"
        description="Purchasing arrives in milestone M6 — with deposits/balance/refund tracking separate from status, so every PO shows total, paid, and remaining at a glance."
      />
    </>
  );
}
