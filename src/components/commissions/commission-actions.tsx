"use client";

import * as React from "react";
import { BadgeCheck, Ban, Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/orders/schemas";
import { formatCurrency } from "@/lib/utils";
import { approveCommission, payCommission, voidCommission } from "@/app/(app)/commissions/actions";

const today = () => new Date().toISOString().slice(0, 10);

// Inline lifecycle actions for a single commission. Only rendered for Owner/Admin.
export function CommissionActions({
  id,
  status,
  amount,
  currency,
  size = "sm",
  onDone,
}: {
  id: string;
  status: string;
  amount: number;
  currency: string;
  size?: "sm" | "default";
  onDone: () => void;
}) {
  const [dialog, setDialog] = React.useState<null | "pay" | "void">(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    const res = await approveCommission({ commission_id: id });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "earned" && (
        <Button size={size} variant="outline" onClick={approve} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve
        </Button>
      )}
      {status === "approved" && (
        <Button size={size} onClick={() => setDialog("pay")}>
          <Coins className="h-4 w-4" /> Mark paid
        </Button>
      )}
      {status !== "paid" && status !== "void" && (
        <Button size={size} variant="ghost" onClick={() => setDialog("void")} title="Void commission">
          <Ban className="h-4 w-4" />
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}

      {dialog === "pay" && (
        <PayDialog id={id} amount={amount} currency={currency} onClose={() => setDialog(null)} onDone={onDone} />
      )}
      {dialog === "void" && <VoidDialog id={id} onClose={() => setDialog(null)} onDone={onDone} />}
    </div>
  );
}

function PayDialog({ id, amount, currency, onClose, onDone }: { id: string; amount: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState("wire");
  const [reference, setReference] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(today());
  const [note, setNote] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await payCommission({ commission_id: id, method, reference: reference || undefined, note: note || undefined, paid_at: paidAt });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark commission paid</DialogTitle>
          <DialogDescription>
            Recording {formatCurrency(amount, currency)} as paid. This is permanent and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Method</Label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Paid on</Label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #, wire ref…" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await voidCommission({ commission_id: id, reason: reason || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void commission</DialogTitle>
          <DialogDescription>
            Voiding keeps the record for audit and removes it from owed totals. Paid commissions can never be voided.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Reason (optional)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this commission being voided?" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
