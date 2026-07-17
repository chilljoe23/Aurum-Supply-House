"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { assignInvoiceLot } from "@/app/(app)/orders/actions";

function fmt(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "";
}

export function LotEditor({
  itemId,
  invoiceId,
  lotNumber,
  manufacturingDate,
  expirationDate,
  retestDate,
  canManage,
}: {
  itemId: string;
  invoiceId: string;
  lotNumber: string | null;
  manufacturingDate: string | null;
  expirationDate: string | null;
  retestDate: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [lot, setLot] = React.useState(lotNumber ?? "");
  const [mfg, setMfg] = React.useState(manufacturingDate ?? "");
  const [exp, setExp] = React.useState(expirationDate ?? "");
  const [retest, setRetest] = React.useState(retestDate ?? "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const hasLot = lotNumber || manufacturingDate || expirationDate || retestDate;

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await assignInvoiceLot(
      {
        item_id: itemId,
        lot_number: lot || undefined,
        manufacturing_date: mfg || undefined,
        expiration_date: exp || undefined,
        retest_date: retest || undefined,
      },
      invoiceId,
    );
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {hasLot ? (
        <span className="inline-flex items-center gap-1">
          <Tag className="h-3 w-3" />
          {lotNumber ? `Lot ${lotNumber}` : "Lot —"}
          {expirationDate ? ` · Exp ${fmt(expirationDate)}` : ""}
          {manufacturingDate ? ` · Mfg ${fmt(manufacturingDate)}` : ""}
          {retestDate ? ` · Retest ${fmt(retestDate)}` : ""}
        </span>
      ) : (
        <span className="text-muted-foreground/70">No lot assigned</span>
      )}
      {canManage && (
        <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setOpen(true)}>
          {hasLot ? "Edit lot" : "Assign lot"}
        </button>
      )}

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign lot number</DialogTitle>
              <DialogDescription>Lot traceability is captured as a line snapshot. On an issued invoice this uses a narrowly-scoped, audited update.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Lot number</Label>
                <Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="e.g. AUR-24-0417" />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Manufacturing date</Label><Input type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Expiration date</Label><Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Retest date</Label><Input type="date" value={retest} onChange={(e) => setRetest(e.target.value)} /></div>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save lot</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
