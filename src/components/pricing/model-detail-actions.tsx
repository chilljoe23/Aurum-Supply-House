"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Copy, Power, Plus, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelFormDialog } from "@/components/pricing/model-form-dialog";
import { PriceItemDialog, type ProductOption } from "@/components/pricing/price-item-dialog";
import { BulkAdjustDialog } from "@/components/pricing/bulk-adjust-dialog";
import { setModelStatus, duplicateModel } from "@/app/(app)/pricing/actions";
import type { PricingModel } from "@/lib/pricing/queries";

export function ModelDetailActions({ model, products }: {
  model: PricingModel; products: ProductOption[];
}) {
  const router = useRouter();
  const [edit, setEdit] = React.useState(false);
  const [addPrice, setAddPrice] = React.useState(false);
  const [bulk, setBulk] = React.useState(false);
  const [dup, setDup] = React.useState(false);
  const [dupName, setDupName] = React.useState(`${model.name} Copy`);
  const [dupCode, setDupCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function toggle() {
    setBusy(true); await setModelStatus(model.id, model.status !== "active"); setBusy(false); router.refresh();
  }
  async function doDuplicate() {
    setBusy(true);
    const res = await duplicateModel(model.id, dupName, dupCode);
    setBusy(false); setDup(false);
    if (res.ok && res.data) router.push(`/pricing/${res.data.id}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setBulk(true)}><Percent className="h-4 w-4" /> Bulk adjust</Button>
      <Button variant="outline" size="sm" onClick={() => setDup(true)}><Copy className="h-4 w-4" /> Duplicate</Button>
      <Button variant="outline" size="sm" onClick={toggle} disabled={busy}><Power className="h-4 w-4" />{model.status === "active" ? "Deactivate" : "Activate"}</Button>
      <Button variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Edit</Button>
      <Button size="sm" onClick={() => setAddPrice(true)}><Plus className="h-4 w-4" /> Add price</Button>

      <ModelFormDialog open={edit} onOpenChange={setEdit} mode="edit" model={model} />
      <PriceItemDialog open={addPrice} onOpenChange={setAddPrice} sheetId={model.id} currency={model.currency} products={products} />
      <BulkAdjustDialog open={bulk} onOpenChange={setBulk} sheetId={model.id} currency={model.currency} />

      <Dialog open={dup} onOpenChange={setDup}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Duplicate model</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="dn">New name</Label><Input id="dn" value={dupName} onChange={(e) => setDupName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="dc">New code</Label><Input id="dc" value={dupCode} onChange={(e) => setDupCode(e.target.value)} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDup(false)}>Cancel</Button>
              <Button onClick={doDuplicate} disabled={busy || !dupName.trim()}>Duplicate</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
