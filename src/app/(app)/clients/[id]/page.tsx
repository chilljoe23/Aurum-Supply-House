import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, ShoppingCart, Wallet, TrendingUp, HandCoins, FileText, Package, Clock, Building2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/patterns/kpi-card";
import { ClientPricingPanel } from "@/components/clients/client-pricing-panel";
import { ClientActions } from "@/components/clients/client-actions";
import { getCurrentUser } from "@/lib/auth";
import { getClientOverrides, getClientAssignments, getPricingModels } from "@/lib/pricing/queries";
import { getCatalogProducts } from "@/lib/catalog/queries";
import {
  getClientDetail, getActiveReps, getClientInvoices, getClientPurchaseSummary,
  getClientProfit, getClientCommissions, getClientProducts, getClientTimeline,
  type Address,
} from "@/lib/clients/queries";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Client" };
export const dynamic = "force-dynamic";

const TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on receipt", net_15: "Net 15", net_30: "Net 30",
  net_45: "Net 45", net_60: "Net 60", custom: "Custom",
};

function formatAddress(a: Address): string[] {
  const l1 = [a.line1, a.line2].filter(Boolean).join(", ");
  const l2 = [a.city, a.region, a.postal_code].filter(Boolean).join(" ");
  return [l1, l2, a.country ?? ""].map((s) => (s ?? "").trim()).filter(Boolean);
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "success" : status === "prospect" ? "warning" : "outline";
  return <Badge variant={variant}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, client] = await Promise.all([getCurrentUser(), getClientDetail(id)]);
  if (!client) notFound();
  const canManage = user?.role === "owner" || user?.role === "admin";

  const [
    overrides, assignments, models, products, reps,
    invoices, summary, profit, commissions, purchased, timeline,
  ] = await Promise.all([
    getClientOverrides(id),
    getClientAssignments(id),
    getPricingModels(),
    getCatalogProducts(),
    canManage ? getActiveReps() : Promise.resolve([]),
    getClientInvoices(id),
    getClientPurchaseSummary(id),
    canManage ? getClientProfit(id) : Promise.resolve(null),
    canManage ? getClientCommissions(id) : Promise.resolve(null),
    getClientProducts(id),
    getClientTimeline(id),
  ]);

  const modelOptions = models.map((m) => ({ id: m.id, name: m.name, code: m.code, currency: m.currency }));
  const billing = formatAddress(client.billing_address);
  const shipping = formatAddress(client.shipping_address);

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{client.company_name}</h1>
          <StatusBadge status={client.status} />
        </div>
        <ClientActions client={client} reps={reps} models={modelOptions} canAssignRep={!!canManage} />
      </div>

      {/* Derived KPIs — real numbers only; zero until M4 issues invoices. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Lifetime purchases" value={formatCurrency(summary.lifetime_total)} hint={`${summary.order_count} order${summary.order_count === 1 ? "" : "s"}`} icon={ShoppingCart} />
        <KpiCard label="Outstanding balance" value={formatCurrency(summary.outstanding_balance)} hint={summary.last_order_date ? `Last order ${new Date(summary.last_order_date).toLocaleDateString()}` : "No orders yet"} icon={Wallet} />
        {canManage ? (
          <>
            <KpiCard label="Profit generated" value={formatCurrency(profit?.gross_profit ?? 0)} hint={`Net ${formatCurrency(profit?.net_profit ?? 0)}`} icon={TrendingUp} />
            <KpiCard label="Commission paid" value={formatCurrency(commissions?.paid ?? 0)} hint={`Owed ${formatCurrency(commissions?.owed ?? 0)}`} icon={HandCoins} />
          </>
        ) : (
          <>
            <KpiCard label="Products purchased" value={String(purchased.length)} hint="Distinct SKUs" icon={Package} />
            <KpiCard label="Invoices" value={String(invoices.length)} hint="On record" icon={FileText} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: pricing (M2, preserved) + transactional panels */}
        <div className="space-y-6 lg:col-span-2">
          <ClientPricingPanel
            clientId={client.id}
            modelName={client.pricing_model_name}
            modelId={client.default_pricing_sheet_id}
            models={modelOptions}
            products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))}
            overrides={overrides as never}
            assignments={assignments as never}
            canManage={!!canManage}
          />

          {/* Invoices */}
          <Card>
            <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <EmptyPanel icon={FileText} text="No invoices yet. Invoicing begins in M4 — Orders & Invoices." />
              ) : (
                <div className="space-y-0">
                  {invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0">
                      <div>
                        <span className="font-mono text-xs">{inv.invoice_number}</span>
                        <span className="ml-2 text-muted-foreground">{new Date(inv.issue_date ?? inv.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{inv.status}</Badge>
                        <span className="tabular-nums">{formatCurrency(inv.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Products purchased */}
          <Card>
            <CardHeader><CardTitle>Products purchased</CardTitle></CardHeader>
            <CardContent>
              {purchased.length === 0 ? (
                <EmptyPanel icon={Package} text="No purchase history yet. Populated from invoice line items in M4." />
              ) : (
                <div className="space-y-0">
                  {purchased.map((p) => (
                    <div key={p.sku} className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0">
                      <div><span className="font-mono text-xs">{p.sku}</span> <span>{p.product_name}</span></div>
                      <div className="flex items-center gap-4 text-muted-foreground">
                        <span>{p.units} units</span>
                        <span className="tabular-nums text-foreground">{formatCurrency(p.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: client information + addresses + timeline */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Client information</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Field label="Primary contact" value={client.primary_contact_name} />
              <Field label="Email" value={client.email} />
              <Field label="Phone" value={client.phone} />
              <Field label="Representative" value={client.assigned_rep_name ?? "— unassigned —"} />
              <Field label="Pricing model" value={client.pricing_model_name ?? "— default —"} />
              <Field label="Payment terms" value={TERM_LABELS[client.payment_terms] ?? client.payment_terms} />
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={client.status} />
              </div>
              {client.notes && (
                <div className="border-t border-border pt-2.5">
                  <span className="text-muted-foreground">Notes</span>
                  <p className="mt-1 whitespace-pre-wrap">{client.notes}</p>
                </div>
              )}
              <div className="border-t border-border pt-2.5 text-xs text-muted-foreground">
                Created {new Date(client.created_at).toLocaleDateString()} · Updated {new Date(client.updated_at).toLocaleDateString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Addresses</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Billing</div>
                {billing.length ? billing.map((l, i) => <div key={i}>{l}</div>) : <span className="text-muted-foreground">—</span>}
              </div>
              <div className="border-t border-border pt-3">
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Shipping</div>
                {shipping.length ? shipping.map((l, i) => <div key={i}>{l}</div>) : <span className="text-muted-foreground">—</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <EmptyPanel icon={Clock} text="No activity recorded yet." />
              ) : (
                <ul className="space-y-3">
                  {timeline.map((t) => (
                    <li key={t.id} className="flex gap-3 text-sm">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <div>{t.summary ?? t.action}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(t.created_at).toLocaleString()}{t.actor_name ? ` · ${t.actor_name}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value || "—"}</span>
    </div>
  );
}

function EmptyPanel({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon className="h-5 w-5 text-muted-foreground/60" />
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
