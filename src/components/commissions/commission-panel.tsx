"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Plus, Pencil, TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CommissionStatusBadge } from "@/components/commissions/commission-badge";
import { CommissionActions } from "@/components/commissions/commission-actions";
import { CommissionFormDialog } from "@/components/commissions/commission-form-dialog";
import { formatRate } from "@/lib/commissions/calculations";
import { COMMISSION_TYPE_OPTIONS, type CommissionType } from "@/lib/commissions/schemas";
import { formatCurrency } from "@/lib/utils";
import type { CommissionRow, RecipientProfile } from "@/lib/commissions/queries";

const TYPE_LABEL = Object.fromEntries(COMMISSION_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Staff-only commission panel for the order detail page. Owner/Admin manage every
// recipient; reps see only their own commission amount + status (no cost-derived
// figures). NEVER rendered on the customer invoice or PDF.
export function CommissionPanel({
  invoiceId,
  invoiceStatus,
  canManage,
  currency,
  subtotal,
  grossProfit,
  totalCommission,
  netProfit,
  commissions,
  recipients,
}: {
  invoiceId: string;
  invoiceStatus: string;
  canManage: boolean;
  currency: string;
  subtotal: number;
  grossProfit: number | null;
  totalCommission: number | null;
  netProfit: number | null;
  commissions: CommissionRow[];
  recipients: RecipientProfile[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<null | { mode: "add" } | { mode: "edit"; row: CommissionRow }>(null);
  const done = () => router.refresh();

  const active = commissions.filter((c) => c.status !== "void");
  const total = active.reduce((s, c) => s + c.amount, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-muted-foreground" /> Commissions
        </CardTitle>
        {canManage && invoiceStatus !== "void" && (
          <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "add" })}>
            <Plus className="h-4 w-4" /> Add recipient
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {commissions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {canManage ? "No commission recipients yet. Add reps or external partners above." : "No commissions on this order."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Recipient</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  {canManage && <th className="py-2 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => {
                  const editable = canManage && (c.status === "pending" || c.status === "earned");
                  return (
                    <tr key={c.id} className="border-b border-border align-top last:border-0">
                      <td className="py-2.5 pr-3">
                        <div>{c.recipient_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.recipient_type === "external_partner" ? c.recipient_company || "External partner" : "Internal"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{TYPE_LABEL[c.commission_type] ?? c.commission_type}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatRate(c.commission_type as CommissionType, c.rate, currency)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(c.amount, currency)}</td>
                      <td className="py-2.5 pr-3">
                        <CommissionStatusBadge status={c.status} />
                      </td>
                      {canManage && (
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {editable && (
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: "edit", row: c })} title="Edit">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <CommissionActions id={c.id} status={c.status} amount={c.amount} currency={currency} onDone={done} />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals + net-profit explanation (admin only) */}
        {canManage && (
          <div className="mt-4 space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total commission expense</span>
              <span className="tabular-nums font-medium">{formatCurrency(totalCommission ?? total, currency)}</span>
            </div>
            {grossProfit != null && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Gross profit</span>
                <span className="tabular-nums">{formatCurrency(grossProfit, currency)}</span>
              </div>
            )}
            <div className="my-1 border-t border-border" />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <TrendingUp className="h-3.5 w-3.5" /> Net profit after commissions
              </span>
              <span className="tabular-nums font-semibold">{formatCurrency(netProfit ?? 0, currency)}</span>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              Net profit = gross profit − total commissions − internal order expenses. Commissions earn automatically when the
              invoice is paid in full, then follow approve → paid.
            </p>
          </div>
        )}
      </CardContent>

      {dialog && (
        <CommissionFormDialog
          invoiceId={invoiceId}
          subtotal={subtotal}
          grossProfit={grossProfit}
          currency={currency}
          recipients={recipients}
          existing={dialog.mode === "edit" ? dialog.row : null}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </Card>
  );
}
