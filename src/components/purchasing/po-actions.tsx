"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Send, CreditCard, Ban, FileText, Trash2, Loader2, ChevronRight, Truck, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import {
  MFR_PAYMENT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
} from "@/lib/purchase-orders/schemas";
import { PO_STATUS_LABELS, nextStatuses, canVoid, canRecordPayment, type PoStatus } from "@/lib/purchase-orders/status";
import { sendPo, transitionPo, voidPo, recordManufacturerPayment, addPoShipment, receivePoLine, deletePoDraft } from "@/app/(app)/purchasing/actions";

const today = () => new Date().toISOString().slice(0, 10);

type Dlg = null | "send" | "advance" | "payment" | "void" | "tracking" | "receive" | "discard";

export type PoActionItem = { id: string; sku: string; product_name: string; quantity: number; quantity_received: number };

export function PoActions({
  id,
  status,
  currency,
  balanceDue,
  items,
}: {
  id: string;
  status: string;
  currency: string;
  balanceDue: number;
  items: PoActionItem[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<Dlg>(null);
  const st = status as PoStatus;
  const isDraft = st === "draft";
  const forward = nextStatuses(st);
  const done = () => router.refresh();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" asChild>
        <Link href={`/purchasing/${id}/document`}>
          <FileText className="h-4 w-4" /> {isDraft ? "Preview PO" : "Download PDF"}
        </Link>
      </Button>

      {isDraft && (
        <Button variant="outline" asChild>
          <Link href={`/purchasing/${id}/edit`}><Pencil className="h-4 w-4" /> Edit draft</Link>
        </Button>
      )}

      {isDraft && (
        <Button onClick={() => setDialog("send")}><Send className="h-4 w-4" /> Send PO</Button>
      )}

      {forward.length > 0 && (
        <Button onClick={() => setDialog("advance")}><ChevronRight className="h-4 w-4" /> Advance status</Button>
      )}

      {canRecordPayment(st) && (
        <Button variant="outline" onClick={() => setDialog("payment")}><CreditCard className="h-4 w-4" /> Record payment</Button>
      )}

      {!isDraft && st !== "void" && (
        <Button variant="outline" onClick={() => setDialog("tracking")}><Truck className="h-4 w-4" /> Add tracking</Button>
      )}

      {!isDraft && st !== "void" && (
        <Button variant="outline" onClick={() => setDialog("receive")}><PackageCheck className="h-4 w-4" /> Receive</Button>
      )}

      {canVoid(st) && (
        <Button variant="outline" onClick={() => setDialog("void")}><Ban className="h-4 w-4" /> Void</Button>
      )}

      {isDraft && (
        <Button variant="ghost" onClick={() => setDialog("discard")} title="Discard draft"><Trash2 className="h-4 w-4" /></Button>
      )}

      {dialog === "send" && <SendDialog id={id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "advance" && <AdvanceDialog id={id} options={forward} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "payment" && <PaymentDialog id={id} balanceDue={balanceDue} currency={currency} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "void" && <VoidDialog id={id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "tracking" && <TrackingDialog id={id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "receive" && <ReceiveDialog id={id} items={items} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "discard" && (
        <DiscardDialog id={id} onClose={() => setDialog(null)} onDone={() => { router.push("/purchasing"); router.refresh(); }} />
      )}
    </div>
  );
}

function useSubmit(fn: () => Promise<{ ok: boolean; error?: string }>, onClose: () => void, onDone: () => void) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Something went wrong."); return; }
    onDone();
    onClose();
  }
  return { busy, err, run };
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="text-sm text-destructive">{msg}</p>;
}

function SendDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, err, run } = useSubmit(() => sendPo({ po_id: id }), onClose, onDone);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send purchase order</DialogTitle>
          <DialogDescription>Allocates the PO number and locks the cost snapshot. The PO can no longer be edited.</DialogDescription>
        </DialogHeader>
        <Err msg={err} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({ id, options, onClose, onDone }: { id: string; options: PoStatus[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = React.useState<PoStatus>(options[0]);
  const [note, setNote] = React.useState("");
  const { busy, err, run } = useSubmit(() => transitionPo({ po_id: id, to, note: note || undefined }), onClose, onDone);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Advance status</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New status</Label>
            <select value={to} onChange={(e) => setTo(e.target.value as PoStatus)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {options.map((o) => <option key={o} value={o}>{PO_STATUS_LABELS[o]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context for this transition…" />
          </div>
          <Err msg={err} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Advance</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ id, balanceDue, currency, onClose, onDone }: { id: string; balanceDue: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = React.useState("deposit");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState("wire");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [notes, setNotes] = React.useState("");
  const { busy, err, run } = useSubmit(
    () => recordManufacturerPayment({ po_id: id, type, amount, method, reference: reference || undefined, payment_date: date, notes: notes || undefined }),
    onClose, onDone,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record manufacturer payment</DialogTitle>
          <DialogDescription>Balance due {formatCurrency(balanceDue, currency)}. A refund/credit reduces the amount paid.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {MFR_PAYMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {PAYMENT_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Wire confirmation, check #…" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <Err msg={err} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const { busy, err, run } = useSubmit(() => voidPo({ po_id: id, reason }), onClose, onDone);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void purchase order</DialogTitle>
          <DialogDescription>A reason is required. Voiding cancels the PO; it cannot be reactivated.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for voiding…" />
        <Err msg={err} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={run} disabled={busy || !reason.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Void PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrackingDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [carrier, setCarrier] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [shipDate, setShipDate] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [received, setReceived] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const { busy, err, run } = useSubmit(
    () => addPoShipment({ po_id: id, carrier: carrier || undefined, tracking_number: tracking || undefined, ship_date: shipDate || undefined, expected_arrival_date: expected || undefined, received_date: received || undefined, notes: notes || undefined }),
    onClose, onDone,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add tracking</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Carrier</Label><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="DHL, FedEx…" /></div>
          <div className="space-y-1.5"><Label>Tracking #</Label><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Ship date</Label><Input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Expected arrival</Label><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Received date</Label><Input type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <Err msg={err} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save tracking</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ id, items, onClose, onDone }: { id: string; items: PoActionItem[]; onClose: () => void; onDone: () => void }) {
  const [itemId, setItemId] = React.useState(items[0]?.id ?? "");
  const sel = items.find((i) => i.id === itemId);
  const remaining = sel ? Math.max(0, sel.quantity - sel.quantity_received) : 0;
  const [qty, setQty] = React.useState("");
  const [date, setDate] = React.useState(today());
  const [lot, setLot] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const { busy, err, run } = useSubmit(
    () => receivePoLine({ item_id: itemId, quantity: qty, received_date: date, lot_number: lot || undefined, notes: notes || undefined }),
    onClose, onDone,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive goods</DialogTitle>
          <DialogDescription>Record received quantities per line. Lot allocation is optional.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Line</Label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.product_name} (received {i.quantity_received}/{i.quantity})</option>)}
            </select>
            {sel && <p className="text-xs text-muted-foreground">Remaining to receive: {remaining}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Quantity received</Label><Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Received date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Lot number</Label><Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Optional" /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <Err msg={err} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || !itemId}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscardDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, err, run } = useSubmit(() => deletePoDraft(id), onClose, onDone);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard draft</DialogTitle>
          <DialogDescription>This permanently deletes the draft purchase order.</DialogDescription>
        </DialogHeader>
        <Err msg={err} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
