"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect, type Option } from "@/components/patterns/searchable-select";
import { formatCurrency } from "@/lib/utils";
import { moneyRound } from "@/lib/orders/calculations";
import { savePoDraft, resolvePoLineCost, loadManufacturerCatalog, type ResolvedCost } from "@/app/(app)/purchasing/actions";
import type { PoManufacturerOption, PoCatalogProduct, EditablePurchaseOrder } from "@/lib/purchase-orders/queries";

const COST_SOURCE_LABELS: Record<string, string> = {
  base: "Base cost",
  tier: "Quantity tier",
  manual: "Manual cost",
  unresolved: "No cost",
};
const WARNING_LABELS: Record<string, string> = {
  below_moq: "Below minimum order quantity",
  not_order_multiple: "Not a multiple of the order multiple",
  no_relationship: "No supply relationship",
  no_cost: "No active cost",
  inactive: "Inactive relationship",
};

type Line = {
  key: string;
  product_id: string;
  quantity: string;
  resolved: ResolvedCost | null;
  resolving: boolean;
  manual: boolean;
  manual_cost: string;
  manual_reason: string;
  notes: string;
};

let keySeq = 0;
const newKey = () => `pl${keySeq++}`;

export function PoBuilder({
  manufacturers,
  initial,
}: {
  manufacturers: PoManufacturerOption[];
  initial?: EditablePurchaseOrder | null;
}) {
  const router = useRouter();
  const [manufacturerId, setManufacturerId] = React.useState(initial?.manufacturer_id ?? "");
  const [catalog, setCatalog] = React.useState<PoCatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const catalogById = React.useMemo(() => new Map(catalog.map((p) => [p.product_id, p])), [catalog]);

  const [shipping, setShipping] = React.useState(String(initial?.shipping ?? ""));
  const [fees, setFees] = React.useState(String(initial?.fees ?? ""));
  const [tax, setTax] = React.useState(String(initial?.tax ?? ""));
  const [expectedDate, setExpectedDate] = React.useState(initial?.expected_date ?? "");
  const [paymentTerms, setPaymentTerms] = React.useState(initial?.payment_terms ?? "");
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [lines, setLines] = React.useState<Line[]>(
    initial?.lines.map((l) => ({
      key: newKey(),
      product_id: l.product_id,
      quantity: String(l.quantity),
      resolved: {
        resolved: true, unit_cost: l.unit_cost, currency: initial.currency, source: l.resolved_cost_source ?? "base",
        tier_min: null, tier_max: null, moq: null, order_multiple: null, lead_time_days: null, warnings: [], warning: null,
      },
      resolving: false,
      manual: l.manual,
      manual_cost: l.manual ? String(l.unit_cost) : "",
      manual_reason: l.manual_reason ?? "",
      notes: l.notes ?? "",
    })) ?? [],
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const currency = initial?.currency ?? "USD";

  const manufacturerOptions: Option[] = manufacturers.map((m) => ({ value: m.id, label: m.name }));
  const productOptions: Option[] = catalog.map((p) => ({
    value: p.product_id,
    label: `${p.sku} — ${p.product_name}`,
    hint: [p.manufacturer_sku ? `Mfr ${p.manufacturer_sku}` : null, p.manufacturer_description].filter(Boolean).join(" · ") || undefined,
  }));

  // Load the chosen manufacturer's active product relationships.
  const loadCatalog = React.useCallback(async (mid: string) => {
    if (!mid) {
      setCatalog([]);
      return;
    }
    setCatalogLoading(true);
    const res = await loadManufacturerCatalog(mid);
    setCatalogLoading(false);
    setCatalog(res.ok ? res.data ?? [] : []);
  }, []);

  React.useEffect(() => {
    loadCatalog(manufacturerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manufacturerId]);

  const resolve = React.useCallback(
    async (key: string, productId: string, quantity: string) => {
      if (!manufacturerId || !productId) return;
      const q = Number(quantity);
      if (!q || q <= 0) return;
      setLines((prev) => prev.map((l) => (l.key === key ? { ...l, resolving: true } : l)));
      const res = await resolvePoLineCost(manufacturerId, productId, q, currency);
      setLines((prev) =>
        prev.map((l) =>
          l.key === key
            ? {
                ...l,
                resolving: false,
                resolved:
                  "error" in res
                    ? { resolved: false, unit_cost: null, currency, source: "unresolved", tier_min: null, tier_max: null, moq: null, order_multiple: null, lead_time_days: null, warnings: [], warning: res.error }
                    : res,
              }
            : l,
        ),
      );
    },
    [manufacturerId, currency],
  );

  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), product_id: "", quantity: "1", resolved: null, resolving: false, manual: false, manual_cost: "", manual_reason: "", notes: "" }]);
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
    if (l && !l.manual) resolve(key, productId, l.quantity);
  }
  function onQtyCommit(key: string) {
    const l = lines.find((x) => x.key === key);
    if (l && !l.manual && l.product_id) resolve(key, l.product_id, l.quantity);
  }

  function effectiveCost(l: Line): number | null {
    if (l.manual) return l.manual_cost ? Number(l.manual_cost) : null;
    return l.resolved?.resolved ? l.resolved.unit_cost : null;
  }

  const subtotal = moneyRound(
    lines.reduce((s, l) => {
      const c = effectiveCost(l);
      const q = Number(l.quantity) || 0;
      return c != null ? s + c * q : s;
    }, 0),
    4,
  );
  const total = moneyRound(subtotal + (Number(shipping) || 0) + (Number(fees) || 0) + (Number(tax) || 0), 4);

  async function save() {
    setError(null);
    if (!manufacturerId) {
      setError("Select a manufacturer to start the purchase order.");
      return;
    }
    for (const l of lines) {
      if (!l.product_id) continue;
      if (l.manual && (!l.manual_cost || !l.manual_reason.trim())) {
        setError("A manual cost requires both a cost and a reason.");
        return;
      }
      if (!l.manual && !l.resolved?.resolved) {
        setError("One or more lines have no resolved cost. Enter an authorized manual cost, or remove the line.");
        return;
      }
    }
    setSaving(true);
    const res = await savePoDraft({
      po_id: initial?.id,
      manufacturer_id: manufacturerId,
      currency,
      shipping: Number(shipping) || 0,
      fees: Number(fees) || 0,
      tax: Number(tax) || 0,
      expected_date: expectedDate || undefined,
      payment_terms: paymentTerms || undefined,
      notes: notes || undefined,
      lines: lines
        .filter((l) => l.product_id)
        .map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          manual_cost: l.manual && l.manual_cost ? Number(l.manual_cost) : undefined,
          manual_reason: l.manual ? l.manual_reason : undefined,
          notes: l.notes || undefined,
        })),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/purchasing/${res.data!.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Link href={initial ? `/purchasing/${initial.id}` : "/purchasing"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {initial ? "Back to purchase order" : "Purchasing"}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{initial ? "Edit draft PO" : "New purchase order"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={initial ? `/purchasing/${initial.id}` : "/purchasing"}>Cancel</Link>
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
          <Card>
            <CardHeader><CardTitle>Manufacturer</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Label>Manufacturer</Label>
              <SearchableSelect
                options={manufacturerOptions}
                value={manufacturerId}
                onChange={(v) => {
                  setManufacturerId(v);
                  setLines([]);
                }}
                placeholder="Select a manufacturer…"
                searchPlaceholder="Search manufacturers…"
              />
              <p className="text-xs text-muted-foreground">
                Only this manufacturer&apos;s active products can be added. Changing the manufacturer clears the lines.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Line items</CardTitle>
              <Button size="sm" variant="outline" onClick={addLine} disabled={!manufacturerId || catalogLoading}>
                <Plus className="h-4 w-4" /> Add product
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!manufacturerId && <p className="py-6 text-center text-sm text-muted-foreground">Select a manufacturer first.</p>}
              {manufacturerId && catalogLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading products…</p>
              )}
              {manufacturerId && !catalogLoading && catalog.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">This manufacturer has no active product relationships. Import its cost file first.</p>
              )}
              {manufacturerId && !catalogLoading && catalog.length > 0 && lines.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Add products to build the purchase order.</p>
              )}
              {lines.map((l) => {
                const cost = effectiveCost(l);
                const q = Number(l.quantity) || 0;
                const lineTotal = cost != null ? cost * q : null;
                const cp = catalogById.get(l.product_id);
                return (
                  <div key={l.key} className="rounded-lg border border-border p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                      <div className="space-y-1.5 sm:col-span-5">
                        <Label className="text-xs">Product</Label>
                        <SearchableSelect
                          options={productOptions}
                          value={l.product_id}
                          onChange={(v) => onProductChange(l.key, v)}
                          placeholder="Search SKU, name…"
                          searchPlaceholder="Search products…"
                        />
                        {cp?.manufacturer_sku && <p className="text-[11px] text-muted-foreground">Mfr SKU: {cp.manufacturer_sku}</p>}
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Quantity</Label>
                        <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} onBlur={() => onQtyCommit(l.key)} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Unit cost</Label>
                        <div className="flex h-9 items-center text-sm tabular-nums">
                          {l.resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : cost != null ? formatCurrency(cost, currency) : <span className="text-muted-foreground">—</span>}
                        </div>
                      </div>
                      <div className="space-y-1.5 sm:col-span-3 sm:text-right">
                        <Label className="text-xs">Line total</Label>
                        <div className="flex h-9 items-center justify-between sm:justify-end">
                          <span className="text-sm tabular-nums">{lineTotal != null ? formatCurrency(lineTotal, currency) : "—"}</span>
                          <Button variant="ghost" size="icon" className="ml-2 h-7 w-7" onClick={() => removeLine(l.key)} title="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    </div>

                    {/* Resolution source + warnings + manual toggle */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {!l.manual && l.resolved && (
                        l.resolved.resolved ? (
                          <Badge variant="outline" className="font-normal">
                            {COST_SOURCE_LABELS[l.resolved.source] ?? l.resolved.source}
                            {l.resolved.tier_min != null ? ` · tier ${l.resolved.tier_min}${l.resolved.tier_max != null ? `–${l.resolved.tier_max}` : "+"}` : ""}
                            {` · ${l.resolved.currency}`}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <TriangleAlert className="h-3 w-3" /> {l.resolved.warning ?? "No cost resolved"}
                          </span>
                        )
                      )}
                      {l.manual && <Badge variant="warning" className="font-normal">Manual cost</Badge>}
                      {!l.manual && l.resolved?.warnings?.map((w) => (
                        <span key={w} className="inline-flex items-center gap-1 text-warning-foreground">
                          <TriangleAlert className="h-3 w-3" /> {WARNING_LABELS[w] ?? w}
                        </span>
                      ))}
                      {!l.manual && (cp?.moq || cp?.order_multiple || cp?.lead_time_days) && (
                        <span className="text-muted-foreground">
                          {cp.moq ? `MOQ ${cp.moq} · ` : ""}{cp.order_multiple ? `×${cp.order_multiple} · ` : ""}{cp.lead_time_days ? `${cp.lead_time_days}d lead` : ""}
                        </span>
                      )}
                      {l.product_id && (
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => {
                            const turningOn = !l.manual;
                            updateLine(l.key, { manual: turningOn, manual_cost: turningOn && cost != null ? String(cost) : l.manual_cost });
                            if (!turningOn) resolve(l.key, l.product_id, l.quantity);
                          }}
                        >
                          {l.manual ? "Use resolved cost" : "Enter manual cost"}
                        </button>
                      )}
                    </div>

                    {l.manual && (
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Manual unit cost</Label>
                          <Input type="number" min={0} step="any" value={l.manual_cost} onChange={(e) => updateLine(l.key, { manual_cost: e.target.value })} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">Reason (required)</Label>
                          <Input value={l.manual_reason} onChange={(e) => updateLine(l.key, { manual_reason: e.target.value })} placeholder="Why is a manual cost needed?" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Charges & details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Shipping"><Input type="number" min={0} step="any" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" /></Field>
                <Field label="Fees"><Input type="number" min={0} step="any" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" /></Field>
                <Field label="Tax"><Input type="number" min={0} step="any" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" /></Field>
                <Field label="Expected date"><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
              </div>
              <div className="space-y-1.5">
                <Label>Payment terms</Label>
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 50% deposit, balance before shipment" />
              </div>
              <div className="space-y-1.5">
                <Label>Notes / manufacturing instructions (appear on the PO)</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Manufacturing notes or instructions…" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-6">
            <CardHeader><CardTitle>PO summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Subtotal" value={formatCurrency(subtotal, currency)} />
              {Number(shipping) > 0 && <Row label="Shipping" value={formatCurrency(Number(shipping), currency)} muted />}
              {Number(fees) > 0 && <Row label="Fees" value={formatCurrency(Number(fees), currency)} muted />}
              {Number(tax) > 0 && <Row label="Tax" value={formatCurrency(Number(tax), currency)} muted />}
              <div className="my-1 border-t border-border" />
              <Row label="Total" value={formatCurrency(total, currency)} strong />
              <p className="pt-1 text-[11px] text-muted-foreground">Costs resolve from this manufacturer&apos;s cost file. Send the PO to lock the snapshot and allocate a PO number.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
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
