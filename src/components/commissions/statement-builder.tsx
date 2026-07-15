"use client";

import * as React from "react";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PrintButton } from "@/components/orders/print-button";
import { CommissionStatement, type StatementModel } from "@/components/commissions/commission-statement";
import { formatRate } from "@/lib/commissions/calculations";
import { COMMISSION_TYPE_OPTIONS, COMMISSION_STATUS_LABELS, type CommissionType } from "@/lib/commissions/schemas";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import type { CommissionRow } from "@/lib/commissions/queries";

const TYPE_LABEL = Object.fromEntries(COMMISSION_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const fmtDate = (s: string | null) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null);

export type StatementCompany = { name: string; lines: string[]; email: string | null; phone: string | null };

const recipientKey = (c: CommissionRow) => c.recipient_id ?? `ext:${c.recipient_name}`;

export function StatementBuilder({ commissions, company }: { commissions: CommissionRow[]; company: StatementCompany }) {
  const recipients = React.useMemo(() => {
    const m = new Map<string, { key: string; name: string; type: string; company: string | null; email: string | null }>();
    for (const c of commissions) {
      const k = recipientKey(c);
      if (!m.has(k)) m.set(k, { key: k, name: c.recipient_name, type: c.recipient_type, company: c.recipient_company, email: c.recipient_email });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [commissions]);

  const [recipient, setRecipient] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("active");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [model, setModel] = React.useState<StatementModel | null>(null);

  function build() {
    const rec = recipients.find((r) => r.key === recipient);
    if (!rec) return;
    const rows = commissions
      .filter((c) => recipientKey(c) === recipient)
      .filter((c) => {
        if (statusFilter === "active") return c.status !== "void" && c.status !== "pending";
        if (statusFilter === "all") return true;
        return c.status === statusFilter;
      })
      .filter((c) => {
        const d = (c.invoice_issue_date ?? c.created_at).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => (a.invoice_number < b.invoice_number ? -1 : 1));

    const statementRows = rows.map((c) => ({
      invoiceNumber: c.invoice_number,
      client: c.company_name ?? "—",
      invoicePaidDate: fmtDate(c.invoice_paid_at),
      calcType: TYPE_LABEL[c.commission_type] ?? c.commission_type,
      rate: formatRate(c.commission_type as CommissionType, c.rate),
      amount: c.amount,
      status: COMMISSION_STATUS_LABELS[c.status] ?? c.status,
      commissionPaidDate: fmtDate(c.paid_at),
      paymentMethod: c.paid_method,
      paymentReference: c.paid_reference,
    }));

    const total = rows.reduce((s, c) => s + c.amount, 0);
    const paidTotal = rows.filter((c) => c.status === "paid").reduce((s, c) => s + c.amount, 0);
    const periodLabel = from || to ? `${fmtDate(from) ?? "Beginning"} – ${fmtDate(to) ?? "Present"}` : "All dates";

    setModel({
      company,
      recipient: { name: rec.name, type: rec.type, company: rec.company, email: rec.email },
      periodLabel,
      generatedOn: new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      currency: "USD",
      rows: statementRows,
      total,
      paidTotal,
    });
  }

  function exportCsv() {
    if (!model) return;
    const cols = [
      { key: "invoiceNumber", label: "Invoice" },
      { key: "client", label: "Client" },
      { key: "invoicePaidDate", label: "Invoice paid" },
      { key: "calcType", label: "Type" },
      { key: "rate", label: "Rate" },
      { key: "amount", label: "Amount" },
      { key: "status", label: "Status" },
      { key: "commissionPaidDate", label: "Commission paid" },
      { key: "paymentMethod", label: "Method" },
      { key: "paymentReference", label: "Reference" },
    ];
    downloadCsv(`statement-${model.recipient.name.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(cols, model.rows as unknown as Record<string, unknown>[]));
  }

  return (
    <div className="space-y-5">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: letter; margin: 0.5in; }
              body { visibility: hidden !important; background: #fff !important; }
              [data-print-root], [data-print-root] * { visibility: visible !important; }
              [data-print-root] { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; }
            }
          `,
        }}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4 print:hidden">
        <div className="space-y-1.5">
          <Label>Recipient</Label>
          <select value={recipient} onChange={(e) => setRecipient(e.target.value)} className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Select a recipient…</option>
            {recipients.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} {r.type === "external_partner" ? "· external" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="active">Earned, approved & paid</option>
            <option value="earned">Earned</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="all">All (incl. pending/void)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </div>
        <Button onClick={build} disabled={!recipient}>
          <FileText className="h-4 w-4" /> Generate statement
        </Button>
        {model && (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <PrintButton label="Print / PDF" />
          </div>
        )}
      </div>

      {model ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
          <div className="shadow-sm">
            <CommissionStatement model={model} />
          </div>
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground print:hidden">
          Choose a recipient and generate a printable commission statement.
        </p>
      )}
    </div>
  );
}
