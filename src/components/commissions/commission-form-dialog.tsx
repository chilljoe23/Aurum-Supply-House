"use client";

import * as React from "react";
import { Loader2, Plus, Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { computeCommissionAmount } from "@/lib/commissions/calculations";
import { COMMISSION_TYPE_OPTIONS, type CommissionType, type RecipientType } from "@/lib/commissions/schemas";
import { createCommission, updateCommission } from "@/app/(app)/commissions/actions";
import type { CommissionRow, RecipientProfile } from "@/lib/commissions/queries";

const PERCENT_TYPES: CommissionType[] = ["percent_of_sale", "percent_of_gross_profit"];

export function CommissionFormDialog({
  invoiceId,
  subtotal,
  grossProfit,
  currency,
  recipients,
  existing,
  onClose,
  onDone,
}: {
  invoiceId: string;
  subtotal: number;
  grossProfit: number | null;
  currency: string;
  recipients: RecipientProfile[];
  existing: CommissionRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = !!existing;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [recipientType, setRecipientType] = React.useState<RecipientType>(
    (existing?.recipient_type as RecipientType) ?? "internal_user",
  );
  const [recipientId, setRecipientId] = React.useState(existing?.recipient_id ?? "");
  const [name, setName] = React.useState(existing?.recipient_name ?? "");
  const [email, setEmail] = React.useState(existing?.recipient_email ?? "");
  const [company, setCompany] = React.useState(existing?.recipient_company ?? "");
  const [paymentNotes, setPaymentNotes] = React.useState(existing?.payment_notes ?? "");
  const [type, setType] = React.useState<CommissionType>((existing?.commission_type as CommissionType) ?? "percent_of_sale");
  // Percent types show the rate as a percentage (5 = 5%); dollar types as dollars.
  const [rateField, setRateField] = React.useState(() => {
    if (!existing) return "";
    return PERCENT_TYPES.includes(existing.commission_type as CommissionType)
      ? String(Number(existing.rate) * 100)
      : String(existing.rate);
  });
  const [units, setUnits] = React.useState(existing?.units != null ? String(existing.units) : "");
  const [note, setNote] = React.useState(existing?.note ?? "");

  const isPercent = PERCENT_TYPES.includes(type);
  const rate = isPercent ? (Number(rateField) || 0) / 100 : Number(rateField) || 0;
  const preview = computeCommissionAmount(type, rate, Number(units) || 0, subtotal, grossProfit);
  const exceedsGp = grossProfit != null && preview > grossProfit;

  async function submit() {
    setBusy(true);
    setError(null);
    const resolvedName = recipientType === "internal_user" ? recipients.find((r) => r.id === recipientId)?.full_name ?? name : name;
    const payload = {
      recipient_type: recipientType,
      recipient_id: recipientType === "internal_user" ? recipientId : undefined,
      recipient_name: resolvedName,
      recipient_email: recipientType === "external_partner" ? email : undefined,
      recipient_company: recipientType === "external_partner" ? company : undefined,
      payment_notes: recipientType === "external_partner" ? paymentNotes : undefined,
      commission_type: type,
      rate,
      units: type === "per_unit" ? Number(units) || 0 : undefined,
      note,
    };
    const res = isEdit
      ? await updateCommission({ commission_id: existing!.id, ...payload })
      : await createCommission({ invoice_id: invoiceId, ...payload });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
    onDone();
  }

  const canSubmit =
    (recipientType === "internal_user" ? !!recipientId : name.trim().length > 0) &&
    (type === "per_unit" ? Number(units) > 0 : true) &&
    (type === "flat" || type === "per_unit" ? Number(rateField) > 0 : Number(rateField) >= 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit commission" : "Add commission recipient"}</DialogTitle>
          <DialogDescription>
            The amount is computed from this order&apos;s frozen economics and never recalculated later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipient type */}
          <div className="space-y-1.5">
            <Label>Recipient</Label>
            <div className="flex gap-2">
              {(["internal_user", "external_partner"] as RecipientType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRecipientType(t)}
                  className={`h-9 flex-1 rounded-md border px-3 text-sm ${
                    recipientType === t ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground"
                  }`}
                >
                  {t === "internal_user" ? "Internal user" : "External partner"}
                </button>
              ))}
            </div>
          </div>

          {recipientType === "internal_user" ? (
            <div className="space-y-1.5">
              <Label>Internal user</Label>
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Select a user…</option>
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name} · {r.role}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Partner name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Referral partner" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Payment notes</Label>
                <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="How/where to pay this partner" />
              </div>
            </div>
          )}

          {/* Type + rate */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CommissionType)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {COMMISSION_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{isPercent ? "Percent (%)" : type === "per_unit" ? "Rate per unit ($)" : "Amount ($)"}</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={rateField}
                onChange={(e) => setRateField(e.target.value)}
                placeholder={isPercent ? "5" : "0.00"}
              />
            </div>
            {type === "per_unit" && (
              <div className="space-y-1.5">
                <Label>Units</Label>
                <Input type="number" min={0} step="any" value={units} onChange={(e) => setUnits(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* Live preview */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Calculated commission</span>
              <span className="tabular-nums font-semibold">{formatCurrency(preview, currency)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {type === "percent_of_sale" && `${(rate * 100).toFixed(2).replace(/\.00$/, "")}% of subtotal ${formatCurrency(subtotal, currency)}`}
              {type === "percent_of_gross_profit" &&
                (grossProfit == null
                  ? "Percent of gross profit"
                  : `${(rate * 100).toFixed(2).replace(/\.00$/, "")}% of gross profit ${formatCurrency(grossProfit, currency)}`)}
              {type === "flat" && "Fixed amount"}
              {type === "per_unit" && `${formatCurrency(rate, currency)} × ${Number(units) || 0} units`}
            </p>
            {exceedsGp && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning-foreground">
                <TriangleAlert className="h-3.5 w-3.5" /> This commission exceeds the invoice gross profit.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !canSubmit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEdit ? "Save" : "Add commission"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
