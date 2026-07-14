"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { setClientOverride } from "@/app/(app)/clients/actions";

export function OverrideDialog({ open, onOpenChange, clientId, products }: {
  open: boolean; onOpenChange: (o: boolean) => void; clientId: string; products: { id: string; sku: string; name: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ product_id: "", min_quantity: "1", max_quantity: "", selling_price: "", currency: "USD", effective_date: "", expiration_date: "", reason: "", notes: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    const res = await setClientOverride({
      client_id: clientId, product_id: f.product_id, min_quantity: Number(f.min_quantity || 1),
      max_quantity: f.max_quantity ? Number(f.max_quantity) : null, selling_price: f.selling_price ? Number(f.selling_price) : undefined,
      currency: f.currency, effective_date: f.effective_date || "", expiration_date: f.expiration_date || "", reason: f.reason, notes: f.notes,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onOpenChange(false); router.refresh();
  }
  const options = products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}`, hint: p.sku }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Client-specific price override</DialogTitle><DialogDescription>Supersedes this client’s assigned model for the selected SKU and quantity band.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>Product</Label><SearchableSelect options={options} value={f.product_id} onChange={(v) => set("product_id", v)} placeholder="Select product" /></div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5"><Label htmlFor="minq">Min Qty</Label><Input id="minq" type="number" min="1" value={f.min_quantity} onChange={(e) => set("min_quantity", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="maxq">Max Qty</Label><Input id="maxq" type="number" min="1" value={f.max_quantity} onChange={(e) => set("max_quantity", e.target.value)} placeholder="∞" /></div>
            <div className="space-y-1.5"><Label htmlFor="price">Price</Label><Input id="price" type="number" step="0.0001" min="0" value={f.selling_price} onChange={(e) => set("selling_price", e.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="cur">Cur</Label><Input id="cur" value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="eff">Effective</Label><Input id="eff" type="date" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="exp">Expires</Label><Input id="exp" type="date" value={f.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="reason">Reason *</Label><Input id="reason" value={f.reason} onChange={(e) => set("reason", e.target.value)} required placeholder="Why this special price?" /></div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || !f.product_id}>{saving ? "Saving…" : "Save override"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
