"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";
import { getBulkPreview, bulkAdjust } from "@/app/(app)/pricing/actions";

type Preview = { sku: string; name: string; selling_price: number; new_price: number; min_quantity: number; max_quantity: number | null; invalid: boolean };

export function BulkAdjustDialog({ open, onOpenChange, sheetId, currency }: {
  open: boolean; onOpenChange: (o: boolean) => void; sheetId: string; currency: string;
}) {
  const router = useRouter();
  const [type, setType] = React.useState<"percent" | "fixed">("percent");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [preview, setPreview] = React.useState<Preview[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function runPreview() {
    setBusy(true); setError(null);
    const rows = await getBulkPreview(sheetId, type, Number(value || 0));
    setBusy(false); setPreview(rows as Preview[]);
  }
  async function apply() {
    setBusy(true); setError(null);
    const res = await bulkAdjust({ pricing_sheet_id: sheetId, type, value: Number(value || 0), product_ids: null, reason });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onOpenChange(false); setPreview(null); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk price adjustment</DialogTitle>
          <DialogDescription>Preview before applying. Every change is effective-dated and audited; historical orders are never touched.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["percent", "fixed"] as const).map((t) => (
              <button key={t} onClick={() => { setType(t); setPreview(null); }} className={cn("rounded px-3 py-1 text-xs capitalize", type === t ? "bg-secondary font-medium text-foreground" : "text-muted-foreground")}>{t === "percent" ? "Percent %" : "Fixed $"}</button>
            ))}
          </div>
          <div className="space-y-1.5"><Label htmlFor="val">{type === "percent" ? "Percent (e.g. 10 or -5)" : `Amount (${currency})`}</Label>
            <Input id="val" type="number" step="0.01" value={value} onChange={(e) => { setValue(e.target.value); setPreview(null); }} className="w-40" /></div>
          <Button variant="outline" onClick={runPreview} disabled={busy || value === ""}>Preview</Button>
        </div>

        {preview && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="max-h-[320px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card"><TableRow className="hover:bg-transparent">
                    <TableHead>SKU</TableHead><TableHead>Band</TableHead><TableHead className="text-right">Current</TableHead><TableHead className="text-right">New</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {preview.map((r, i) => (
                      <TableRow key={i} className={r.invalid ? "opacity-50" : ""}>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.min_quantity}{r.max_quantity ? `–${r.max_quantity}` : "+"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(r.selling_price, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{r.invalid ? "skipped" : formatCurrency(r.new_price, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="reason">Reason *</Label><Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for this bulk change" required /></div>
          </div>
        )}

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={busy || !preview || reason.trim() === ""}>{busy ? "Applying…" : "Apply adjustment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
