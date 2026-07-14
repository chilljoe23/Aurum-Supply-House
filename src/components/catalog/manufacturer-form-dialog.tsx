"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createManufacturer } from "@/app/(app)/catalog/actions";

export function ManufacturerFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dupPrompt, setDupPrompt] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "", legal_name: "", contact_name: "", email: "", phone: "",
    payment_terms: "", default_currency: "USD", notes: "", active: true,
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(force: boolean) {
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      payment_terms: form.payment_terms || undefined,
    };
    const res = await createManufacturer(payload, force);
    setSaving(false);
    if (!res.ok) {
      if (res.fieldErrors?._duplicateOf) {
        setDupPrompt(true);
        setError(res.error);
        return;
      }
      setError(res.error);
      return;
    }
    setDupPrompt(false);
    onOpenChange(false);
    setForm({ name: "", legal_name: "", contact_name: "", email: "", phone: "", payment_terms: "", default_currency: "USD", notes: "", active: true });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add manufacturer</DialogTitle>
          <DialogDescription>Suppliers you purchase from. Names are checked for near-duplicates.</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mname">Name *</Label>
            <Input id="mname" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="legal">Legal Name</Label>
              <Input id="legal" value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact">Contact Name</Label>
              <Input id="contact" value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terms">Payment Terms</Label>
              <select id="terms" value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">—</option>
                <option value="due_on_receipt">Due on receipt</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_45">Net 45</option>
                <option value="net_60">Net 60</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur">Default Currency</Label>
              <Input id="cur" value={form.default_currency} onChange={(e) => set("default_currency", e.target.value.toUpperCase())} maxLength={3} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mnotes">Notes</Label>
            <Textarea id="mnotes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {dupPrompt ? (
              <Button type="button" variant="destructive" disabled={saving} onClick={() => submit(true)}>Create anyway</Button>
            ) : (
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create manufacturer"}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
