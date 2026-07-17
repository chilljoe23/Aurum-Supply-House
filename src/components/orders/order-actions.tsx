"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Send, CreditCard, Ban, FileText, Trash2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/orders/schemas";
import { issueInvoice, recordPayment, voidInvoice, deleteDraft, deleteOrderPermanently } from "@/app/(app)/orders/actions";
import { deletionConfirmed, DELETE_CONFIRM_WORD } from "@/lib/orders/deletion";
import { formatCurrency } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

export function OrderActions({
  id,
  status,
  canManage,
  canDeletePermanently = false,
  balanceDue,
  currency,
}: {
  id: string;
  status: string;
  canManage: boolean;
  // Owner-only + server-verified eligibility. Never shown to Admin or Sales Rep.
  canDeletePermanently?: boolean;
  balanceDue: number;
  currency: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<null | "issue" | "payment" | "void" | "discard" | "delete">(null);
  const isDraft = status === "draft";
  const isOpenInvoice = status === "sent" || status === "partial";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" asChild>
        <Link href={`/orders/${id}/invoice`}>
          <FileText className="h-4 w-4" /> {isDraft ? "Preview invoice" : "Download PDF"}
        </Link>
      </Button>

      {isDraft && (
        <Button variant="outline" asChild>
          <Link href={`/orders/${id}/edit`}>
            <Pencil className="h-4 w-4" /> Edit draft
          </Link>
        </Button>
      )}

      {isDraft && canManage && (
        <Button onClick={() => setDialog("issue")}>
          <Send className="h-4 w-4" /> Issue invoice
        </Button>
      )}

      {isOpenInvoice && canManage && (
        <Button onClick={() => setDialog("payment")}>
          <CreditCard className="h-4 w-4" /> Record payment
        </Button>
      )}

      {!isDraft && status !== "void" && canManage && (
        <Button variant="outline" onClick={() => setDialog("void")}>
          <Ban className="h-4 w-4" /> Void
        </Button>
      )}

      {isDraft && (
        <Button variant="ghost" onClick={() => setDialog("discard")} title="Discard draft">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      {/* Owner-only permanent deletion for eligible Draft/Void orders. Server
          re-verifies every rule; this button is a convenience gate only. */}
      {canDeletePermanently && (
        <Button variant="destructive" onClick={() => setDialog("delete")} title="Delete order permanently">
          <ShieldAlert className="h-4 w-4" /> Delete permanently
        </Button>
      )}

      {dialog === "issue" && <IssueDialog id={id} onClose={() => setDialog(null)} onDone={() => router.refresh()} />}
      {dialog === "payment" && (
        <PaymentDialog id={id} balanceDue={balanceDue} currency={currency} onClose={() => setDialog(null)} onDone={() => router.refresh()} />
      )}
      {dialog === "void" && <VoidDialog id={id} onClose={() => setDialog(null)} onDone={() => router.refresh()} />}
      {dialog === "discard" && (
        <DiscardDialog
          id={id}
          onClose={() => setDialog(null)}
          onDone={() => {
            router.push("/orders");
            router.refresh();
          }}
        />
      )}
      {dialog === "delete" && (
        <DeletePermanentlyDialog
          id={id}
          onClose={() => setDialog(null)}
          onDone={() => {
            router.push("/orders?deleted=1");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return { busy, setBusy, error, setError };
}

function IssueDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmit();
  const [issueDate, setIssueDate] = React.useState(today());
  const [dueDate, setDueDate] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await issueInvoice({ invoice_id: id, issue_date: issueDate, due_date: dueDate || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue invoice</DialogTitle>
          <DialogDescription>Allocates the invoice number and locks the order. Financial fields become immutable.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Issue date</Label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Blank = derived from the client&apos;s terms.</p>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ id, balanceDue, currency, onClose, onDone }: { id: string; balanceDue: number; currency: string; onClose: () => void; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmit();
  const [amount, setAmount] = React.useState(balanceDue > 0 ? String(balanceDue) : "");
  const [method, setMethod] = React.useState("wire");
  const [reference, setReference] = React.useState("");
  const [receivedAt, setReceivedAt] = React.useState(today());
  const [note, setNote] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await recordPayment({ invoice_id: id, amount, method, reference: reference || undefined, received_at: receivedAt, note: note || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Balance due {formatCurrency(balanceDue, currency)}. Payments cannot exceed the balance.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #, wire ref…" />
          </div>
          <div className="space-y-1.5">
            <Label>Received</Label>
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Note</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmit();
  const [reason, setReason] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await voidInvoice({ invoice_id: id, reason });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void invoice</DialogTitle>
          <DialogDescription>Voiding is permanent and keeps the record for audit. The number is never reused. A reason is required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this invoice being voided?" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Owner-only destructive confirmation. Requires BOTH typing the exact word DELETE
// and a non-empty reason; the confirm button stays disabled until both are met.
// On DB refusal the exact safe business message is shown (no internals leaked).
function DeletePermanentlyDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmit();
  const [confirm, setConfirm] = React.useState("");
  const [reason, setReason] = React.useState("");
  const ready = deletionConfirmed(confirm, reason);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const res = await deleteOrderPermanently({ invoice_id: id, reason });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete order permanently?</DialogTitle>
          <DialogDescription>
            This permanently removes this Draft or Void order and cannot be undone. Any issued invoice number will remain
            retired and will never be reused. Orders with payments, paid commissions, fulfillment activity, or protected
            financial history cannot be deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Why is this order being deleted?</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for permanent deletion…" />
          </div>
          <div className="space-y-1.5">
            <Label>Type <span className="font-mono font-semibold">{DELETE_CONFIRM_WORD}</span> to confirm</Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={DELETE_CONFIRM_WORD} autoComplete="off" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !ready}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscardDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmit();
  async function submit() {
    setBusy(true);
    setError(null);
    const res = await deleteDraft(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard draft?</DialogTitle>
          <DialogDescription>This permanently removes the draft order. Issued invoices cannot be deleted — only voided.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
