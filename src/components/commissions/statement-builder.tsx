"use client";

import * as React from "react";
import { FileText, Download, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CommissionStatement } from "@/components/commissions/commission-statement";
import {
  buildStatementModel,
  statementRecipients,
  type StatementModel,
  type StatementParams,
  type StatementStatusFilter,
} from "@/lib/commissions/statement-model";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import type { CommissionRow } from "@/lib/commissions/queries";

const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function StatementBuilder({ commissions }: { commissions: CommissionRow[] }) {
  const recipients = React.useMemo(() => statementRecipients(commissions), [commissions]);

  const [recipient, setRecipient] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatementStatusFilter>("active");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  // The generated statement, together with the exact params it was built from, so
  // the "Download PDF" link always reproduces the statement currently on screen —
  // even if the filter controls are changed afterwards without re-generating.
  const [built, setBuilt] = React.useState<{ model: StatementModel; params: StatementParams } | null>(null);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  function build() {
    const params: StatementParams = { recipientKey: recipient, statusFilter, from, to, generatedOn: today() };
    const model = buildStatementModel(commissions, params);
    if (!model) return;
    setBuilt({ model, params });
    setDownloadError(null);
  }

  function exportCsv() {
    if (!built) return;
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
    downloadCsv(`statement-${built.model.recipient.name.replace(/\s+/g, "-").toLowerCase()}.csv`, toCsv(cols, built.model.rows as unknown as Record<string, unknown>[]));
  }

  // TRUE PDF download — fetches the server PDF route (same real-PDF pipeline as the
  // Invoice/Quote/PO documents, same RLS-scoped data, same official logo) and saves
  // the bytes. Print-to-PDF stays as a fallback when the renderer is unavailable.
  async function downloadPdf() {
    if (!built) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const q = new URLSearchParams({
        recipient: built.params.recipientKey,
        status: built.params.statusFilter,
        ...(built.params.from ? { from: built.params.from } : {}),
        ...(built.params.to ? { to: built.params.to } : {}),
      });
      const res = await fetch(`/commissions/statements/pdf?${q.toString()}`, { headers: { Accept: "application/pdf" } });
      if (!res.ok) {
        throw new Error(res.status === 503 ? "PDF service unavailable — use Print / Save as PDF." : `Could not generate PDF (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Aurum-Commission-Statement-${built.model.recipient.name.replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Could not generate PDF.");
    } finally {
      setDownloading(false);
    }
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
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatementStatusFilter)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
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
        {built && (
          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" onClick={() => window.print()} title="Print or save via the browser">
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button onClick={downloadPdf} disabled={downloading}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
              </Button>
            </div>
            {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
          </div>
        )}
      </div>

      {built ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
          <div className="shadow-sm">
            <CommissionStatement model={built.model} />
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
