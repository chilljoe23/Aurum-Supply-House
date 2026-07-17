"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Loader2, TriangleAlert, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect, type Option } from "@/components/patterns/searchable-select";
import { formatCurrency } from "@/lib/utils";
import { computeTotals } from "@/lib/orders/calculations";
import { saveOrderDraft, resolveLinePrice, type ResolvedPrice } from "@/app/(app)/orders/actions";
import type { BuilderData, EditableOrder } from "@/lib/orders/queries";

const SOURCE_LABELS: Record<string, string> = {
  client_override: "Client override",
  selected_model: "Selected model",
  assigned_model: "Assigned model",
  default_model: "Default model",
  manual: "Manual override",
  unresolved: "No price",
};

type Line = {
  key: string;
  product_id: string;
  quantity: string;
  resolved: ResolvedPrice | null;
  resolving: boolean;
  override: boolean;
  manual_price: string;
  manual_reason: string;
  showLot: boolean;
  lot_number: string;
  manufacturing_date: string;
  expiration_date: string;
  retest_date: string;
};

let keySeq = 0;
const newKey = () => `l${keySeq++}`;

export function OrderBuilder({
  data,
  canOverride,
  canSeeInternal,
  initial,
}: {
  data: BuilderData;
  canOverride: boolean;
  canSeeInternal: boolean;
  initial?: EditableOrder | null;
}) {
  const router = useRouter();
  const productById = React.useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);

  const [clientId, setClientId] = React.useState(initial?.client_id ?? "");
  const [modelId, setModelId] = React.useState(initial?.selected_model_id ?? "");
  const [shipping, setShipping] = React.useState(String(initial?.shipping ?? ""));
  const [fees, setFees] = React.useState(String(initial?.fees ?? ""));
  const [discount, setDiscount] = React.useState(String(initial?.discount ?? ""));
  const [taxPct, setTaxPct] = React.useState(initial ? String(round4(initial.tax_rate * 100)) : "");
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [lines, setLines] = React.useState<Line[]>(
    initial?.lines.map((l) => ({
      key: newKey(),
      product_id: l.product_id ?? "",
      quantity: String(l.quantity),
      resolved: { resolved: true, price: l.unit_price, source: l.price_overridden ? "manual" : l.price_source ?? "assigned_model", pricing_sheet_name: null, warning: null },
      resolving: false,
      override: l.price_overridden,
      manual_price: l.price_overridden ? String(l.unit_price) : "",
      manual_reason: l.manual_reason ?? "",
      showLot: !!(l.lot_number || l.expiration_date || l.manufacturing_date || l.retest_date),
      lot_number: l.lot_number ?? "",
      manufacturing_date: l.manufacturing_date ?? "",
      expiration_date: l.expiration_date ?? "",
      retest_date: l.retest_date ?? "",
    })) ?? [],
  );

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currency = "USD";
  const client = data.clients.find((c) => c.id === clientId) ?? null;

  const clientOptions: Option[] = data.clients.map((c) => ({ value: c.id, label: c.company_name, hint: c.pricing_model_name ?? "no model" }));
  const modelOptions: Option[] = [
    { value: "", label: "Client's assigned model", hint: client?.pricing_model_name ?? "default" },
    ...data.models.map((m) => ({ value: m.id, label: m.name, hint: m.currency })),
  ];
  const productOptions: Option[] = data.products.map((p) => ({
    value: p.id,
    label: `${p.sku} — ${p.name}`,
    hint: [p.strength, p.pack_size].filter(Boolean).join(" · ") || undefined,
  }));

  // Resolve a single line's price against the server resolver.
  const resolve = React.useCallback(
    async (key: string, productId: string, quantity: string, selectedModel: string) => {
      if (!clientId || !productId) return;
      const q = Number(quantity);
      if (!q || q <= 0) return;
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, resolving: true } : l)));
      const res = await resolveLinePrice(clientId, productId, q, selectedModel || null, currency);
      setLines((prev) =>
        prev.map((l) =>
          l.key === key
            ? { ...l, resolving: false, resolved: "error" in res ? { resolved: false, price: null, source: "unresolved", pricing_sheet_name: null, warning: res.error } : res }
            : l,
        ),
      );
    },
    [clientId],
  );

  // Re-resolve all non-override lines when the client or model changes.
  React.useEffect(() => {
    if (!clientId) return;
    for (const l of lines) {
      if (!l.override && l.product_id) resolve(l.key, l.product_id, l.quantity, modelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, modelId]);

  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), product_id: "", quantity: "1", resolved: null, resolving: false, override: false, manual_price: "", manual_reason: "", showLot: false, lot_number: "", manufacturing_date: "", expiration_date: "", retest_date: "" }]);
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }
  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onProductChange(key: string, productId: string) {
    updateLine(key, { product_id: productId });
    const l = lines.find((x) => x.key === key);
    if (l && !l.override) resolve(key, productId, l.quantity, modelId);
  }
  function onQtyChange(key: string, quantity: string) {
    updateLine(key, { quantity });
  }
  function onQtyCommit(key: string) {
    const l = lines.find((x) => x.key === key);
    if (l && !l.override && l.product_id) resolve(key, l.product_id, l.quantity, modelId);
  }

  function effectiveUnit(l: Line): number | null {
    if (l.override) return l.manual_price ? Number(l.manual_price) : null;
    return l.resolved?.resolved ? l.resolved.price : null;
  }

  // Live economics (admin) — true cost comes from the masked catalog (null for reps).
  const calcLines = lines
    .filter((l) => l.product_id && effectiveUnit(l) != null && Number(l.quantity) > 0)
    .map((l) => ({
      quantity: Number(l.quantity),
      unit_price: effectiveUnit(l) ?? 0,
      unit_true_cost: productById.get(l.product_id)?.true_cost ?? 0,
    }));
  const totals = computeTotals({
    lines: calcLines,
    shipping: Number(shipping) || 0,
    fees: Number(fees) || 0,
    discount: Number(discount) || 0,
    tax_rate: (Number(taxPct) || 0) / 100,
  });

  async function save() {
    setError(null);
    if (!clientId) {
      setError("Select a client to start the order.");
      return;
    }
    // Client-side guard for missing prices so the user gets an inline hint.
    for (const l of lines) {
      if (!l.product_id) continue;
      if (l.override && (!l.manual_price || !l.manual_reason.trim())) {
        setError("Manual price overrides require both a price and a reason.");
        return;
      }
      if (!l.override && !l.resolved?.resolved) {
        setError("One or more lines have no resolved price. Set an override or remove the line.");
        return;
      }
    }
    setSaving(true);
    const res = await saveOrderDraft({
      invoice_id: initial?.id,
      client_id: clientId,
      selected_model_id: modelId || undefined,
      currency,
      shipping: Number(shipping) || 0,
      fees: Number(fees) || 0,
      discount: Number(discount) || 0,
      tax_rate: (Number(taxPct) || 0) / 100,
      notes: notes || undefined,
      lines: lines
        .filter((l) => l.product_id)
        .map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          manual_price: l.override && l.manual_price ? Number(l.manual_price) : undefined,
          manual_reason: l.override ? l.manual_reason : undefined,
          lot_number: l.lot_number || undefined,
          manufacturing_date: l.manufacturing_date || undefined,
          expiration_date: l.expiration_date || undefined,
          retest_date: l.retest_date || undefined,
        })),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/orders/${res.data!.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Link href={initial ? `/orders/${initial.id}` : "/orders"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {initial ? "Back to order" : "Orders"}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{initial ? "Edit draft order" : "New order"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={initial ? `/orders/${initial.id}` : "/orders"}>Cancel</Link>
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save draft
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Client & model */}
          <Card>
            <CardHeader>
              <CardTitle>Client & pricing</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Client</Label>
                <SearchableSelect options={clientOptions} value={clientId} onChange={setClientId} placeholder="Select a client…" searchPlaceholder="Search clients…" />
                {client && <p className="text-xs text-muted-foreground">Assigned model: {client.pricing_model_name ?? "— none (uses default) —"}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Pricing model</Label>
                <SearchableSelect options={modelOptions} value={modelId} onChange={setModelId} placeholder="Client's assigned model" searchPlaceholder="Search models…" />
                <p className="text-xs text-muted-foreground">Optionally price this order against another authorized model.</p>
              </div>
            </CardContent>
          </Card>

          {/* Line items */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Line items</CardTitle>
              <Button size="sm" variant="outline" onClick={addLine} disabled={!clientId}>
                <Plus className="h-4 w-4" /> Add product
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {lines.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{clientId ? "Add products to build the order." : "Select a client first."}</p>}
              {lines.map((l) => {
                const unit = effectiveUnit(l);
                const q = Number(l.quantity) || 0;
                const lineTotal = unit != null ? unit * q : null;
                return (
                  <div key={l.key} className="rounded-lg border border-border p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                      <div className="space-y-1.5 sm:col-span-6">
                        <Label className="text-xs">Product</Label>
                        <SearchableSelect
                          options={productOptions}
                          value={l.product_id}
                          onChange={(v) => onProductChange(l.key, v)}
                          placeholder="Search SKU, name, strength…"
                          searchPlaceholder="Search products…"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.quantity}
                          onChange={(e) => onQtyChange(l.key, e.target.value)}
                          onBlur={() => onQtyCommit(l.key)}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Unit price</Label>
                        <div className="flex h-9 items-center text-sm tabular-nums">
                          {l.resolving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : unit != null ? (
                            formatCurrency(unit, currency)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2 sm:text-right">
                        <Label className="text-xs">Line total</Label>
                        <div className="flex h-9 items-center justify-between sm:justify-end">
                          <span className="text-sm tabular-nums">{lineTotal != null ? formatCurrency(lineTotal, currency) : "—"}</span>
                          <Button variant="ghost" size="icon" className="ml-2 h-7 w-7" onClick={() => removeLine(l.key)} title="Remove">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Resolution source + override */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {!l.override && l.resolved && (
                        l.resolved.resolved ? (
                          <Badge variant="outline" className="font-normal">
                            {SOURCE_LABELS[l.resolved.source] ?? l.resolved.source}
                            {l.resolved.pricing_sheet_name ? ` · ${l.resolved.pricing_sheet_name}` : ""}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning-foreground">
                            <TriangleAlert className="h-3 w-3" /> {l.resolved.warning ?? "No price found"}
                          </span>
                        )
                      )}
                      {l.override && <Badge variant="warning" className="font-normal">Manual override</Badge>}
                      {canOverride && l.product_id && (
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => {
                            const turningOn = !l.override;
                            updateLine(l.key, { override: turningOn, manual_price: turningOn && unit != null ? String(unit) : l.manual_price });
                            if (!turningOn) resolve(l.key, l.product_id, l.quantity, modelId);
                          }}
                        >
                          {l.override ? "Use resolved price" : "Override price"}
                        </button>
                      )}
                      {l.product_id && (
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => updateLine(l.key, { showLot: !l.showLot })}
                        >
                          {l.showLot ? "Hide lot details" : "Lot / traceability"}
                        </button>
                      )}
                    </div>

                    {l.showLot && (
                      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Lot number</Label>
                          <Input value={l.lot_number} onChange={(e) => updateLine(l.key, { lot_number: e.target.value })} placeholder="Optional" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Mfg date</Label>
                          <Input type="date" value={l.manufacturing_date} onChange={(e) => updateLine(l.key, { manufacturing_date: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Expiration</Label>
                          <Input type="date" value={l.expiration_date} onChange={(e) => updateLine(l.key, { expiration_date: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Retest</Label>
                          <Input type="date" value={l.retest_date} onChange={(e) => updateLine(l.key, { retest_date: e.target.value })} />
                        </div>
                      </div>
                    )}

                    {l.override && (
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Override unit price</Label>
                          <Input type="number" min={0} step="any" value={l.manual_price} onChange={(e) => updateLine(l.key, { manual_price: e.target.value })} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">Reason (required)</Label>
                          <Input value={l.manual_reason} onChange={(e) => updateLine(l.key, { manual_reason: e.target.value })} placeholder="Why is this price overridden?" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Charges & notes */}
          <Card>
            <CardHeader>
              <CardTitle>Charges & notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Shipping" hint="customer-paid">
                  <Input type="number" min={0} step="any" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Fees">
                  <Input type="number" min={0} step="any" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Discount">
                  <Input type="number" min={0} step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Tax %">
                  <Input type="number" min={0} step="any" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} placeholder="0" />
                </Field>
              </div>
              <div className="space-y-1.5">
                <Label>Notes (appear on the invoice)</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Customer-facing notes or terms…" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
              {totals.discount > 0 && <Row label="Discount" value={`(${formatCurrency(totals.discount, currency)})`} muted />}
              {totals.shipping > 0 && <Row label="Shipping" value={formatCurrency(totals.shipping, currency)} muted />}
              {totals.fees > 0 && <Row label="Fees" value={formatCurrency(totals.fees, currency)} muted />}
              {totals.tax_amount > 0 && <Row label={`Tax (${(totals.tax_rate * 100).toFixed(2)}%)`} value={formatCurrency(totals.tax_amount, currency)} muted />}
              <div className="my-1 border-t border-border" />
              <Row label="Total" value={formatCurrency(totals.total, currency)} strong />

              {canSeeInternal && (
                <div className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3 w-3" /> Internal economics · staff only
                  </div>
                  <Row label="True cost" value={formatCurrency(totals.total_true_cost, currency)} muted />
                  <Row label="Gross profit" value={formatCurrency(totals.gross_profit, currency)} />
                  <Row label="Gross margin" value={`${(totals.gross_margin * 100).toFixed(1)}%`} muted />
                  <Row label="Net profit (pre-expense)" value={formatCurrency(totals.net_profit, currency)} />
                  <p className="pt-1 text-[11px] text-muted-foreground">Commissions & internal expenses are added on the order once saved.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {hint && <span className="ml-1 font-normal text-muted-foreground">({hint})</span>}
      </Label>
      {children}
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
