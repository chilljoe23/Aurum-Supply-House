"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createPricingModel, updatePricingModel } from "@/app/(app)/pricing/actions";
import type { PricingModel } from "@/lib/pricing/queries";

export function ModelFormDialog({ open, onOpenChange, mode, model }: {
  open: boolean; onOpenChange: (o: boolean) => void; mode: "create" | "edit"; model?: PricingModel;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    name: model?.name ?? "", code: model?.code ?? "", description: model?.description ?? "",
    currency: model?.currency ?? "USD", effective_date: model?.effective_date ?? "",
    expiration_date: model?.expiration_date ?? "", is_default: model?.is_default ?? false,
    notes: model?.notes ?? "", active: model ? model.status === "active" : true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    const res = mode === "create" ? await createPricingModel(f) : await updatePricingModel(model!.id, f);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onOpenChange(false); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create pricing model" : "Edit pricing model"}</DialogTitle>
          <DialogDescription>Reusable selling prices — assign to clients or select at order time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="name">Name *</Label><Input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="code">Code</Label><Input id="code" value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. VIP" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="desc">Description</Label><Textarea id="desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label htmlFor="cur">Currency</Label><Input id="cur" value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} /></div>
            <div className="space-y-1.5"><Label htmlFor="eff">Effective</Label><Input id="eff" type="date" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="exp">Expires</Label><Input id="exp" type="date" value={f.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.is_default} onChange={(e) => set("is_default", e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Default model for this currency
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Active
          </label>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create model" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
