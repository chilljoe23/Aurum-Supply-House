import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet, CalendarClock, Building2, Truck, Clock, History, ReceiptText, ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/patterns/kpi-card";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { QuoteActions } from "@/components/quotes/quote-actions";
import { getCurrentUser } from "@/lib/auth";
import { getQuoteDetail } from "@/lib/quotes/queries";
import { addressLines, paymentTermsLabel } from "@/lib/quotes/quote-view-model";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  client_override: "Client override",
  selected_model: "Selected model",
  assigned_model: "Assigned model",
  default_model: "Default model",
  manual: "Manual override",
  quote_retained: "Retained quote price",
};

function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "—";
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, detail] = await Promise.all([getCurrentUser(), getQuoteDetail(id)]);
  if (!detail) notFound();

  const { header: h, items, statusHistory, activity } = detail;
  const canManage = user?.role === "owner" || user?.role === "admin";
  const c = h.currency;
  const snap = (h.client_snapshot ?? {}) as Record<string, unknown>;
  const billing = addressLines(snap.billing_address as Record<string, unknown> | null);
  const shipping = addressLines(snap.shipping_address as Record<string, unknown> | null);
  const expiryHint = h.expiration_date
    ? h.is_expired
      ? `Expired ${fmtDate(h.expiration_date)}`
      : `Valid until ${fmtDate(h.expiration_date)}`
    : "No expiration";

  return (
    <div className="space-y-6">
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Quotes
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{h.quote_number}</h1>
          <QuoteStatusBadge status={h.status} isExpired={h.is_expired} />
        </div>
        <QuoteActions id={h.id} status={h.status} isExpired={h.is_expired} canManage={!!canManage} convertedOrderId={h.converted_order_id} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Quote total" value={formatCurrency(h.total, c)} hint={h.company_name ?? ""} icon={Wallet} />
        <KpiCard label="Quote date" value={fmtDate(h.quote_date)} hint={h.customer_reference ? `Ref ${h.customer_reference}` : ""} icon={ClipboardList} />
        <KpiCard label="Expiration" value={fmtDate(h.expiration_date)} hint={expiryHint} icon={CalendarClock} />
        <KpiCard
          label="Status"
          value={h.is_expired && h.status === "sent" ? "Expired" : h.status.charAt(0).toUpperCase() + h.status.slice(1)}
          hint={h.converted_order_number ? `Order ${h.converted_order_number}` : ""}
          icon={ReceiptText}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: items + financial summary */}
        <div className="space-y-6 lg:col-span-2">
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
                      <th className="py-2 text-right font-medium">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-b border-border align-top last:border-0">
                        <td className="py-2.5 pr-3 font-mono text-xs">{it.sku}</td>
                        <td className="py-2.5 pr-3">
                          <div>{it.description}</div>
                          {/* Pricing source — internal transparency only; never on the customer document. */}
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
                        <td className="py-2.5 text-right tabular-nums">{formatCurrency(it.line_subtotal, c)}</td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">No line items.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Financial summary</CardTitle>
            </CardHeader>
            <CardContent className="max-w-md space-y-1.5 text-sm">
              <SummaryRow label="Subtotal" value={formatCurrency(h.subtotal, c)} />
              {h.discount > 0 && <SummaryRow label="Discount" value={`(${formatCurrency(h.discount, c)})`} muted />}
              <SummaryRow label="Shipping (customer-paid)" value={formatCurrency(h.shipping, c)} muted />
              <SummaryRow label="Fees" value={formatCurrency(h.fees, c)} muted />
              <SummaryRow label={`Tax (${(h.tax_rate * 100).toFixed(2)}%)`} value={formatCurrency(h.tax_amount, c)} muted />
              <div className="my-1 border-t border-border" />
              <SummaryRow label="Quote total" value={formatCurrency(h.total, c)} strong />
            </CardContent>
          </Card>

          {h.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes & terms</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{h.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: client, timeline, audit */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Client & quote</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <InfoRow label="Client" value={h.company_name} />
              <InfoRow label="Representative" value={h.sales_rep_name} />
              <InfoRow label="Pricing model" value={h.pricing_sheet_name ?? "— default —"} />
              <InfoRow label="Payment terms" value={paymentTermsLabel(h.payment_terms)} />
              <InfoRow label="Customer reference" value={h.customer_reference} />
              <InfoRow label="Quote date" value={fmtDate(h.quote_date)} />
              <InfoRow label="Expiration" value={fmtDate(h.expiration_date)} />
              {h.converted_order_id && (
                <div className="flex justify-between gap-3 border-t border-border pt-2.5">
                  <span className="text-muted-foreground">Linked order</span>
                  <Link href={`/orders/${h.converted_order_id}`} className="font-mono text-xs hover:underline">
                    {h.converted_order_number ?? "View order"}
                  </Link>
                </div>
              )}
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
