import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet, CreditCard, Scale, TrendingUp, Building2, Truck, Clock, History, Lock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/patterns/kpi-card";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { OrderActions } from "@/components/orders/order-actions";
import { ExpenseManager } from "@/components/orders/expense-manager";
import { getCurrentUser } from "@/lib/auth";
import { getOrderDetail } from "@/lib/orders/queries";
import { addressLines } from "@/lib/orders/invoice-view-model";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/orders/schemas";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const METHOD_LABELS = Object.fromEntries(PAYMENT_METHOD_OPTIONS.map((m) => [m.value, m.label]));
const SOURCE_LABELS: Record<string, string> = {
  client_override: "Client override",
  selected_model: "Selected model",
  assigned_model: "Assigned model",
  default_model: "Default model",
  manual: "Manual override",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, detail] = await Promise.all([getCurrentUser(), getOrderDetail(id)]);
  if (!detail) notFound();

  const { header: h, items, payments, expenses, statusHistory, activity } = detail;
  const canManage = user?.role === "owner" || user?.role === "admin";
  const canSeeInternal = h.can_see_internal;
  const c = h.currency;
  const snap = (h.client_snapshot ?? {}) as Record<string, unknown>;
  const billing = addressLines(snap.billing_address as Record<string, unknown> | null);
  const shipping = addressLines(snap.shipping_address as Record<string, unknown> | null);
  const activePayments = payments.filter((p) => !p.voided);

  return (
    <div className="space-y-6">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{h.invoice_number}</h1>
          <OrderStatusBadge status={h.status} />
        </div>
        <OrderActions id={h.id} status={h.status} canManage={!!canManage} balanceDue={h.balance_due} currency={c} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total" value={formatCurrency(h.total, c)} hint={h.company_name ?? ""} icon={Wallet} />
        <KpiCard label="Amount paid" value={formatCurrency(h.amount_paid, c)} hint={`${activePayments.length} payment${activePayments.length === 1 ? "" : "s"}`} icon={CreditCard} />
        <KpiCard label="Balance due" value={formatCurrency(h.balance_due, c)} hint={h.due_date ? `Due ${new Date(`${h.due_date}T00:00:00`).toLocaleDateString()}` : ""} icon={Scale} />
        {canSeeInternal ? (
          <KpiCard label="Net profit" value={formatCurrency(h.net_profit ?? 0, c)} hint={`GP ${formatCurrency(h.gross_profit ?? 0, c)}`} icon={TrendingUp} />
        ) : (
          <KpiCard label="Status" value={h.status === "sent" ? "Issued" : h.status.charAt(0).toUpperCase() + h.status.slice(1)} hint={h.issue_date ? `Issued ${new Date(`${h.issue_date}T00:00:00`).toLocaleDateString()}` : "Draft"} icon={Scale} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: items, financials, expenses, payments */}
        <div className="space-y-6 lg:col-span-2">
          {/* Line items */}
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">SKU</th>
                      <th className="py-2 pr-3 font-medium">Description</th>
                      <th className="py-2 pr-3 text-right font-medium">Qty</th>
                      <th className="py-2 pr-3 text-right font-medium">Unit</th>
                      {canSeeInternal && <th className="py-2 pr-3 text-right font-medium">Cost</th>}
                      <th className="py-2 pr-3 text-right font-medium">Line total</th>
                      {canSeeInternal && <th className="py-2 text-right font-medium">GP</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-b border-border last:border-0 align-top">
                        <td className="py-2.5 pr-3 font-mono text-xs">{it.sku}</td>
                        <td className="py-2.5 pr-3">
                          <div>{[it.product_name, it.strength, it.pack_size].filter(Boolean).join(" · ")}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="font-normal">
                              {SOURCE_LABELS[it.price_source ?? ""] ?? it.price_source ?? "—"}
                              {it.price_source_sheet ? ` · ${it.price_source_sheet}` : ""}
                            </Badge>
                            {it.price_overridden && (
                              <span className="text-xs text-warning-foreground">
                                overridden{it.original_unit_price != null ? ` (was ${formatCurrency(it.original_unit_price, c)})` : ""}
                                {it.manual_reason ? ` — ${it.manual_reason}` : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{it.quantity}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(it.unit_price, c)}</td>
                        {canSeeInternal && <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(it.unit_true_cost ?? 0, c)}</td>}
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(it.line_subtotal, c)}</td>
                        {canSeeInternal && <td className="py-2.5 text-right tabular-nums text-success">{formatCurrency(it.line_gross_profit ?? 0, c)}</td>}
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={canSeeInternal ? 7 : 5} className="py-6 text-center text-muted-foreground">No line items.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Financial summary */}
          <Card>
            <CardHeader>
              <CardTitle>Financial summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <SummaryRow label="Subtotal" value={formatCurrency(h.subtotal, c)} />
                {h.discount > 0 && <SummaryRow label="Discount" value={`(${formatCurrency(h.discount, c)})`} muted />}
                <SummaryRow label="Shipping (customer-paid)" value={formatCurrency(h.shipping, c)} muted />
                <SummaryRow label="Fees" value={formatCurrency(h.fees, c)} muted />
                <SummaryRow label={`Tax (${(h.tax_rate * 100).toFixed(2)}%)`} value={formatCurrency(h.tax_amount, c)} muted />
                <div className="my-1 border-t border-border" />
                <SummaryRow label="Total" value={formatCurrency(h.total, c)} strong />
                <SummaryRow label="Amount paid" value={formatCurrency(h.amount_paid, c)} muted />
                <SummaryRow label="Balance due" value={formatCurrency(h.balance_due, c)} strong />
              </div>
              {canSeeInternal && (
                <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3 w-3" /> Internal economics · staff only
                  </div>
                  <SummaryRow label="True cost" value={formatCurrency(h.total_true_cost ?? 0, c)} muted />
                  <SummaryRow label="Gross profit" value={formatCurrency(h.gross_profit ?? 0, c)} />
                  <SummaryRow label="Gross margin" value={`${((h.gross_margin ?? 0) * 100).toFixed(1)}%`} muted />
                  <SummaryRow label="Commission" value={formatCurrency(h.total_commission ?? 0, c)} muted />
                  <SummaryRow label="Internal expenses" value={formatCurrency(h.total_expenses ?? 0, c)} muted />
                  <div className="my-1 border-t border-border" />
                  <SummaryRow label="Net profit" value={formatCurrency(h.net_profit ?? 0, c)} strong />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Internal expenses (admin) */}
          {canManage && <ExpenseManager invoiceId={h.id} expenses={expenses} currency={c} />}

          {/* Payment history */}
          <Card>
            <CardHeader>
              <CardTitle>Payment history</CardTitle>
            </CardHeader>
            <CardContent>
              {activePayments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <div className="space-y-0">
                  {activePayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0">
                      <div>
                        <span className="tabular-nums font-medium">{formatCurrency(p.amount, c)}</span>
                        <span className="ml-2 text-muted-foreground">{METHOD_LABELS[p.method] ?? p.method}</span>
                        {p.reference && <span className="ml-2 text-xs text-muted-foreground">Ref {p.reference}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(p.received_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: client, resolution, timeline, audit */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Client & order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <InfoRow label="Client" value={h.company_name} />
              <InfoRow label="Representative" value={h.sales_rep_name} />
              <InfoRow label="Pricing model" value={h.pricing_sheet_name ?? "— default —"} />
              <InfoRow label="Issue date" value={h.issue_date ? new Date(`${h.issue_date}T00:00:00`).toLocaleDateString() : "— draft —"} />
              <InfoRow label="Due date" value={h.due_date ? new Date(`${h.due_date}T00:00:00`).toLocaleDateString() : "—"} />
              <div className="border-t border-border pt-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Billing</div>
                {billing.length ? billing.map((l, i) => <div key={i}>{l}</div>) : <span className="text-muted-foreground">—</span>}
              </div>
              <div className="border-t border-border pt-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Shipping</div>
                {shipping.length ? shipping.map((l, i) => <div key={i}>{l}</div>) : <span className="text-muted-foreground">— same as billing —</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {statusHistory.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Created as a draft.</p>
              ) : (
                <ul className="space-y-3">
                  {statusHistory.map((s) => (
                    <li key={s.id} className="flex gap-3 text-sm">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <div>{s.from_status ? `${s.from_status} → ${s.to_status}` : `Created (${s.to_status})`}</div>
                        {s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}
                        <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit history</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No activity recorded.</p>
              ) : (
                <ul className="space-y-3">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <div>{a.summary ?? a.action}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(a.created_at).toLocaleString()}{a.actor_name ? ` · ${a.actor_name}` : ""}
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

function SummaryRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value || "—"}</span>
    </div>
  );
}
