"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPENSE_TYPE_OPTIONS } from "@/lib/orders/schemas";
import { addExpense, deleteExpense } from "@/app/(app)/orders/actions";
import { formatCurrency } from "@/lib/utils";
import type { OrderExpense } from "@/lib/orders/queries";

const TYPE_LABELS = Object.fromEntries(EXPENSE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export function ExpenseManager({ invoiceId, expenses, currency }: { invoiceId: string; expenses: OrderExpense[]; currency: string }) {
  const router = useRouter();
  const [type, setType] = React.useState("outbound_shipping");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addExpense({ invoice_id: invoiceId, type, amount, note: note || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setAmount("");
    setNote("");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    await deleteExpense(id, invoiceId);
    setBusy(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal expenses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Company costs that reduce net profit. Never shown on the customer invoice.</p>
        {expenses.length > 0 && (
          <div className="space-y-0">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                <div>
                  <span>{TYPE_LABELS[e.type] ?? e.type}</span>
                  {e.note && <span className="ml-2 text-xs text-muted-foreground">{e.note}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(e.amount, currency)}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(e.id)} disabled={busy} title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
          <div className="sm:col-span-6">
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {EXPENSE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
          </div>
          <div className="sm:col-span-3">
            <Button className="w-full" variant="outline" onClick={add} disabled={busy || !amount}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </Button>
          </div>
          <div className="sm:col-span-12">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
