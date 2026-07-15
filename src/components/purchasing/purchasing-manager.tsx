"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown, Download, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PoStatusBadge } from "@/components/purchasing/po-status-badge";
import { formatCurrency } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase-orders/status";
import type { PurchaseOrderListRow } from "@/lib/purchase-orders/queries";

const PAGE_SIZE = 25;

type SortKey = "po_number" | "manufacturer_name" | "created_at" | "expected_date" | "status" | "total" | "amount_paid" | "balance_due" | "updated_at";

function paymentStatus(r: PurchaseOrderListRow): "unpaid" | "partial" | "paid" {
  if (r.amount_paid <= 0) return "unpaid";
  if (r.balance_due <= 0.0001) return "paid";
  return "partial";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const s = d.length > 10 ? d : `${d}T00:00:00`;
  return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function PurchasingManager({ orders }: { orders: PurchaseOrderListRow[] }) {
  const [q, setQ] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [payStatus, setPayStatus] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });
  const [page, setPage] = React.useState(0);

  const manufacturers = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) if (o.manufacturer_id && o.manufacturer_name) m.set(o.manufacturer_id, o.manufacturer_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = orders.filter((o) => {
      if (manufacturer && o.manufacturer_id !== manufacturer) return false;
      if (status && o.status !== status) return false;
      if (payStatus && paymentStatus(o) !== payStatus) return false;
      if (from && (o.created_at ?? "") < from) return false;
      if (to && (o.created_at ?? "") > `${to}T23:59:59`) return false;
      if (needle) {
        const hay = [o.po_number, o.manufacturer_name ?? "", o.status, o.tracking_numbers ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [orders, q, manufacturer, status, payStatus, from, to, sort]);

  React.useEffect(() => setPage(0), [q, manufacturer, status, payStatus, from, to]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function exportCsv() {
    const csv = toCsv(
      [
        { key: "po_number", label: "PO number" },
        { key: "manufacturer_name", label: "Manufacturer" },
        { key: "status", label: "Status" },
        { key: "created_at", label: "Created" },
        { key: "expected_date", label: "Expected" },
        { key: "total", label: "Total" },
        { key: "amount_paid", label: "Amount paid" },
        { key: "balance_due", label: "Balance due" },
        { key: "currency", label: "Currency" },
      ],
      filtered.map((r) => ({
        po_number: r.po_number,
        manufacturer_name: r.manufacturer_name ?? "",
        status: PO_STATUS_LABELS[r.status as PoStatus] ?? r.status,
        created_at: r.created_at?.slice(0, 10) ?? "",
        expected_date: r.expected_date ?? "",
        total: r.total.toFixed(2),
        amount_paid: r.amount_paid.toFixed(2),
        balance_due: r.balance_due.toFixed(2),
        currency: r.currency,
      })),
    );
    downloadCsv(`purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO #, manufacturer, tracking…" className="pl-8" />
        </div>
        <FilterSelect value={manufacturer} onChange={setManufacturer} label="All manufacturers">
          {manufacturers.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={status} onChange={setStatus} label="All statuses">
          {Object.entries(PO_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={payStatus} onChange={setPayStatus} label="Any payment">
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </FilterSelect>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" title="Created from" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" title="Created to" />
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortableTh label="PO #" k="po_number" sort={sort} onSort={toggleSort} />
              <SortableTh label="Manufacturer" k="manufacturer_name" sort={sort} onSort={toggleSort} />
              <SortableTh label="Created" k="created_at" sort={sort} onSort={toggleSort} />
              <SortableTh label="Expected" k="expected_date" sort={sort} onSort={toggleSort} />
              <SortableTh label="Status" k="status" sort={sort} onSort={toggleSort} />
              <SortableTh label="Total" k="total" sort={sort} onSort={toggleSort} align="right" />
              <SortableTh label="Paid" k="amount_paid" sort={sort} onSort={toggleSort} align="right" />
              <SortableTh label="Balance" k="balance_due" sort={sort} onSort={toggleSort} align="right" />
              <SortableTh label="Updated" k="updated_at" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                <td className="p-3">
                  <Link href={`/purchasing/${r.id}`} className="font-mono text-sm text-primary hover:underline">
                    {r.po_number}
                  </Link>
                </td>
                <td className="p-3">{r.manufacturer_name ?? "—"}</td>
                <td className="p-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
                <td className="p-3 text-muted-foreground">{fmtDate(r.expected_date)}</td>
                <td className="p-3"><PoStatusBadge status={r.status} /></td>
                <td className="p-3 text-right tabular-nums">{formatCurrency(r.total, r.currency)}</td>
                <td className="p-3 text-right tabular-nums">{formatCurrency(r.amount_paid, r.currency)}</td>
                <td className="p-3 text-right tabular-nums">{formatCurrency(r.balance_due, r.currency)}</td>
                <td className="p-3 text-muted-foreground">{fmtDate(r.updated_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">No purchase orders match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} purchase order{filtered.length === 1 ? "" : "s"}</span>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>Page {page + 1} of {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  value, onChange, label, children,
}: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">{label}</option>
      {children}
    </select>
  );
}

function SortableTh({
  label, k, sort, onSort, align = "left",
}: { label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; align?: "left" | "right" }) {
  return (
    <th className={`p-3 ${align === "right" ? "text-right" : ""}`}>
      <button className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`} onClick={() => onSort(k)}>
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sort.key === k ? "text-foreground" : "opacity-40"}`} />
      </button>
    </th>
  );
}
