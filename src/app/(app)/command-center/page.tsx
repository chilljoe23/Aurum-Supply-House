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
  ClipboardList,
  Factory,
  Send,
  Percent,
  BarChart3,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getCommandCenterMetrics, getRecentActivity } from "@/lib/dashboard/queries";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

const monthLabel = new Date().toLocaleDateString("en-US", { month: "long" });

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function CommandCenterPage() {
  const user = await getCurrentUser();
  const canSeeInternal = user?.role === "owner" || user?.role === "admin";
  const [metrics, activity] = await Promise.all([
    getCommandCenterMetrics(canSeeInternal),
    getRecentActivity(12),
  ]);

  return (
    <>
      <PageHeader
        title="Command Center"
        description={
          canSeeInternal
            ? "Everything glanceable, from real records."
            : "Your book at a glance, from real records."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/insights">
              <BarChart3 className="mr-2 h-4 w-4" /> Open Insights
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Revenue" value={formatCurrency(metrics.revenueMtd)} icon={DollarSign} hint={`${monthLabel} to date`} />

        {canSeeInternal && (
          <>
            <KpiCard
              label="Gross Profit"
              value={metrics.grossProfitMtd == null ? undefined : formatCurrency(metrics.grossProfitMtd)}
              icon={TrendingUp}
              hint={`${monthLabel} · net sales − true cost`}
            />
            <KpiCard
              label="Net Profit"
              value={metrics.netProfitMtd == null ? undefined : formatCurrency(metrics.netProfitMtd)}
              icon={TrendingUp}
              hint={`${monthLabel} · after commissions & expenses`}
            />
          </>
        )}

        <Link href="/orders/receivables" className="contents">
          <KpiCard
            label="Outstanding Receivables"
            value={formatCurrency(metrics.outstanding)}
            icon={Wallet}
            hint={`${metrics.openInvoiceCount} open invoice${metrics.openInvoiceCount === 1 ? "" : "s"}`}
          />
        </Link>
        <Link href="/orders/receivables" className="contents">
          <KpiCard label="Overdue Receivables" value={formatCurrency(metrics.overdue)} icon={AlertTriangle} hint="Past due date" />
        </Link>

        <Link href="/commissions" className="contents">
          <KpiCard label="Commission Owed" value={formatCurrency(metrics.commissionOwed)} icon={HandCoins} hint="Earned & approved" />
        </Link>
        <Link href="/commissions" className="contents">
          <KpiCard label="Commission Paid" value={formatCurrency(metrics.commissionPaidMtd)} icon={Coins} hint={`${monthLabel} to date`} />
        </Link>

        {!canSeeInternal && (
          <Link href="/clients" className="contents">
            <KpiCard label="Active Clients" value={String(metrics.activeClients)} icon={Users} hint="In your book" />
          </Link>
        )}

        {canSeeInternal && (
          <>
            <Link href="/purchasing" className="contents">
              <KpiCard label="Open Purchase Orders" value={String(metrics.openPoCount ?? 0)} icon={ClipboardList} hint="Issued, not yet closed" />
            </Link>
            <KpiCard label="Manufacturer Spend" value={formatCurrency(metrics.manufacturerSpendMtd ?? 0)} icon={Factory} hint={`${monthLabel} · paid to manufacturers`} />
          </>
        )}

        <Link href="/quotes" className="contents">
          <KpiCard label="Draft Quotes" value={String(metrics.draftQuotes)} icon={FileClock} hint="Not yet sent" />
        </Link>
        <Link href="/quotes" className="contents">
          <KpiCard label="Sent Quotes" value={String(metrics.sentQuotes)} icon={Send} hint="Awaiting the customer" />
        </Link>
        <Link href="/quotes" className="contents">
          <KpiCard label="Quote Conversion" value={formatPercent(metrics.quoteConversionRate)} icon={Percent} hint="Converted ÷ quotes sent" />
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
            <CardTitle>Full Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={BarChart3}
              title="Insights"
              description={
                canSeeInternal
                  ? "Revenue, gross & net profit over time, profit by client / product / rep, purchase spend, receivables and commissions — with date filters and CSV export."
                  : "Your revenue over time, sales by client and product, receivables, commissions and quote conversion — with date filters and CSV export."
              }
              action={
                <Button asChild size="sm">
                  <Link href="/insights">
                    <BarChart3 className="mr-2 h-4 w-4" /> Open Insights
                  </Link>
                </Button>
              }
              className="border-0 bg-transparent py-8"
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link href="/insights" className="contents">
          <Card className="transition-colors hover:border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Top Clients
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {canSeeInternal ? "Ranked by revenue and profit — open Insights." : "Ranked by revenue — open Insights."}
            </CardContent>
          </Card>
        </Link>
        <Link href="/insights" className="contents">
          <Card className="transition-colors hover:border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" /> Top Products
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {canSeeInternal ? "Ranked by revenue and gross profit — open Insights." : "Ranked by revenue — open Insights."}
            </CardContent>
          </Card>
        </Link>
      </div>
    </>
  );
}
