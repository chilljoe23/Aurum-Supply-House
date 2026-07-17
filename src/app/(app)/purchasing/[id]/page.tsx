import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, History, Factory, Truck, PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getPurchaseOrderDetail } from "@/lib/purchase-orders/queries";
import { formatCurrency } from "@/lib/utils";
import { PoStatusBadge } from "@/components/purchasing/po-status-badge";
import { PoActions } from "@/components/purchasing/po-actions";
import { PoAttachments } from "@/components/purchasing/po-attachments";
import { RestrictedNotice } from "@/components/purchasing/restricted-notice";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase-orders/status";
import { MFR_PAYMENT_TYPE_OPTIONS } from "@/lib/purchase-orders/schemas";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

const PAY_LABEL: Record<string, string> = Object.fromEntries(MFR_PAYMENT_TYPE_OPTIONS.map((o) => [o.value, o.label]));

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const s = d.length > 10 ? d : `${d}T00:00:00`;
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function addr(a: Record<string, unknown> | null | undefined): string[] {
  const o = (a ?? {}) as Record<string, string | undefined>;
  const l1 = [o.line1, o.line2].filter(Boolean).join(", ");
  const l2 = [o.city, o.region, o.postal_code].filter(Boolean).join(" ");
  return [l1, l2, o.country ?? ""].map((s) => (s ?? "").trim()).filter(Boolean);
}

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user?.role !== "owner" && user?.role !== "admin") return <RestrictedNotice />;

  const d = await getPurchaseOrderDetail(id);
  if (!d) notFound();
  const h = d.header;
  const c = h.currency;
  const snap = (h.manufacturer_snapshot ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <Link href="/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Purchasing
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{h.po_number}</h1>
          <PoStatusBadge status={h.status} />
        </div>
        <PoActions
          id={h.id}
          status={h.status}
          currency={c}
          balanceDue={h.balance_due}
          items={d.items.map((it) => ({ id: it.id, sku: it.sku, product_name: it.product_name, quantity: it.quantity, quantity_received: it.quantity_received }))}
        />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total" value={formatCurrency(h.total, c)} />
        <Kpi label="Amount paid" value={formatCurrency(h.amount_paid, c)} />
        <Kpi label="Balance due" value={formatCurrency(h.balance_due, c)} />
        <Kpi label="Expected" value={fmtDate(h.expected_date)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-2">SKU</th>
                    <th className="p-2">Mfr SKU</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Recv</th>
                    <th className="p-2 text-right">Unit cost</th>
                    <th className="p-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it) => (
                    <tr key={it.id} className="border-b border-border last:border-0 align-top">
                      <td className="p-2 font-mono text-xs">{it.sku}</td>
                      <td className="p-2 font-mono text-xs">{it.manufacturer_sku ?? "—"}</td>
                      <td className="p-2">
                        {it.description}
                        <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                          {it.resolved_cost_source && (
                            <span>
                              {it.resolved_cost_source === "manual" ? "Manual cost" : it.resolved_cost_source === "tier" ? `Tier ${it.resolved_tier_min ?? ""}${it.resolved_tier_max != null ? `–${it.resolved_tier_max}` : "+"}` : "Base cost"}
                            </span>
                          )}
                          {it.cost_reason && <span>· {it.cost_reason}</span>}
                          {it.moq ? <span>· MOQ {it.moq}</span> : null}
                          {it.order_multiple ? <span>· ×{it.order_multiple}</span> : null}
                          {it.lead_time_days ? <span>· {it.lead_time_days}d lead</span> : null}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="p-2 text-right tabular-nums">{it.quantity_received}</td>
                      <td className="p-2 text-right tabular-nums">{formatCurrency(it.unit_cost, c)}</td>
                      <td className="p-2 text-right tabular-nums">{formatCurrency(it.line_total, c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Financial summary</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <SummaryRow label="Subtotal" value={formatCurrency(h.subtotal, c)} />
              {h.shipping > 0 && <SummaryRow label="Shipping" value={formatCurrency(h.shipping, c)} muted />}
              {h.fees > 0 && <SummaryRow label="Fees" value={formatCurrency(h.fees, c)} muted />}
              {h.tax > 0 && <SummaryRow label="Tax" value={formatCurrency(h.tax, c)} muted />}
              <div className="my-1 border-t border-border" />
              <SummaryRow label="Total" value={formatCurrency(h.total, c)} strong />
              <SummaryRow label="Amount paid" value={formatCurrency(h.amount_paid, c)} muted />
              <SummaryRow label="Balance due" value={formatCurrency(h.balance_due, c)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Manufacturer payment ledger</CardTitle></CardHeader>
            <CardContent>
              {d.payments.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No manufacturer payments recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="p-2">Date</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Method</th>
                      <th className="p-2">Reference</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payments.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="p-2 text-muted-foreground">{fmtDate(p.payment_date)}</td>
                        <td className="p-2">{PAY_LABEL[p.type] ?? p.type}</td>
                        <td className="p-2 capitalize">{p.method}</td>
                        <td className="p-2 text-muted-foreground">{p.reference ?? "—"}</td>
                        <td className={`p-2 text-right tabular-nums ${p.type === "refund_credit" ? "text-destructive" : ""}`}>
                          {p.type === "refund_credit" ? `(${formatCurrency(p.amount, c)})` : formatCurrency(p.amount, c)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0"><PackageCheck className="h-4 w-4 text-muted-foreground" /><CardTitle>Attachments</CardTitle></CardHeader>
            <CardContent>
              <PoAttachments poId={h.id} attachments={d.attachments} />
            </CardContent>
          </Card>

          {(d.shipments.length > 0 || d.receipts.length > 0) && (
            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0"><Truck className="h-4 w-4 text-muted-foreground" /><CardTitle>Tracking & receiving</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {d.shipments.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Shipments</div>
                    <ul className="space-y-1">
                      {d.shipments.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="font-medium">{s.carrier ?? "Carrier"}</span>
                          {s.tracking_number && <span className="font-mono text-xs">{s.tracking_number}</span>}
                          <span className="text-muted-foreground">
                            {s.ship_date ? `shipped ${fmtDate(s.ship_date)}` : ""}
                            {s.expected_arrival_date ? ` · ETA ${fmtDate(s.expected_arrival_date)}` : ""}
                            {s.received_date ? ` · received ${fmtDate(s.received_date)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.receipts.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Receipts</div>
                    <ul className="space-y-1">
                      {d.receipts.map((r) => (
                        <li key={r.id} className="text-muted-foreground">
                          {fmtDate(r.received_date)} · qty {r.quantity_received}
                          {r.lot_number ? ` · lot ${r.lot_number}` : ""}
                          {r.notes ? ` · ${r.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0"><Factory className="h-4 w-4 text-muted-foreground" /><CardTitle>Vendor</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="font-medium">{(snap.name as string) ?? h.manufacturer_name ?? "—"}</div>
              {snap.contact_name ? <div className="text-muted-foreground">{String(snap.contact_name)}</div> : null}
              {snap.email ? <div className="text-muted-foreground">{String(snap.email)}</div> : null}
              {snap.phone ? <div className="text-muted-foreground">{String(snap.phone)}</div> : null}
              {addr(snap.address as Record<string, unknown> | null).map((l, i) => (
                <div key={i} className="text-muted-foreground">{l}</div>
              ))}
              {h.payment_terms && <div className="pt-2 text-xs text-muted-foreground">Terms: {h.payment_terms}</div>}
              {h.notes && <div className="pt-2 whitespace-pre-wrap text-xs text-muted-foreground">{h.notes}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0"><Clock className="h-4 w-4 text-muted-foreground" /><CardTitle>Status timeline</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {d.statusHistory.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <div>
                        {s.from_status ? `${PO_STATUS_LABELS[s.from_status as PoStatus] ?? s.from_status} → ` : ""}
                        <span className="font-medium">{PO_STATUS_LABELS[s.to_status as PoStatus] ?? s.to_status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDateTime(s.created_at)}{s.note ? ` · ${s.note}` : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0"><History className="h-4 w-4 text-muted-foreground" /><CardTitle>Audit history</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {d.activity.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
                {d.activity.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <div>{a.summary ?? a.action}</div>
                      <div className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
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
