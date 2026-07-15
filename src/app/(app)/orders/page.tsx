import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { OrdersManager } from "@/components/orders/orders-manager";
import { getOrdersList } from "@/lib/orders/queries";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const [user, orders] = await Promise.all([getCurrentUser(), getOrdersList()]);
  const canSeeInternal = user?.role === "owner" || user?.role === "admin";

  return (
    <>
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
      <OrdersManager orders={orders} canSeeInternal={!!canSeeInternal} />
    </>
  );
}
