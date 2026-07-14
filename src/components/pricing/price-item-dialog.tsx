"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { setPrice } from "@/app/(app)/pricing/actions";

export type ProductOption = { id: string; sku: string; name: string };

export function PriceItemDialog({ open, onOpenChange, sheetId, currency, products, preset }: {
  open: boolean; onOpenChange: (o: boolean) => void; sheetId: string; currency: string;
  products: ProductOption[]; preset?: { product_id: string; min_quantity: number; max_quantity: number | null; selling_price: number };
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    product_id: preset?.product_id ?? "", min_quantity: String(preset?.min_quantity ?? 1),
    max_quantity: preset?.max_quantity != null ? String(preset.max_quantity) : "",
    selling_price: preset?.selling_price != null ? String(preset.selling_price) : "",
    effective_date: "", expiration_date: "", active: true, notes: "", reason: "",
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    const res = await setPrice({
      pricing_sheet_id: sheetId, product_id: f.product_id, currency,
      min_quantity: Number(f.min_quantity || 1), max_quantity: f.max_quantity ? Number(f.max_quantity) : null,
      selling_price: f.selling_price ? Number(f.selling_price) : undefined,
      effective_date: f.effective_date || "", expiration_date: f.expiration_date || "",
      active: f.active, notes: f.notes, reason: f.reason,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onOpenChange(false); router.refresh();
  }

  const options = products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}`, hint: p.sku }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{preset ? "Update price" : "Add price"}</DialogTitle>
          <DialogDescription>Effective-dated. Changing an existing band closes the old record and appends a new one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <SearchableSelect options={options} value={f.product_id} onChange={(v) => set("product_id", v)} placeholder="Select product" disabled={!!preset} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label htmlFor="minq">Min Qty</Label><Input id="minq" type="number" min="1" value={f.min_quantity} onChange={(e) => set("min_quantity", e.target.value)} disabled={!!preset} /></div>
            <div className="space-y-1.5"><Label htmlFor="maxq">Max Qty</Label><Input id="maxq" type="number" min="1" value={f.max_quantity} onChange={(e) => set("max_quantity", e.target.value)} placeholder="∞" /></div>
            <div className="space-y-1.5"><Label htmlFor="price">Price ({currency})</Label><Input id="price" type="number" step="0.0001" min="0" value={f.selling_price} onChange={(e) => set("selling_price", e.target.value)} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="eff">Effective</Label><Input id="eff" type="date" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="exp">Expires</Label><Input id="exp" type="date" value={f.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="reason">Reason *</Label><Input id="reason" value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why is this price being set?" required /></div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !f.product_id}>{saving ? "Saving…" : "Save price"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
