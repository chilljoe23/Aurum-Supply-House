import type { Metadata } from "next";
import { ReceiptText, Plus } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader
        title="Orders"
        description="Build orders and issue branded invoices — with live profit, immutable snapshots, and customer payments."
        actions={
          <Button disabled>
            <Plus className="h-4 w-4" />
            New order
          </Button>
        }
      />
      <EmptyState
        icon={ReceiptText}
        title="No orders yet"
        description="Orders — the core — arrive in milestone M4. Pricing resolves automatically, internal economics compute live, and every issued order is a permanent, tamper-proof snapshot."
      />
    </>
  );
}
