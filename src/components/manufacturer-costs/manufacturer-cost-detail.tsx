"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, Download, Plus, Star, ArrowUpCircle, Loader2, AlertTriangle, Layers, History, FileSpreadsheet, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { EmptyState } from "@/components/patterns/empty-state";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/catalog/csv";
import {
  setManufacturerCost, upsertManufacturerProduct, setManufacturerProductActive,
  endManufacturerCostBand, promoteManufacturerCost, getManufacturerCostSignedDownload,
} from "@/app/(app)/catalog/manufacturers/actions";
import type {
  ManufacturerDetail, ManufacturerProductCost, ManufacturerCostBand, ManufacturerCostHistoryRow, ManufacturerImportBatch,
} from "@/lib/manufacturer-costs/queries";

const fmtDate = (s: string | null) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString() : "—");

type Tab = "costs" | "tiers" | "history" | "imports";

export function ManufacturerCostDetail({
  manufacturer, costs, bands, history, batches, activeProducts,
}: {
  manufacturer: ManufacturerDetail;
  costs: ManufacturerProductCost[];
  bands: ManufacturerCostBand[];
  history: ManufacturerCostHistoryRow[];
  batches: ManufacturerImportBatch[];
  activeProducts: { id: string; sku: string; name: string }[];
}) {
  const [tab, setTab] = React.useState<Tab>("costs");
  const [costDialog, setCostDialog] = React.useState<{ rel: ManufacturerProductCost; tier: boolean } | null>(null);
  const [promoteFor, setPromoteFor] = React.useState<ManufacturerProductCost | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  const withoutCost = costs.filter((c) => c.current_unit_cost === null && c.active_band_count === 0);
  const lastUpdate = costs.reduce<string | null>((acc, c) => (c.last_cost_update && (!acc || c.last_cost_update > acc) ? c.last_cost_update : acc), null);
  // SKUs already linked to this manufacturer — excluded from the "add product" picker.
  const linkedProductIds = new Set(costs.map((c) => c.product_id));

  function exportCostSheet() {
    downloadCsv(
      `${manufacturer.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-costs.csv`,
      toCsv(
        [
          { key: "sku", label: "SKU" }, { key: "product_name", label: "Product Name" },
          { key: "manufacturer_sku", label: "Manufacturer SKU" }, { key: "current_unit_cost", label: "Unit Cost" },
          { key: "currency", label: "Currency" }, { key: "moq", label: "MOQ" },
          { key: "order_multiple", label: "Order Multiple" }, { key: "lead_time_days", label: "Lead Time" },
          { key: "active", label: "Active" }, { key: "cost_effective_date", label: "Effective Date" },
        ],
        costs.map((c) => ({
          sku: c.sku, product_name: c.product_name, manufacturer_sku: c.manufacturer_sku ?? "",
          current_unit_cost: c.current_unit_cost ?? "", currency: c.currency, moq: c.moq ?? "",
          order_multiple: c.order_multiple ?? "", lead_time_days: c.lead_time_days ?? "",
          active: c.active ? "Yes" : "No", cost_effective_date: c.cost_effective_date ?? "",
        })),
      ),
    );
  }

  return (
    <div className="space-y-5">
      {/* header actions + status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={manufacturer.status === "active" ? "success" : "outline"}>{manufacturer.status === "active" ? "Active" : "Inactive"}</Badge>
          <span>{manufacturer.default_currency}</span>
          {manufacturer.payment_terms && <span>· {manufacturer.payment_terms}</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCostSheet} disabled={costs.length === 0}><Download className="h-4 w-4" /> Export cost sheet</Button>
          <Button size="sm" asChild><Link href={`/catalog/manufacturers/import?manufacturer=${manufacturer.id}`}><Upload className="h-4 w-4" /> Import cost file</Link></Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Products supplied" value={String(costs.length)} />
        <Kpi label="Without a current cost" value={String(withoutCost.length)} tone={withoutCost.length ? "warning" : "muted"} />
        <Kpi label="Active cost tiers" value={String(bands.length)} />
        <Kpi label="Last cost update" value={fmtDate(lastUpdate)} />
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-border text-sm">
        <TabBtn active={tab === "costs"} onClick={() => setTab("costs")} icon={DollarSign}>Costs</TabBtn>
        <TabBtn active={tab === "tiers"} onClick={() => setTab("tiers")} icon={Layers}>Tiers ({bands.length})</TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={History}>History</TabBtn>
        <TabBtn active={tab === "imports"} onClick={() => setTab("imports")} icon={FileSpreadsheet}>Imports ({batches.length})</TabBtn>
      </div>

      {tab === "costs" && (
        <div className="space-y-4">
          {withoutCost.length > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{withoutCost.length} supplied product{withoutCost.length > 1 ? "s have" : " has"} no current cost: {withoutCost.slice(0, 6).map((c) => c.sku).join(", ")}{withoutCost.length > 6 ? "…" : ""}. Set a cost or import a file.</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add product</Button>
          </div>
          {costs.length === 0 ? (
            <EmptyState icon={DollarSign} title="No products supplied yet" description="Import a cost file or add a product to start tracking this manufacturer’s costs." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">
                    <TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Mfr SKU</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">MOQ</TableHead>
                    <TableHead className="text-right">Mult.</TableHead><TableHead className="text-right">Lead</TableHead>
                    <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {costs.map((c) => (
                      <TableRow key={c.manufacturer_product_id}>
                        <TableCell className="font-mono text-xs">{c.sku}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{c.product_name}
                          {c.is_preferred && <Badge variant="success" className="ml-2"><Star className="mr-0.5 h-3 w-3" />Preferred</Badge>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{c.manufacturer_sku ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.current_unit_cost != null ? formatCurrency(c.current_unit_cost, c.currency) : <span className="text-warning-foreground">Not set</span>}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{c.moq ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{c.order_multiple ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{c.lead_time_days != null ? `${c.lead_time_days}d` : "—"}</TableCell>
                        <TableCell><Badge variant={c.active ? "success" : "outline"}>{c.active ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setCostDialog({ rel: c, tier: false })}>Set cost</Button>
                            <Button variant="ghost" size="sm" onClick={() => setCostDialog({ rel: c, tier: true })}>Tier</Button>
                            <Button variant="ghost" size="sm" disabled={c.current_unit_cost == null} onClick={() => setPromoteFor(c)}><ArrowUpCircle className="h-3.5 w-3.5" /> Promote</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "tiers" && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {bands.length === 0 ? <EmptyState icon={Layers} title="No active tiers" description="Quantity-cost tiers appear here when set or imported." /> : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Tier</TableHead>
                <TableHead className="text-right">Unit cost</TableHead><TableHead>Effective</TableHead><TableHead>Source</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {bands.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{b.product_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{b.min_quantity}{b.max_quantity ? `–${b.max_quantity}` : "+"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(b.unit_cost, b.currency)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(b.effective_date)}</TableCell>
                    <TableCell><Badge variant="outline">{b.source}</Badge></TableCell>
                    <TableCell className="text-right">{b.min_quantity > 1 && <EndBandButton bandId={b.id} manufacturerId={manufacturer.id} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {history.length === 0 ? <EmptyState icon={History} title="No cost history yet" /> : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card"><TableRow className="hover:bg-transparent">
                  <TableHead>SKU</TableHead><TableHead>Tier</TableHead><TableHead className="text-right">Old</TableHead>
                  <TableHead className="text-right">New</TableHead><TableHead>Effective</TableHead><TableHead>Closed</TableHead>
                  <TableHead>Source</TableHead><TableHead>Reason</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-xs">{h.sku}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.min_quantity}{h.max_quantity ? `–${h.max_quantity}` : "+"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{h.previous_cost != null ? formatCurrency(h.previous_cost, h.currency) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(h.unit_cost, h.currency)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(h.effective_date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.effective_to ? fmtDate(h.effective_to) : <Badge variant="success">Open</Badge>}</TableCell>
                      <TableCell><Badge variant="outline">{h.source}</Badge></TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{h.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {tab === "imports" && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {batches.length === 0 ? <EmptyState icon={FileSpreadsheet} title="No imports yet" description="Cost-file imports appear here with their results and original files." /> : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">New</TableHead><TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Tiers</TableHead><TableHead className="text-right">Skipped</TableHead>
                <TableHead>When</TableHead><TableHead className="text-right">Files</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-[220px] truncate">{b.filename}</TableCell>
                    <TableCell><Badge variant={b.status === "committed" ? "success" : b.status === "failed" ? "destructive" : "outline"}>{b.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{b.relationships_created}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.costs_created}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.costs_updated}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.tiers_changed}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rows_skipped}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(b.committed_at ?? b.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <DownloadBtn path={b.storage_path} label="Original" />
                        {b.error_report_path && <DownloadBtn path={b.error_report_path} label="Errors" />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {costDialog && <SetCostDialog rel={costDialog.rel} tier={costDialog.tier} onClose={() => setCostDialog(null)} />}
      {promoteFor && <PromoteDialog rel={promoteFor} onClose={() => setPromoteFor(null)} />}
      <AddProductDialog
        open={addOpen} onOpenChange={setAddOpen} manufacturerId={manufacturer.id} currency={manufacturer.default_currency}
        products={activeProducts.filter((p) => !linkedProductIds.has(p.id))}
      />
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-1.5 border-b-2 px-3 py-2 -mb-px", active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}
function Kpi({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "warning" }) {
  return <div className="rounded-lg border border-border bg-card p-4"><div className={cn("text-xl font-semibold tabular-nums", tone === "warning" ? "text-warning-foreground" : "text-foreground")}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></div>;
}

function DownloadBtn({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = React.useState(false);
  async function go() {
    setBusy(true);
    const res = await getManufacturerCostSignedDownload(path);
    setBusy(false);
    if (res.ok) window.open(res.data!.url, "_blank");
  }
  return <Button variant="ghost" size="sm" onClick={go} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {label}</Button>;
}

function EndBandButton({ bandId, manufacturerId }: { bandId: string; manufacturerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function go() {
    setBusy(true);
    const res = await endManufacturerCostBand(bandId, manufacturerId);
    setBusy(false);
    if (res.ok) router.refresh();
  }
  return <Button variant="ghost" size="sm" onClick={go} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "End tier"}</Button>;
}

function SetCostDialog({ rel, tier, onClose }: { rel: ManufacturerProductCost; tier: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    min_quantity: tier ? "" : "1", max_quantity: "", unit_cost: tier ? "" : (rel.current_unit_cost != null ? String(rel.current_unit_cost) : ""),
    currency: rel.currency, effective_date: "", expiration_date: "", active: true, reason: "",
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await setManufacturerCost({
      manufacturer_product_id: rel.manufacturer_product_id,
      min_quantity: form.min_quantity || 1, max_quantity: form.max_quantity || null,
      unit_cost: form.unit_cost, currency: form.currency,
      effective_date: form.effective_date, expiration_date: form.expiration_date,
      active: form.active, reason: form.reason,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onClose(); router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tier ? "Add / update quantity tier" : "Set unit cost"}</DialogTitle>
          <DialogDescription>{rel.sku} · {rel.product_name}. Costs are effective-dated and append-only — the previous cost is preserved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Min quantity</Label><Input type="number" value={form.min_quantity} onChange={(e) => set("min_quantity", e.target.value)} placeholder="1" disabled={!tier} /></div>
            <div><Label>Max quantity</Label><Input type="number" value={form.max_quantity} onChange={(e) => set("max_quantity", e.target.value)} placeholder="(unbounded)" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Unit cost</Label><Input value={form.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} placeholder="0.00" /></div>
            <div><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Effective date</Label><Input type="date" value={form.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
            <div><Label>Expiration date</Label><Input type="date" value={form.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} /></div>
          </div>
          <div><Label>Reason</Label><Textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why is this cost changing?" rows={2} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || !form.unit_cost || !form.reason.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save cost</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({ rel, onClose }: { rel: ManufacturerProductCost; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [effective, setEffective] = React.useState("");
  const [setPreferred, setSetPreferred] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await promoteManufacturerCost({
      manufacturer_id: rel.manufacturer_id, product_id: rel.product_id, reason,
      effective_date: effective, set_preferred: setPreferred,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onClose(); router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote to catalog true cost</DialogTitle>
          <DialogDescription>Sets {rel.sku}’s catalog true cost to this manufacturer’s current base cost ({formatCurrency(rel.current_unit_cost, rel.currency)}). This affects future sales profitability — historical invoices are never changed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div><Label>Effective date</Label><Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></div>
          <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why promote this cost now?" rows={2} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setPreferred} onChange={(e) => setSetPreferred(e.target.checked)} /> Mark this manufacturer as the product’s preferred source</label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || !reason.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />} Promote</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddProductDialog({ open, onOpenChange, manufacturerId, currency, products }: {
  open: boolean; onOpenChange: (o: boolean) => void; manufacturerId: string; currency: string;
  products: { id: string; sku: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = React.useState({ product_id: "", manufacturer_sku: "", manufacturer_description: "", currency, moq: "", order_multiple: "", lead_time_days: "", notes: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await upsertManufacturerProduct({
      manufacturer_id: manufacturerId, product_id: form.product_id, manufacturer_sku: form.manufacturer_sku,
      manufacturer_description: form.manufacturer_description, currency: form.currency,
      moq: form.moq, order_multiple: form.order_multiple, lead_time_days: form.lead_time_days, active: true, notes: form.notes,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setForm({ product_id: "", manufacturer_sku: "", manufacturer_description: "", currency, moq: "", order_multiple: "", lead_time_days: "", notes: "" });
    onOpenChange(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a supplied product</DialogTitle>
          <DialogDescription>Link an existing catalog product to this manufacturer. Set its cost afterward. Products are matched by SKU.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div><Label>Product</Label><SearchableSelect options={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} value={form.product_id} onChange={(v) => set("product_id", v)} placeholder="Select a product" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Manufacturer SKU</Label><Input value={form.manufacturer_sku} onChange={(e) => set("manufacturer_sku", e.target.value)} /></div>
            <div><Label>Currency</Label><Input value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
          </div>
          <div><Label>Manufacturer description</Label><Input value={form.manufacturer_description} onChange={(e) => set("manufacturer_description", e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>MOQ</Label><Input type="number" value={form.moq} onChange={(e) => set("moq", e.target.value)} /></div>
            <div><Label>Order multiple</Label><Input type="number" value={form.order_multiple} onChange={(e) => set("order_multiple", e.target.value)} /></div>
            <div><Label>Lead time (days)</Label><Input type="number" value={form.lead_time_days} onChange={(e) => set("lead_time_days", e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || !form.product_id}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add product</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
