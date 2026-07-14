import type { Metadata } from "next";
import {
  DollarSign,
  TrendingUp,
  Wallet,
  FileClock,
  HandCoins,
  Factory,
  Users,
  Package,
  Activity,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Command Center" };

const KPIS = [
  { label: "Revenue", icon: DollarSign, hint: "Month to date" },
  { label: "Gross Profit", icon: TrendingUp, hint: "Month to date" },
  { label: "Net Profit", icon: Wallet, hint: "After commissions & expenses" },
  { label: "Outstanding Invoices", icon: FileClock, hint: "Awaiting payment" },
  { label: "Commission Owed", icon: HandCoins, hint: "Pending & approved" },
  { label: "Open Purchase Orders", icon: Factory, hint: "In flight" },
];

export default function CommandCenterPage() {
  return (
    <>
      <PageHeader
        title="Command Center"
        description="Everything glanceable. Metrics populate as Orders, Purchasing and Commissions come online."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPIS.map((k) => (
          <KpiCard key={k.label} label={k.label} icon={k.icon} hint={k.hint} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Activity}
              title="No sales yet"
              description="Your monthly revenue and profit trend appears here once the first orders are issued."
              className="border-0 bg-transparent py-10"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Activity}
              title="Nothing to show"
              description="Invoices sent, payments recorded and PO updates will stream here."
              className="border-0 bg-transparent py-10"
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Customers</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Users}
              title="No customers yet"
              description="Ranked by profit generated, once clients and orders exist."
              className="border-0 bg-transparent py-10"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Ranked by gross profit, once the catalog and orders exist."
              className="border-0 bg-transparent py-10"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
