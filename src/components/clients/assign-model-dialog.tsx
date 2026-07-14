"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { assignPricingModel } from "@/app/(app)/clients/actions";

export function AssignModelDialog({ open, onOpenChange, clientId, models, current }: {
  open: boolean; onOpenChange: (o: boolean) => void; clientId: string;
  models: { id: string; name: string; code: string | null; currency: string }[]; current: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ pricing_sheet_id: current ?? "", effective_date: "", expiration_date: "", notes: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(null);
    const res = await assignPricingModel({ client_id: clientId, ...f });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onOpenChange(false); router.refresh();
  }
  const options = models.map((m) => ({ value: m.id, label: m.name, hint: m.code ?? m.currency }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Assign pricing model</DialogTitle><DialogDescription>Sets this client’s default model. Historical orders are never affected.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>Model</Label><SearchableSelect options={options} value={f.pricing_sheet_id} onChange={(v) => set("pricing_sheet_id", v)} placeholder="Select a model" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="eff">Effective</Label><Input id="eff" type="date" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="exp">Expires</Label><Input id="exp" type="date" value={f.expiration_date} onChange={(e) => set("expiration_date", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="notes">Notes</Label><Textarea id="notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || !f.pricing_sheet_id}>{saving ? "Saving…" : "Assign model"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
