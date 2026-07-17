import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Wallet, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { OrdersManager } from "@/components/orders/orders-manager";
import { getOrdersList, getOrderFulfillmentSummaryMap } from "@/lib/orders/queries";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const [{ deleted }, user, orders, fulfillmentMap] = await Promise.all([
    searchParams,
    getCurrentUser(),
    getOrdersList(),
    getOrderFulfillmentSummaryMap(),
  ]);
  const canSeeInternal = user?.role === "owner" || user?.role === "admin";
  // Fulfillment is a distinct axis from payment status — merge it onto each row.
  const enriched = orders.map((o) => ({ ...o, fulfillment_status: fulfillmentMap.get(o.id) ?? null }));

  return (
    <>
      {deleted && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Order permanently deleted. Any issued invoice number remains retired and will never be reused.
        </div>
      )}
      <PageHeader
        title="Orders"
        description="Build orders and issue branded invoices — with live profit, immutable snapshots, and customer payments."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/orders/receivables">
                <Wallet className="h-4 w-4" /> Receivables
              </Link>
            </Button>
            <Button asChild>
              <Link href="/orders/new">
                <Plus className="h-4 w-4" /> New order
              </Link>
            </Button>
          </>
        }
      />
      <OrdersManager orders={enriched} canSeeInternal={!!canSeeInternal} />
    </>
  );
}
