"use client";

import * as React from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { formatCurrency } from "@/lib/utils";
import type { OrderListRow } from "@/lib/orders/queries";

const STATUS_OPTIONS: [string, string][] = [
  ["all", "All statuses"],
  ["draft", "Draft"],
  ["sent", "Issued"],
  ["partial", "Partial"],
  ["paid", "Paid"],
  ["void", "Void"],
];

export function OrdersManager({ orders, canSeeInternal }: { orders: OrderListRow[]; canSeeInternal: boolean }) {
  const [status, setStatus] = React.useState("all");
  const [client, setClient] = React.useState("all");
  const [rep, setRep] = React.useState("all");
  const [model, setModel] = React.useState("all");
  const [paid, setPaid] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const clientOptions = React.useMemo(() => uniquePairs(orders, (o) => [o.client_id, o.company_name]), [orders]);
  const repOptions = React.useMemo(() => uniquePairs(orders, (o) => [o.sales_rep_id, o.sales_rep_name]), [orders]);
  const modelOptions = React.useMemo(() => uniquePairs(orders, (o) => [o.pricing_sheet_id, o.pricing_sheet_name]), [orders]);

  const rows = React.useMemo(
    () =>
      orders.filter((o) => {
        if (status !== "all" && o.status !== status) return false;
        if (client !== "all" && o.client_id !== client) return false;
        if (rep !== "all" && o.sales_rep_id !== rep) return false;
        if (model !== "all" && o.pricing_sheet_id !== model) return false;
        if (paid === "paid" && o.balance_due > 0.0001) return false;
        if (paid === "unpaid" && o.balance_due <= 0.0001) return false;
        const d = (o.issue_date ?? o.created_at).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [orders, status, client, rep, model, paid, from, to],
  );

  const columns = React.useMemo<ColumnDef<OrderListRow>[]>(() => {
    const base: ColumnDef<OrderListRow>[] = [
      {
        accessorKey: "invoice_number",
        header: "Number",
        cell: ({ row }) => (
          <Link href={`/orders/${row.original.id}`} className="font-mono text-xs font-medium hover:underline">
            {row.original.invoice_number}
          </Link>
        ),
      },
      {
        accessorKey: "company_name",
        header: "Client",
        cell: ({ row }) => row.original.company_name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "date",
        accessorFn: (r) => r.issue_date ?? r.created_at,
        header: "Date",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {new Date(row.original.issue_date ?? row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: "sales_rep_name",
        header: "Representative",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.sales_rep_name ?? "—"}</span>,
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <OrderStatusBadge status={row.original.status} /> },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.total, row.original.currency)}</span>,
      },
      {
        accessorKey: "amount_paid",
        header: "Paid",
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatCurrency(row.original.amount_paid, row.original.currency)}</span>,
      },
      {
        accessorKey: "balance_due",
        header: "Balance",
        cell: ({ row }) => (
          <span className={`tabular-nums ${row.original.balance_due > 0.0001 && row.original.status !== "void" ? "text-foreground" : "text-muted-foreground"}`}>
            {formatCurrency(row.original.balance_due, row.original.currency)}
          </span>
        ),
      },
    ];
    if (canSeeInternal) {
      base.push(
        {
          id: "gross_profit",
          accessorFn: (r) => r.gross_profit ?? 0,
          header: "Gross profit",
          cell: ({ row }) =>
            row.original.gross_profit == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="tabular-nums">{formatCurrency(row.original.gross_profit, row.original.currency)}</span>
            ),
        },
        {
          id: "gross_margin",
          accessorFn: (r) => r.gross_margin ?? 0,
          header: "Margin",
          cell: ({ row }) =>
            row.original.gross_margin == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="tabular-nums text-muted-foreground">{(row.original.gross_margin * 100).toFixed(1)}%</span>
            ),
        },
      );
    }
    base.push({
      id: "updated",
      accessorFn: (r) => r.updated_at,
      header: "Updated",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{new Date(row.original.updated_at).toLocaleDateString()}</span>,
    });
    return base;
  }, [canSeeInternal]);

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No orders yet"
        description="Create your first order — pick a client, add products, and prices resolve automatically from your pricing models."
        action={
          <Button size="sm" asChild>
            <Link href="/orders/new">
              <Plus className="h-4 w-4" /> New order
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
          label="Payment"
          value={paid}
          onChange={setPaid}
          options={[["all", "Paid & unpaid"], ["unpaid", "Has balance"], ["paid", "Fully paid"]]}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </label>
      </div>

      <DataTable columns={columns} data={rows} searchPlaceholder="Search number, client…" emptyMessage="No orders match these filters." />
    </div>
  );
}

function uniquePairs(orders: OrderListRow[], get: (o: OrderListRow) => [string | null, string | null]): [string, string][] {
  const seen = new Map<string, string>();
  for (const o of orders) {
    const [id, label] = get(o);
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
