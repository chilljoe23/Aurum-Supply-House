"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge";
import { formatCurrency } from "@/lib/utils";
import type { QuoteListRow } from "@/lib/quotes/queries";

const STATUS_OPTIONS: [string, string][] = [
  ["all", "All statuses"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["expired", "Expired"],
  ["converted", "Converted"],
  ["void", "Void"],
];

function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString() : "—";
}

export function QuotesManager({ quotes }: { quotes: QuoteListRow[] }) {
  const [status, setStatus] = React.useState("all");
  const [client, setClient] = React.useState("all");
  const [rep, setRep] = React.useState("all");
  const [model, setModel] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [expiry, setExpiry] = React.useState("all");

  const clientOptions = React.useMemo(() => uniquePairs(quotes, (q) => [q.client_id, q.company_name]), [quotes]);
  const repOptions = React.useMemo(() => uniquePairs(quotes, (q) => [q.sales_rep_id, q.sales_rep_name]), [quotes]);
  const modelOptions = React.useMemo(() => uniquePairs(quotes, (q) => [q.pricing_sheet_id, q.pricing_sheet_name]), [quotes]);

  const rows = React.useMemo(
    () =>
      quotes.filter((q) => {
        // "expired" filter includes sent quotes past their date (is_expired).
        if (status !== "all") {
          if (status === "expired") {
            if (!(q.status === "expired" || (q.status === "sent" && q.is_expired))) return false;
          } else if (q.status !== status) return false;
        }
        if (client !== "all" && q.client_id !== client) return false;
        if (rep !== "all" && q.sales_rep_id !== rep) return false;
        if (model !== "all" && q.pricing_sheet_id !== model) return false;
        if (expiry === "expiring" && !q.expiration_date) return false;
        if (expiry === "active" && (q.is_expired || q.status !== "sent")) return false;
        const d = (q.quote_date ?? q.created_at).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [quotes, status, client, rep, model, expiry, from, to],
  );

  const columns = React.useMemo<ColumnDef<QuoteListRow>[]>(
    () => [
      {
        accessorKey: "quote_number",
        header: "Number",
        cell: ({ row }) => (
          <Link href={`/quotes/${row.original.id}`} className="font-mono text-xs font-medium hover:underline">
            {row.original.quote_number}
          </Link>
        ),
      },
      {
        accessorKey: "company_name",
        header: "Client",
        cell: ({ row }) => row.original.company_name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "sales_rep_name",
        header: "Representative",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.sales_rep_name ?? "—"}</span>,
      },
      {
        id: "quote_date",
        accessorFn: (r) => r.quote_date ?? r.created_at,
        header: "Quote date",
        cell: ({ row }) => <span className="text-muted-foreground">{fmtDate(row.original.quote_date)}</span>,
      },
      {
        id: "expiration_date",
        accessorFn: (r) => r.expiration_date ?? "",
        header: "Expires",
        cell: ({ row }) => (
          <span className={row.original.is_expired ? "text-warning-foreground" : "text-muted-foreground"}>
            {fmtDate(row.original.expiration_date)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <QuoteStatusBadge status={row.original.status} isExpired={row.original.is_expired} />,
      },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.total, row.original.currency)}</span>,
      },
      {
        id: "updated",
        accessorFn: (r) => r.updated_at,
        header: "Updated",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{new Date(row.original.updated_at).toLocaleDateString()}</span>,
      },
    ],
    [],
  );

  function exportCsv() {
    const header = ["Quote number", "Client", "Representative", "Pricing model", "Quote date", "Expiration date", "Status", "Total", "Currency", "Linked order", "Last updated"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((q) =>
      [
        q.quote_number,
        q.company_name ?? "",
        q.sales_rep_name ?? "",
        q.pricing_sheet_name ?? "",
        q.quote_date ?? "",
        q.expiration_date ?? "",
        q.is_expired && q.status === "sent" ? "expired" : q.status,
        q.total.toFixed(2),
        q.currency,
        q.converted_order_number ?? "",
        q.updated_at,
      ]
        .map(escape)
        .join(","),
    );
    const csv = [header.map(escape).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quotes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No quotes yet"
        description="Create your first quote — pick a client, add products, and prices resolve automatically from your pricing models. Send it, and it converts to an order on acceptance."
        action={
          <Button size="sm" asChild>
            <Link href="/quotes/new">
              <Plus className="h-4 w-4" /> New quote
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect label="Client" value={client} onChange={setClient} options={[["all", "All clients"], ...clientOptions]} />
        <FilterSelect label="Representative" value={rep} onChange={setRep} options={[["all", "All reps"], ...repOptions]} />
        <FilterSelect label="Pricing model" value={model} onChange={setModel} options={[["all", "All models"], ...modelOptions]} />
        <FilterSelect
          label="Expiration"
          value={expiry}
          onChange={setExpiry}
          options={[["all", "Any expiration"], ["active", "Active (not expired)"], ["expiring", "Has expiration date"]]}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <DataTable columns={columns} data={rows} searchPlaceholder="Search number, client…" emptyMessage="No quotes match these filters." />
    </div>
  );
}

function uniquePairs(quotes: QuoteListRow[], get: (q: QuoteListRow) => [string | null, string | null]): [string, string][] {
  const seen = new Map<string, string>();
  for (const q of quotes) {
    const [id, label] = get(q);
    if (id) seen.set(id, label ?? "—");
  }
  return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
