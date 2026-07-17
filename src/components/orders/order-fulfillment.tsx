"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck, PackageCheck, Ban, ExternalLink, FileText, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { LineFulfillmentBadge } from "@/components/orders/fulfillment-status-badge";
import {
  OPERATIONAL_STATUSES,
  OPERATIONAL_LABELS,
  type OperationalStatus,
} from "@/lib/orders/fulfillment";
import { setLineFulfillmentStatus, createShipment, voidShipment } from "@/app/(app)/orders/actions";
import type { FulfillmentLine, ShipmentRow } from "@/lib/orders/queries";

const today = () => new Date().toISOString().slice(0, 10);
function qty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}
function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function OrderFulfillment({
  invoiceId,
  orderStatus,
  canManage,
  lines,
  shipments,
}: {
  invoiceId: string;
  orderStatus: string;
  canManage: boolean;
  lines: FulfillmentLine[];
  shipments: ShipmentRow[];
}) {
  const router = useRouter();
  const [showShip, setShowShip] = React.useState(false);

  // Shipping is an independent axis: only issued/partial/paid orders can ship.
  const canShip = orderStatus === "sent" || orderStatus === "partial" || orderStatus === "paid";
  const shippableLines = lines.filter((l) => l.operational_status !== "cancelled" && l.quantity_remaining > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" /> Fulfillment
        </CardTitle>
        {canManage && canShip && (
          <Button
            size="sm"
            onClick={() => setShowShip(true)}
            disabled={shippableLines.length === 0}
            title={shippableLines.length === 0 ? "Nothing remaining to ship" : undefined}
          >
            <Plus className="h-4 w-4" /> Create shipment
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Per-line fulfillment states */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 text-right font-medium">Ordered</th>
                <th className="py-2 pr-3 text-right font-medium">Shipped</th>
                <th className="py-2 pr-3 text-right font-medium">Remaining</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Latest shipment</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.invoice_item_id} className="border-b border-border align-top last:border-0">
                  <td className="py-2.5 pr-3 font-mono text-xs">{l.sku}</td>
                  <td className="py-2.5 pr-3">
                    {l.product_name}
                    {l.lot_number && <div className="mt-0.5 text-xs text-muted-foreground">Lot {l.lot_number}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{qty(l.quantity_ordered)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{qty(l.quantity_shipped)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{qty(l.quantity_remaining)}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-col gap-1.5">
                      <LineFulfillmentBadge status={l.fulfillment_status} />
                      {canManage && l.quantity_shipped < l.quantity_ordered && (
                        <LineStatusSelect
                          invoiceId={invoiceId}
                          itemId={l.invoice_item_id}
                          value={l.operational_status as OperationalStatus}
                          allowCancel={l.quantity_shipped === 0}
                          onDone={() => router.refresh()}
                        />
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-sm">
                    {l.latest_shipment_date ? (
                      <div>
                        {fmtDate(l.latest_shipment_date)}
                        {l.latest_tracking_number && (
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.latest_tracking_number}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No line items to fulfill.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Shipment history */}
        <ShipmentHistory
          invoiceId={invoiceId}
          shipments={shipments}
          canManage={canManage}
          onDone={() => router.refresh()}
        />
      </CardContent>

      {showShip && (
        <CreateShipmentDialog
          invoiceId={invoiceId}
          lines={shippableLines}
          onClose={() => setShowShip(false)}
          onDone={() => router.refresh()}
        />
      )}
    </Card>
  );
}

// ---- Per-line operational status control -----------------------------------
function LineStatusSelect({
  invoiceId,
  itemId,
  value,
  allowCancel,
  onDone,
}: {
  invoiceId: string;
  itemId: string;
  value: OperationalStatus;
  allowCancel: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function change(next: string) {
    if (next === value) return;
    setBusy(true);
    setErr(null);
    const res = await setLineFulfillmentStatus({ item_id: itemId, status: next }, invoiceId);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onDone();
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        aria-label="Set operational status"
      >
        {OPERATIONAL_STATUSES.map((s) => (
          <option key={s} value={s} disabled={s === "cancelled" && !allowCancel}>
            {OPERATIONAL_LABELS[s]}
          </option>
        ))}
      </select>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

// ---- Shipment history -------------------------------------------------------
function ShipmentHistory({
  invoiceId,
  shipments,
  canManage,
  onDone,
}: {
  invoiceId: string;
  shipments: ShipmentRow[];
  canManage: boolean;
  onDone: () => void;
}) {
  const [voidTarget, setVoidTarget] = React.useState<ShipmentRow | null>(null);

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <PackageCheck className="h-4 w-4 text-muted-foreground" /> Shipment history
      </h3>
      {shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shipments yet.</p>
      ) : (
        <ul className="space-y-3">
          {shipments.map((s) => {
            const isVoid = s.status === "void";
            return (
              <li
                key={s.id}
                className={`rounded-lg border border-border p-3 text-sm ${isVoid ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{s.shipment_number}</span>
                    {isVoid && <span className="text-xs uppercase tracking-wide text-destructive">Voided</span>}
                    <span className="text-muted-foreground">· {fmtDate(s.shipment_date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/orders/${invoiceId}/shipments/${s.id}/packing-slip`}>
                        <FileText className="h-4 w-4" /> Packing slip
                      </Link>
                    </Button>
                    {canManage && !isVoid && (
                      <Button variant="ghost" size="sm" onClick={() => setVoidTarget(s)}>
                        <Ban className="h-4 w-4" /> Void
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-1 text-muted-foreground">
                  {[s.carrier, s.service].filter(Boolean).join(" · ") || "Carrier not specified"}
                  {s.tracking_number && (
                    <>
                      {" · "}
                      {s.tracking_url ? (
                        <a
                          href={s.tracking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-foreground underline underline-offset-2"
                        >
                          {s.tracking_number} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-foreground">{s.tracking_number}</span>
                      )}
                    </>
                  )}
                </div>

                <ul className="mt-2 space-y-0.5">
                  {s.items.map((it) => (
                    <li key={it.id} className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">{it.sku}</span>
                      <span className="text-foreground">{qty(it.quantity_shipped)} ×</span>
                      <span>{it.product_name}</span>
                      {it.lot_number && <span>· Lot {it.lot_number}</span>}
                      {it.expiration_date && <span>· Exp {fmtDate(it.expiration_date)}</span>}
                    </li>
                  ))}
                </ul>

                <div className="mt-2 text-xs text-muted-foreground">
                  {s.item_count} line(s) · {qty(s.total_quantity)} unit(s)
                  {s.created_by_name ? ` · by ${s.created_by_name}` : ""} · {fmtDateTime(s.created_at)}
                  {isVoid && s.voided_reason ? ` · Void reason: ${s.voided_reason}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {voidTarget && (
        <VoidShipmentDialog
          invoiceId={invoiceId}
          shipment={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// ---- Void shipment dialog ---------------------------------------------------
function VoidShipmentDialog({
  invoiceId,
  shipment,
  onClose,
  onDone,
}: {
  invoiceId: string;
  shipment: ShipmentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await voidShipment({ shipment_id: shipment.id, reason }, invoiceId);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void shipment {shipment.shipment_number}</DialogTitle>
          <DialogDescription>
            The record is retained (append-only) and its quantities stop counting toward shipped totals, restoring the
            remaining balance. This is audited.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this shipment being voided?" />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={run} disabled={busy || reason.trim().length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Void shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create shipment dialog -------------------------------------------------
type ShipRow = { line: FulfillmentLine; selected: boolean; quantity: string; lot: string };

function CreateShipmentDialog({
  invoiceId,
  lines,
  onClose,
  onDone,
}: {
  invoiceId: string;
  lines: FulfillmentLine[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = React.useState<ShipRow[]>(() =>
    lines.map((l) => ({ line: l, selected: false, quantity: String(l.quantity_remaining), lot: l.lot_number ?? "" })),
  );
  const [shipmentDate, setShipmentDate] = React.useState(today());
  const [carrier, setCarrier] = React.useState("");
  const [service, setService] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [trackingUrl, setTrackingUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [preview, setPreview] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function update(idx: number, patch: Partial<ShipRow>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const selected = rows.filter((r) => r.selected);
  // Client-side over-ship guard mirrors the DB's authoritative check.
  const localError = (() => {
    if (selected.length === 0) return "Select at least one line to ship.";
    for (const r of selected) {
      const q = Number(r.quantity);
      if (!(q > 0)) return `Enter a quantity greater than zero for ${r.line.sku}.`;
      if (q > r.line.quantity_remaining) return `Cannot ship ${q} of ${r.line.sku}; only ${qty(r.line.quantity_remaining)} remaining.`;
    }
    return null;
  })();

  async function confirm() {
    setBusy(true);
    setErr(null);
    const res = await createShipment({
      invoice_id: invoiceId,
      shipment_date: shipmentDate || undefined,
      carrier: carrier || undefined,
      service: service || undefined,
      tracking_number: tracking || undefined,
      tracking_url: trackingUrl || undefined,
      notes: notes || undefined,
      lines: selected.map((r) => ({
        invoice_item_id: r.line.invoice_item_id,
        quantity: Number(r.quantity),
        lot_number: r.lot.trim() || undefined,
      })),
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{preview ? "Review shipment" : "Create shipment"}</DialogTitle>
          <DialogDescription>
            {preview
              ? "Confirm the lines and quantities below. Saving records the shipment atomically and generates a packing slip."
              : "Select the lines shipping now and enter the quantity for each. Over-shipping is prevented."}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2 font-medium"> </th>
                    <th className="py-2 pr-2 font-medium">Line</th>
                    <th className="py-2 pr-2 text-right font-medium">Remaining</th>
                    <th className="py-2 pr-2 text-right font-medium">Ship qty</th>
                    <th className="py-2 pr-2 font-medium">Lot</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.line.invoice_item_id} className="border-b border-border last:border-0 align-top">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={(e) => update(i, { selected: e.target.checked })}
                          aria-label={`Include ${r.line.sku}`}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-mono text-xs">{r.line.sku}</div>
                        <div className="text-muted-foreground">{r.line.product_name}</div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{qty(r.line.quantity_remaining)}</td>
                      <td className="py-2 pr-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          max={r.line.quantity_remaining}
                          step="any"
                          value={r.quantity}
                          disabled={!r.selected}
                          onChange={(e) => update(i, { quantity: e.target.value })}
                          className="h-8 w-24 text-right"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          value={r.lot}
                          disabled={!r.selected}
                          onChange={(e) => update(i, { lot: e.target.value })}
                          placeholder="Lot #"
                          className="h-8 w-28"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Shipment date</Label>
                <Input type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Carrier</Label>
                <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. FedEx" />
              </div>
              <div className="space-y-1.5">
                <Label>Service</Label>
                <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. Priority Overnight" />
              </div>
              <div className="space-y-1.5">
                <Label>Tracking number</Label>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Tracking URL (optional)</Label>
                <Input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Notes (internal — not on the packing slip)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            {localError && <p className="text-sm text-destructive">{localError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setPreview(true)} disabled={!!localError}>
                Review shipment
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Date:</span> {fmtDate(shipmentDate)}</div>
                <div><span className="text-muted-foreground">Carrier:</span> {carrier || "—"}</div>
                <div><span className="text-muted-foreground">Service:</span> {service || "—"}</div>
                <div><span className="text-muted-foreground">Tracking:</span> {tracking || "—"}</div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Line</th>
                  <th className="py-2 pr-2 text-right font-medium">Ship qty</th>
                  <th className="py-2 pr-2 font-medium">Lot</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((r) => (
                  <tr key={r.line.invoice_item_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2">
                      <span className="font-mono text-xs">{r.line.sku}</span> {r.line.product_name}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{qty(Number(r.quantity))}</td>
                    <td className="py-2 pr-2">{r.lot.trim() || r.line.lot_number || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(false)} disabled={busy}>Back</Button>
              <Button onClick={confirm} disabled={busy || !!localError}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Confirm & save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
