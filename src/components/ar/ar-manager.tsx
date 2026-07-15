"use client";

import * as React from "react";
import Link from "next/link";
import { Wallet, AlertTriangle, Download, ArrowUpDown, FileClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import { formatCurrency } from "@/lib/utils";
import { AGING_BUCKETS, type ArAgingRow, type ArSummary } from "@/lib/ar/types";

const PAGE_SIZE = 25;
const BUCKET_LABEL = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, b.label]));
const fmtDate = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString() : "—");

type SortKey = "due" | "days" | "balance" | "client" | "invoice";

export function ArManager({ rows, summary }: { rows: ArAgingRow[]; summary: ArSummary }) {
  const [q, setQ] = React.useState("");
  const [bucket, setBucket] = React.useState("all");
  const [client, setClient] = React.useState("all");
  const [rep, setRep] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "days", dir: "desc" });
  const [page, setPage] = React.useState(0);

  const clientOptions = React.useMemo(() => uniquePairs(rows, (r) => [r.client_id, r.company_name]), [rows]);
  const repOptions = React.useMemo(() => uniquePairs(rows, (r) => [r.sales_rep_id, r.sales_rep_name]), [rows]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (bucket !== "all" && r.aging_bucket !== bucket) return false;
      if (client !== "all" && r.client_id !== client) return false;
      if (rep !== "all" && r.sales_rep_id !== rep) return false;
      const d = (r.due_date ?? r.issue_date ?? "").slice(0, 10);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      if (needle) {
        const hay = `${r.invoice_number} ${r.company_name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      switch (sort.key) {
        case "balance":
          return (a.balance_due - b.balance_due) * dir;
        case "days":
          return (a.days_overdue - b.days_overdue) * dir;
        case "client":
          return (a.company_name ?? "").localeCompare(b.company_name ?? "") * dir;
        case "invoice":
          return a.invoice_number.localeCompare(b.invoice_number) * dir;
        default:
          return ((a.due_date ?? "") < (b.due_date ?? "") ? -1 : 1) * dir;
      }
    });
    return out;
  }, [rows, q, bucket, client, rep, from, to, sort]);

  React.useEffect(() => setPage(0), [q, bucket, client, rep, from, to]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function exportCsv() {
    const cols = [
      { key: "invoice_number", label: "Invoice" },
      { key: "company_name", label: "Client" },
      { key: "sales_rep_name", label: "Representative" },
      { key: "issue_date", label: "Issued" },
      { key: "due_date", label: "Due" },
      { key: "total", label: "Total" },
      { key: "amount_paid", label: "Paid" },
      { key: "balance_due", label: "Balance" },
      { key: "days_overdue", label: "Days overdue" },
      { key: "aging_bucket", label: "Aging" },
      { key: "status", label: "Status" },
    ];
    const data = filtered.map((r) => ({
      ...r,
      issue_date: fmtDate(r.issue_date),
      due_date: fmtDate(r.due_date),
      aging_bucket: BUCKET_LABEL[r.aging_bucket],
    }));
    downloadCsv(`receivables-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(cols, data));
  }

  function SortHead({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    return (
      <th className={`py-2 pr-3 font-medium ${className ?? ""}`}>
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}>
          {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
        </button>
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total outstanding" value={formatCurrency(summary.total_outstanding)} icon={Wallet} hint={`${summary.invoice_count} open invoice${summary.invoice_count === 1 ? "" : "s"}`} />
        <KpiCard label="Overdue" value={formatCurrency(summary.overdue_amt)} icon={AlertTriangle} hint="Past due date" />
        <KpiCard label="Current" value={formatCurrency(summary.current_amt)} icon={FileClock} hint="Not yet due" />
        <KpiCard label="90+ days" value={formatCurrency(summary.d90_plus)} icon={AlertTriangle} hint="Most overdue" />
      </div>

      {/* Aging strip */}
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-3 text-sm sm:grid-cols-5">
        <AgeCell label="Current" value={summary.current_amt} active={bucket === "current"} onClick={() => setBucket(bucket === "current" ? "all" : "current")} />
        <AgeCell label="1–30" value={summary.d1_30} active={bucket === "d1_30"} onClick={() => setBucket(bucket === "d1_30" ? "all" : "d1_30")} />
        <AgeCell label="31–60" value={summary.d31_60} active={bucket === "d31_60"} onClick={() => setBucket(bucket === "d31_60" ? "all" : "d31_60")} />
        <AgeCell label="61–90" value={summary.d61_90} active={bucket === "d61_90"} onClick={() => setBucket(bucket === "d61_90" ? "all" : "d61_90")} />
        <AgeCell label="90+" value={summary.d90_plus} active={bucket === "d90_plus"} onClick={() => setBucket(bucket === "d90_plus" ? "all" : "d90_plus")} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Nothing outstanding" description="All issued invoices are fully paid. Open receivables appear here as invoices are issued and await payment." />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, client…" className="h-9 w-64" />
            <FilterSelect label="Aging" value={bucket} onChange={setBucket} options={[["all", "All ages"], ...AGING_BUCKETS.map((b) => [b.key, b.label] as [string, string])]} />
            <FilterSelect label="Client" value={client} onChange={setClient} options={[["all", "All clients"], ...clientOptions]} />
            <FilterSelect label="Representative" value={rep} onChange={setRep} options={[["all", "All reps"], ...repOptions]} />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Due from
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              to
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <SortHead label="Invoice" k="invoice" className="pl-4" />
                  <SortHead label="Client" k="client" />
                  <th className="py-2 pr-3 font-medium">Rep</th>
                  <th className="py-2 pr-3 font-medium">Issued</th>
                  <SortHead label="Due" k="due" />
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 pr-3 text-right font-medium">Paid</th>
                  <SortHead label="Balance" k="balance" className="text-right" />
                  <SortHead label="Overdue" k="days" className="text-right" />
                  <th className="py-2 pr-4 font-medium">Aging</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pl-4 pr-3">
                      <Link href={`/orders/${r.id}`} className="font-mono text-xs font-medium hover:underline">{r.invoice_number}</Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.client_id ? (
                        <Link href={`/clients/${r.client_id}`} className="hover:underline">{r.company_name ?? "—"}</Link>
                      ) : (
                        r.company_name ?? "—"
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.sales_rep_name ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(r.issue_date)}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{fmtDate(r.due_date)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(r.total, r.currency)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(r.amount_paid, r.currency)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{formatCurrency(r.balance_due, r.currency)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{r.days_overdue > 0 ? `${r.days_overdue}d` : "—"}</td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={r.aging_bucket === "current" ? "outline" : r.aging_bucket === "d90_plus" ? "destructive" : "warning"}>
                        {BUCKET_LABEL[r.aging_bucket]}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="h-24 text-center text-muted-foreground">No receivables match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgeCell({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-2 text-left transition-colors ${active ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums font-medium">{formatCurrency(value)}</div>
    </button>
  );
}

function uniquePairs(rows: ArAgingRow[], get: (r: ArAgingRow) => [string | null, string | null]): [string, string][] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const [id, label] = get(r);
    if (id) seen.set(id, label ?? "—");
  }
  return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
