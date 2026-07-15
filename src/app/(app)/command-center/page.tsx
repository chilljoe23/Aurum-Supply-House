import type { Metadata } from "next";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  Wallet,
  FileClock,
  HandCoins,
  Coins,
  AlertTriangle,
  Activity,
  Users,
  Package,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getCommandCenterMetrics, getRecentActivity } from "@/lib/dashboard/queries";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

const monthLabel = new Date().toLocaleDateString("en-US", { month: "long" });

export default async function CommandCenterPage() {
  const [user, metrics, activity] = await Promise.all([
    getCurrentUser(),
    getCommandCenterMetrics(),
    getRecentActivity(12),
  ]);
  const canSeeInternal = user?.role === "owner" || user?.role === "admin";

  return (
    <>
      <PageHeader
        title="Command Center"
        description={canSeeInternal ? "Everything glanceable, from real records." : "Your book at a glance, from real records."}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Revenue" value={formatCurrency(metrics.revenueMtd)} icon={DollarSign} hint={`${monthLabel} to date`} />
        {canSeeInternal ? (
          <KpiCard label="Net Profit" value={formatCurrency(metrics.netProfitMtd ?? 0)} icon={TrendingUp} hint={`${monthLabel} · after commissions & expenses`} />
        ) : (
          <KpiCard label="Open Invoices" value={String(metrics.openInvoiceCount)} icon={FileClock} hint="Awaiting payment" />
        )}
        <Link href="/orders/receivables" className="contents">
          <KpiCard label="Outstanding Receivables" value={formatCurrency(metrics.outstanding)} icon={Wallet} hint={`${metrics.openInvoiceCount} open invoice${metrics.openInvoiceCount === 1 ? "" : "s"}`} />
        </Link>
        <Link href="/orders/receivables" className="contents">
          <KpiCard label="Overdue Receivables" value={formatCurrency(metrics.overdue)} icon={AlertTriangle} hint="Past due date" />
        </Link>
        <Link href="/commissions" className="contents">
          <KpiCard label="Commission Owed" value={formatCurrency(metrics.commissionOwed)} icon={HandCoins} hint="Earned & approved" />
        </Link>
        <Link href="/commissions" className="contents">
          <KpiCard label="Commission Paid" value={formatCurrency(metrics.commissionPaidThisMonth)} icon={Coins} hint={`${monthLabel} to date`} />
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Nothing yet"
                description="Invoices issued, payments recorded, and commission events stream here."
                className="border-0 bg-transparent py-10"
              />
            ) : (
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <div>{a.summary ?? a.action}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                        {a.actor_name ? ` · ${a.actor_name}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Activity}
              title="Trends arrive in M7"
              description="Revenue and profit trends, top customers and top products land with Insights (M7) — from these same records."
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
            <EmptyState icon={Users} title="Arrives with Insights (M7)" description="Ranked by profit generated." className="border-0 bg-transparent py-10" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Package} title="Arrives with Insights (M7)" description="Ranked by gross profit." className="border-0 bg-transparent py-10" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
