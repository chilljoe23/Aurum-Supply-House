"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Send, Check, X, Clock, Ban, Copy, ArrowRightLeft, FileText, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  sendQuote,
  transitionQuote,
  voidQuote,
  duplicateQuote,
  convertQuote,
  deleteQuoteDraft,
} from "@/app/(app)/quotes/actions";

type DialogKind = null | "send" | "accept" | "decline" | "expire" | "void" | "duplicate" | "convert" | "discard";

export function QuoteActions({
  id,
  status,
  isExpired,
  canManage,
  convertedOrderId,
}: {
  id: string;
  status: string;
  isExpired: boolean;
  canManage: boolean;
  convertedOrderId: string | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const isDraft = status === "draft";
  const isSent = status === "sent";
  const isAccepted = status === "accepted";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" asChild>
        <Link href={`/quotes/${id}/document`}>
          <FileText className="h-4 w-4" /> {isDraft ? "Preview quote" : "Download PDF"}
        </Link>
      </Button>

      {isDraft && (
        <Button variant="outline" asChild>
          <Link href={`/quotes/${id}/edit`}>
            <Pencil className="h-4 w-4" /> Edit draft
          </Link>
        </Button>
      )}

      {isDraft && canManage && (
        <Button onClick={() => setDialog("send")}>
          <Send className="h-4 w-4" /> Send quote
        </Button>
      )}

      {isSent && canManage && (
        <>
          <Button onClick={() => setDialog("accept")}>
            <Check className="h-4 w-4" /> Accept
          </Button>
          <Button variant="outline" onClick={() => setDialog("decline")}>
            <X className="h-4 w-4" /> Decline
          </Button>
          {isExpired && (
            <Button variant="outline" onClick={() => setDialog("expire")}>
              <Clock className="h-4 w-4" /> Mark expired
            </Button>
          )}
        </>
      )}

      {isAccepted && (
        convertedOrderId ? (
          <Button asChild>
            <Link href={`/orders/${convertedOrderId}`}>
              <ArrowRightLeft className="h-4 w-4" /> View order
            </Link>
          </Button>
        ) : (
          <Button onClick={() => setDialog("convert")}>
            <ArrowRightLeft className="h-4 w-4" /> Convert to order
          </Button>
        )
      )}

      {/* Duplicate is available for any staff-visible quote. */}
      <Button variant="outline" onClick={() => setDialog("duplicate")}>
        <Copy className="h-4 w-4" /> Duplicate
      </Button>

      {(isDraft || isSent) && canManage && (
        <Button variant="outline" onClick={() => setDialog("void")}>
          <Ban className="h-4 w-4" /> Void
        </Button>
      )}

      {isDraft && (
        <Button variant="ghost" onClick={() => setDialog("discard")} title="Discard draft">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      {dialog === "send" && (
        <ConfirmDialog
          title="Send quote"
          description="Allocates the quote number and freezes the customer-facing financial fields. The quote can then be accepted, declined, or expire."
          confirmLabel="Send"
          icon={<Send className="h-4 w-4" />}
          run={() => sendQuote({ quote_id: id })}
          onClose={() => setDialog(null)}
          onDone={() => router.refresh()}
        />
      )}
      {dialog === "accept" && (
        <NoteDialog
          title="Accept quote"
          description="Mark this quote accepted by the customer. You can then convert it to a draft order."
          confirmLabel="Accept"
          icon={<Check className="h-4 w-4" />}
          run={(note) => transitionQuote({ quote_id: id, to: "accepted", note })}
          onClose={() => setDialog(null)}
          onDone={() => router.refresh()}
        />
      )}
      {dialog === "decline" && (
        <NoteDialog
          title="Decline quote"
          description="Record that the customer declined this quote. This is terminal."
          confirmLabel="Decline"
          destructive
          icon={<X className="h-4 w-4" />}
          run={(note) => transitionQuote({ quote_id: id, to: "declined", note })}
          onClose={() => setDialog(null)}
          onDone={() => router.refresh()}
        />
      )}
      {dialog === "expire" && (
        <ConfirmDialog
          title="Mark quote expired"
          description="This quote is past its expiration date. Marking it expired records it as no longer valid."
          confirmLabel="Mark expired"
          icon={<Clock className="h-4 w-4" />}
          run={() => transitionQuote({ quote_id: id, to: "expired" })}
          onClose={() => setDialog(null)}
          onDone={() => router.refresh()}
        />
      )}
      {dialog === "void" && (
        <NoteDialog
          title="Void quote"
          description="Voiding is permanent and keeps the record for audit. The number is never reused. A reason is required."
          confirmLabel="Void quote"
          destructive
          requireNote
          placeholder="Why is this quote being voided?"
          icon={<Ban className="h-4 w-4" />}
          run={(note) => voidQuote({ quote_id: id, reason: note ?? "" })}
          onClose={() => setDialog(null)}
          onDone={() => router.refresh()}
        />
      )}
      {dialog === "duplicate" && (
        <DuplicateDialog
          id={id}
          onClose={() => setDialog(null)}
          onDone={(newId) => {
            router.push(`/quotes/${newId}/edit`);
            router.refresh();
          }}
        />
      )}
      {dialog === "convert" && (
        <ConfirmDialog
          title="Convert to order"
          description="Creates a draft order from this accepted quote, preserving the quoted selling prices and snapshotting the current cost. This does not issue an invoice. A quote can create only one order."
          confirmLabel="Convert"
          icon={<ArrowRightLeft className="h-4 w-4" />}
          run={() => convertQuote({ quote_id: id })}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            const orderId = res && res.ok ? (res.data as { order_id?: string } | undefined)?.order_id : undefined;
            if (orderId) router.push(`/orders/${orderId}`);
            router.refresh();
          }}
        />
      )}
      {dialog === "discard" && (
        <ConfirmDialog
          title="Discard draft?"
          description="This permanently removes the draft quote. Sent quotes cannot be deleted — only voided."
          confirmLabel="Discard"
          destructive
          icon={<Trash2 className="h-4 w-4" />}
          run={() => deleteQuoteDraft(id)}
          onClose={() => setDialog(null)}
          onDone={() => {
            router.push("/quotes");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

type RunResult = { ok: true; data?: unknown } | { ok: false; error: string };

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  icon,
  destructive,
  run,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  icon: React.ReactNode;
  destructive?: boolean;
  run: () => Promise<RunResult>;
  onClose: () => void;
  onDone: (res?: RunResult) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    const res = await run();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone(res);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({
  title,
  description,
  confirmLabel,
  icon,
  destructive,
  requireNote,
  placeholder,
  run,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  icon: React.ReactNode;
  destructive?: boolean;
  requireNote?: boolean;
  placeholder?: string;
  run: (note?: string) => Promise<RunResult>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    const res = await run(note.trim() || undefined);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{requireNote ? "Reason" : "Note (optional)"}</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder ?? "Add an optional note…"} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={submit} disabled={busy || (requireNote && !note.trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (newId: string) => void }) {
  const [retain, setRetain] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    const res = await duplicateQuote({ quote_id: id, retain_prices: retain });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone(res.data!.id);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate quote</DialogTitle>
          <DialogDescription>
            Creates a new draft. Prices are re-resolved from current pricing by default. The new draft opens in the builder, where any change from the original resolved price is shown.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} className="mt-0.5" />
          <span>
            Retain the quoted selling prices instead of re-resolving.
            <span className="block text-xs text-muted-foreground">Keeps each line at its original quoted price even if current pricing differs.</span>
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
