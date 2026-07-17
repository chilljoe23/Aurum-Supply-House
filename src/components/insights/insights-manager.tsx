"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, BarChart3 } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import {
  aggregateOverTime,
  conversionRate,
  groupAggregate,
  inDateRange,
  maskedSum,
  sumMoney,
  toMoney,
  type Granularity,
} from "@/lib/insights/calculations";
import type {
  CommissionReportRow,
  InsightsData,
  LineReportRow,
  OrderReportRow,
  QuoteReportRow,
  ReceivableReportRow,
} from "@/lib/insights/types";

// ---- report registry --------------------------------------------------------

type ReportKey =
  | "overview"
  | "revenue-time"
  | "sales-by-client"
  | "sales-by-product"
  | "sales-by-rep"
  | "receivables"
  | "commissions"
  | "quotes"
  | "purchase-spend"
  | "open-pos"
  | "top-clients"
  | "top-products"
  | "activity";

type ReportDef = { key: ReportKey; label: string; adminOnly?: boolean };

const REPORTS: ReportDef[] = [
  { key: "overview", label: "Overview" },
  { key: "revenue-time", label: "Revenue over time" },
  { key: "sales-by-client", label: "By client" },
  { key: "sales-by-product", label: "By product" },
  { key: "sales-by-rep", label: "By representative" },
  { key: "top-clients", label: "Top clients" },
  { key: "top-products", label: "Top products" },
  { key: "receivables", label: "Receivables" },
  { key: "commissions", label: "Commissions" },
  { key: "quotes", label: "Quotes" },
  { key: "purchase-spend", label: "Purchase spend", adminOnly: true },
  { key: "open-pos", label: "Open POs", adminOnly: true },
  { key: "activity", label: "Recent activity" },
];

// ---- small building blocks --------------------------------------------------

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
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      />
    </label>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// Stateless column builders (no component scope needed).
const numCol = (key: string, header: string): ColumnDef<Record<string, unknown>> => ({
  accessorKey: key,
  header,
  cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0).toLocaleString()}</span>,
});
const textCol = (key: string, header: string): ColumnDef<Record<string, unknown>> => ({ accessorKey: key, header });

// A report renders to this shape; the manager lays it out uniformly.
type ReportView = {
  kpis: { label: string; value: string; hint?: string }[];
  columns: ColumnDef<Record<string, unknown>>[];
  rows: Record<string, unknown>[];
  csv: () => void;
  empty: string;
};

// ---- manager ----------------------------------------------------------------

export function InsightsManager({ data }: { data: InsightsData }) {
  const { canSeeInternal, currency } = data;
  const fc = React.useCallback((v: unknown) => formatCurrency(toMoney(v), currency), [currency]);
  const fcOrDash = React.useCallback(
    (v: number | null) => (v == null ? "—" : formatCurrency(v, currency)),
    [currency],
  );

  const [report, setReport] = React.useState<ReportKey>("overview");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [clientId, setClientId] = React.useState("all");
  const [productId, setProductId] = React.useState("all");
  const [repId, setRepId] = React.useState("all");
  const [manufacturer, setManufacturer] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [granularity, setGranularity] = React.useState<Granularity>("month");

  const fromF = from || null;
  const toF = to || null;

  // ---- filter option lists (derived from the scoped datasets) --------------
  const clientOptions = React.useMemo<[string, string][]>(() => {
    const m = new Map<string, string>();
    for (const o of data.orders) if (o.client_id) m.set(o.client_id, o.company_name ?? o.client_id);
    for (const q of data.quotes) if (q.client_id) m.set(q.client_id, q.company_name ?? q.client_id);
    return [["all", "All clients"], ...[...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))];
  }, [data.orders, data.quotes]);

  const repOptions = React.useMemo<[string, string][]>(() => {
    const m = new Map<string, string>();
    for (const o of data.orders) if (o.sales_rep_id) m.set(o.sales_rep_id, o.sales_rep_name ?? o.sales_rep_id);
    return [["all", "All representatives"], ...[...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))];
  }, [data.orders]);

  const productOptions = React.useMemo<[string, string][]>(() => {
    const m = new Map<string, string>();
    for (const l of data.lines) if (l.product_id) m.set(l.product_id, `${l.sku} · ${l.product_name}`);
    return [["all", "All products"], ...[...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))];
  }, [data.lines]);

  const manufacturerOptions = React.useMemo<[string, string][]>(() => {
    const s = new Set<string>();
    for (const l of data.lines) if (l.manufacturer_name) s.add(l.manufacturer_name);
    for (const m of data.manufacturerSpend) if (m.manufacturer_name) s.add(m.manufacturer_name);
    for (const p of data.openPos) if (p.manufacturer_name) s.add(p.manufacturer_name);
    return [["all", "All manufacturers"], ...[...s].sort().map((n) => [n, n] as [string, string])];
  }, [data.lines, data.manufacturerSpend, data.openPos]);

  // ---- filtered datasets ---------------------------------------------------
  const orders = React.useMemo(
    () =>
      data.orders.filter(
        (o) =>
          inDateRange(o.issue_date ?? o.created_at, fromF, toF) &&
          (clientId === "all" || o.client_id === clientId) &&
          (repId === "all" || o.sales_rep_id === repId) &&
          (status === "all" || o.status === status),
      ),
    [data.orders, fromF, toF, clientId, repId, status],
  );

  const lines = React.useMemo(
    () =>
      data.lines.filter(
        (l) =>
          inDateRange(l.issue_date, fromF, toF) &&
          (clientId === "all" || l.client_id === clientId) &&
          (repId === "all" || l.sales_rep_id === repId) &&
          (productId === "all" || l.product_id === productId) &&
          (manufacturer === "all" || l.manufacturer_name === manufacturer),
      ),
    [data.lines, fromF, toF, clientId, repId, productId, manufacturer],
  );

  const quotes = React.useMemo(
    () =>
      data.quotes.filter(
        (q) =>
          inDateRange(q.quote_date, fromF, toF) &&
          (clientId === "all" || q.client_id === clientId) &&
          (repId === "all" || q.sales_rep_id === repId) &&
          (status === "all" || q.status === status),
      ),
    [data.quotes, fromF, toF, clientId, repId, status],
  );

  // Status filter options depend on which report is active.
  const statusOptions = React.useMemo<[string, string][]>(() => {
    let values: string[] = [];
    if (report === "receivables") values = [...new Set(data.receivables.map((r) => r.status))];
    else if (report === "commissions") values = [...new Set(data.commissions.map((c) => c.status))];
    else if (report === "quotes") values = [...new Set(data.quotes.map((q) => q.status))];
    else if (report === "revenue-time" || report === "sales-by-client" || report === "sales-by-rep")
      values = [...new Set(data.orders.map((o) => o.status))];
    return [["all", "All statuses"], ...values.sort().map((v) => [v, v] as [string, string])];
  }, [report, data.receivables, data.commissions, data.quotes, data.orders]);

  const showStatusFilter =
    report === "receivables" ||
    report === "commissions" ||
    report === "quotes" ||
    report === "revenue-time" ||
    report === "sales-by-client" ||
    report === "sales-by-rep";

  const receivables = React.useMemo(
    () =>
      data.receivables.filter(
        (r) =>
          (clientId === "all" || r.client_id === clientId) &&
          (repId === "all" || r.sales_rep_id === repId) &&
          (status === "all" || r.status === status),
      ),
    [data.receivables, clientId, repId, status],
  );

  const commissions = React.useMemo(
    () =>
      data.commissions.filter(
        (c) =>
          inDateRange(c.created_at, fromF, toF) &&
          (clientId === "all" || c.client_id === clientId) &&
          (status === "all" || c.status === status),
      ),
    [data.commissions, fromF, toF, clientId, status],
  );

  // ---- shared column helpers -----------------------------------------------
  const moneyCol = React.useCallback(
    (key: string, header: string): ColumnDef<Record<string, unknown>> => ({
      accessorKey: key,
      header,
      cell: ({ getValue }) => <span className="tabular-nums">{fc(getValue())}</span>,
    }),
    [fc],
  );
  const maskedMoneyCol = React.useCallback(
    (key: string, header: string): ColumnDef<Record<string, unknown>> => ({
      accessorKey: key,
      header,
      cell: ({ getValue }) => <span className="tabular-nums">{fcOrDash(getValue() as number | null)}</span>,
    }),
    [fcOrDash],
  );
  const stamp = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ---- per-report views ----------------------------------------------------
  const view: ReportView = React.useMemo(() => {
    switch (report) {
      case "revenue-time": {
        const buckets = aggregateOverTime(orders, granularity);
        const rows = buckets.map((b) => ({
          period: b.period,
          orders: b.orders,
          revenue: b.revenue,
          grossProfit: b.grossProfit,
          netProfit: b.netProfit,
        }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("period", granularity === "month" ? "Month" : granularity === "week" ? "Week of" : "Day"),
          numCol("orders", "Orders"),
          moneyCol("revenue", "Revenue"),
          ...(canSeeInternal ? [maskedMoneyCol("grossProfit", "Gross profit"), maskedMoneyCol("netProfit", "Net profit")] : []),
        ];
        return {
          kpis: [
            { label: "Revenue", value: fc(sumMoney(orders, "total")), hint: `${orders.length} orders` },
            ...(canSeeInternal
              ? [
                  { label: "Gross profit", value: fcOrDash(maskedSum(orders, "gross_profit")) },
                  { label: "Net profit", value: fcOrDash(maskedSum(orders, "net_profit")) },
                ]
              : []),
          ],
          columns,
          rows,
          empty: "No orders in this range.",
          csv: () =>
            downloadCsv(
              `revenue-over-time-${stamp}.csv`,
              toCsv(
                [
                  { key: "period", label: "Period" },
                  { key: "orders", label: "Orders" },
                  { key: "revenue", label: "Revenue" },
                  ...(canSeeInternal
                    ? [
                        { key: "grossProfit", label: "Gross profit" },
                        { key: "netProfit", label: "Net profit" },
                      ]
                    : []),
                ],
                rows,
              ),
            ),
        };
      }

      case "sales-by-client":
      case "top-clients": {
        const agg = groupAggregate(
          orders,
          (o) => o.client_id,
          (o) => o.company_name ?? o.client_id ?? "—",
        );
        const sliced = report === "top-clients" ? agg.slice(0, 10) : agg;
        const rows = sliced.map((g) => ({
          client: g.label,
          orders: g.orders,
          revenue: g.revenue,
          grossProfit: g.grossProfit,
          netProfit: g.netProfit,
        }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("client", "Client"),
          numCol("orders", "Orders"),
          moneyCol("revenue", "Revenue"),
          ...(canSeeInternal ? [maskedMoneyCol("grossProfit", "Gross profit"), maskedMoneyCol("netProfit", "Net profit")] : []),
        ];
        return {
          kpis: [
            { label: "Clients", value: String(agg.length) },
            { label: "Revenue", value: fc(sumMoney(orders, "total")) },
            ...(canSeeInternal ? [{ label: "Gross profit", value: fcOrDash(maskedSum(orders, "gross_profit")) }] : []),
          ],
          columns,
          rows,
          empty: "No sales for these filters.",
          csv: () =>
            downloadCsv(
              `${report}-${stamp}.csv`,
              toCsv(
                [
                  { key: "client", label: "Client" },
                  { key: "orders", label: "Orders" },
                  { key: "revenue", label: "Revenue" },
                  ...(canSeeInternal
                    ? [
                        { key: "grossProfit", label: "Gross profit" },
                        { key: "netProfit", label: "Net profit" },
                      ]
                    : []),
                ],
                rows,
              ),
            ),
        };
      }

      case "sales-by-product":
      case "top-products": {
        // Product revenue = frozen line_subtotal; GP = line_gross_profit (admin).
        const map = new Map<string, { label: string; sku: string; units: number; revenue: number; gp: number | null }>();
        let gpMasked = false;
        for (const l of lines) {
          const key = l.product_id ?? l.sku;
          if (!key) continue;
          const cur = map.get(key) ?? { label: l.product_name, sku: l.sku, units: 0, revenue: 0, gp: 0 };
          cur.units += toMoney(l.quantity);
          cur.revenue += toMoney(l.line_revenue);
          if (l.line_gross_profit == null) gpMasked = true;
          else if (cur.gp != null) cur.gp += toMoney(l.line_gross_profit);
          map.set(key, cur);
        }
        const agg = [...map.values()]
          .map((v) => ({ ...v, revenue: Math.round(v.revenue * 100) / 100, gp: gpMasked ? null : v.gp == null ? null : Math.round(v.gp * 100) / 100 }))
          .sort((a, b) => b.revenue - a.revenue);
        const sliced = report === "top-products" ? agg.slice(0, 10) : agg;
        const rows = sliced.map((g) => ({ sku: g.sku, product: g.label, units: g.units, revenue: g.revenue, grossProfit: g.gp }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("sku", "SKU"),
          textCol("product", "Product"),
          numCol("units", "Units"),
          moneyCol("revenue", "Revenue"),
          ...(canSeeInternal ? [maskedMoneyCol("grossProfit", "Gross profit")] : []),
        ];
        return {
          kpis: [
            { label: "Products", value: String(agg.length) },
            { label: "Units", value: rows.reduce((s, r) => s + Number(r.units), 0).toLocaleString() },
            { label: "Revenue", value: fc(agg.reduce((s, r) => s + r.revenue, 0)) },
          ],
          columns,
          rows,
          empty: "No product sales for these filters.",
          csv: () =>
            downloadCsv(
              `${report}-${stamp}.csv`,
              toCsv(
                [
                  { key: "sku", label: "SKU" },
                  { key: "product", label: "Product" },
                  { key: "units", label: "Units" },
                  { key: "revenue", label: "Revenue" },
                  ...(canSeeInternal ? [{ key: "grossProfit", label: "Gross profit" }] : []),
                ],
                rows,
              ),
            ),
        };
      }

      case "sales-by-rep": {
        const agg = groupAggregate(
          orders,
          (o) => o.sales_rep_id,
          (o) => o.sales_rep_name ?? o.sales_rep_id ?? "Unassigned",
        );
        const rows = agg.map((g) => ({ rep: g.label, orders: g.orders, revenue: g.revenue, grossProfit: g.grossProfit, netProfit: g.netProfit }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("rep", "Representative"),
          numCol("orders", "Orders"),
          moneyCol("revenue", "Revenue"),
          ...(canSeeInternal ? [maskedMoneyCol("grossProfit", "Gross profit"), maskedMoneyCol("netProfit", "Net profit")] : []),
        ];
        return {
          kpis: [
            { label: "Representatives", value: String(agg.length) },
            { label: "Revenue", value: fc(sumMoney(orders, "total")) },
          ],
          columns,
          rows,
          empty: "No sales for these filters.",
          csv: () =>
            downloadCsv(
              `sales-by-rep-${stamp}.csv`,
              toCsv(
                [
                  { key: "rep", label: "Representative" },
                  { key: "orders", label: "Orders" },
                  { key: "revenue", label: "Revenue" },
                  ...(canSeeInternal
                    ? [
                        { key: "grossProfit", label: "Gross profit" },
                        { key: "netProfit", label: "Net profit" },
                      ]
                    : []),
                ],
                rows,
              ),
            ),
        };
      }

      case "receivables": {
        const rows = receivables.map((r) => ({
          invoice: r.invoice_number,
          client: r.company_name ?? "—",
          due: r.due_date ?? "—",
          bucket: r.aging_bucket,
          daysOverdue: r.days_overdue,
          total: r.total,
          paid: r.amount_paid,
          balance: r.balance_due,
        }));
        const outstanding = sumMoney(receivables, "balance_due");
        const overdue = sumMoney(
          receivables.filter((r) => r.aging_bucket !== "current"),
          "balance_due",
        );
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("invoice", "Invoice"),
          textCol("client", "Client"),
          textCol("due", "Due"),
          textCol("bucket", "Aging"),
          numCol("daysOverdue", "Days overdue"),
          moneyCol("total", "Total"),
          moneyCol("paid", "Paid"),
          moneyCol("balance", "Balance"),
        ];
        return {
          kpis: [
            { label: "Outstanding", value: fc(outstanding), hint: `${receivables.length} open invoices` },
            { label: "Overdue", value: fc(overdue) },
          ],
          columns,
          rows,
          empty: "No open receivables for these filters.",
          csv: () =>
            downloadCsv(
              `receivables-${stamp}.csv`,
              toCsv(
                [
                  { key: "invoice", label: "Invoice" },
                  { key: "client", label: "Client" },
                  { key: "due", label: "Due" },
                  { key: "bucket", label: "Aging" },
                  { key: "daysOverdue", label: "Days overdue" },
                  { key: "total", label: "Total" },
                  { key: "paid", label: "Paid" },
                  { key: "balance", label: "Balance" },
                ],
                rows,
              ),
            ),
        };
      }

      case "commissions": {
        const rows = commissions.map((c) => ({
          invoice: c.invoice_number,
          recipient: c.recipient_name ?? "—",
          type: c.commission_type,
          status: c.status,
          amount: c.amount,
          paid: c.paid_at ? c.paid_at.slice(0, 10) : "—",
        }));
        const owed = sumMoney(
          commissions.filter((c) => c.status === "earned" || c.status === "approved"),
          "amount",
        );
        const paid = sumMoney(
          commissions.filter((c) => c.status === "paid"),
          "amount",
        );
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("invoice", "Invoice"),
          textCol("recipient", "Recipient"),
          textCol("type", "Type"),
          textCol("status", "Status"),
          moneyCol("amount", "Amount"),
          textCol("paid", "Paid on"),
        ];
        return {
          kpis: [
            { label: "Owed", value: fc(owed), hint: "Earned & approved" },
            { label: "Paid", value: fc(paid) },
          ],
          columns,
          rows,
          empty: "No commissions for these filters.",
          csv: () =>
            downloadCsv(
              `commissions-${stamp}.csv`,
              toCsv(
                [
                  { key: "invoice", label: "Invoice" },
                  { key: "recipient", label: "Recipient" },
                  { key: "type", label: "Type" },
                  { key: "status", label: "Status" },
                  { key: "amount", label: "Amount" },
                  { key: "paid", label: "Paid on" },
                ],
                rows,
              ),
            ),
        };
      }

      case "quotes": {
        const total = quotes.length;
        const draft = quotes.filter((q) => q.status === "draft").length;
        const sent = quotes.filter((q) => q.status === "sent").length;
        const accepted = quotes.filter((q) => q.status === "accepted").length;
        const converted = quotes.filter((q) => q.status === "converted").length;
        const postDraft = quotes.filter((q) => q.status !== "draft").length;
        const rate = conversionRate({ converted, postDraftTotal: postDraft });
        // one row per status for the table
        const byStatus = new Map<string, { count: number; value: number }>();
        for (const q of quotes) {
          const cur = byStatus.get(q.status) ?? { count: 0, value: 0 };
          cur.count += 1;
          cur.value += toMoney(q.total);
          byStatus.set(q.status, cur);
        }
        const rows = [...byStatus.entries()].map(([s, v]) => ({ status: s, count: v.count, value: Math.round(v.value * 100) / 100 }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("status", "Status"),
          numCol("count", "Quotes"),
          moneyCol("value", "Value"),
        ];
        return {
          kpis: [
            { label: "Quotes", value: String(total), hint: `${draft} draft · ${sent} sent` },
            { label: "Accepted", value: String(accepted) },
            { label: "Converted", value: String(converted) },
            { label: "Conversion", value: `${(rate * 100).toFixed(1)}%`, hint: "Converted ÷ quotes sent" },
          ],
          columns,
          rows,
          empty: "No quotes for these filters.",
          csv: () =>
            downloadCsv(
              `quote-activity-${stamp}.csv`,
              toCsv(
                [
                  { key: "status", label: "Status" },
                  { key: "count", label: "Quotes" },
                  { key: "value", label: "Value" },
                ],
                rows,
              ),
            ),
        };
      }

      case "purchase-spend": {
        const rows = data.manufacturerSpend
          .filter((m) => manufacturer === "all" || m.manufacturer_name === manufacturer)
          .map((m) => ({
            manufacturer: m.manufacturer_name,
            pos: m.po_count,
            committed: m.committed,
            paid: m.paid,
            balance: m.balance,
          }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("manufacturer", "Manufacturer"),
          numCol("pos", "POs"),
          moneyCol("committed", "Committed"),
          moneyCol("paid", "Paid"),
          moneyCol("balance", "Balance"),
        ];
        return {
          kpis: [
            { label: "Committed", value: fc(rows.reduce((s, r) => s + Number(r.committed), 0)) },
            { label: "Paid", value: fc(rows.reduce((s, r) => s + Number(r.paid), 0)) },
          ],
          columns,
          rows,
          empty: "No manufacturer spend recorded.",
          csv: () =>
            downloadCsv(
              `purchase-spend-${stamp}.csv`,
              toCsv(
                [
                  { key: "manufacturer", label: "Manufacturer" },
                  { key: "pos", label: "POs" },
                  { key: "committed", label: "Committed" },
                  { key: "paid", label: "Paid" },
                  { key: "balance", label: "Balance" },
                ],
                rows,
              ),
            ),
        };
      }

      case "open-pos": {
        const open = data.openPos.filter((p) => p.status !== "closed" && p.status !== "void" && p.status !== "draft");
        const scoped = open.filter((p) => manufacturer === "all" || p.manufacturer_name === manufacturer);
        // stage rollup
        const byStage = new Map<string, { count: number; value: number }>();
        for (const p of scoped) {
          const cur = byStage.get(p.status) ?? { count: 0, value: 0 };
          cur.count += 1;
          cur.value += toMoney(p.balance_due);
          byStage.set(p.status, cur);
        }
        const rows = [...byStage.entries()].map(([s, v]) => ({ stage: s, count: v.count, balance: Math.round(v.value * 100) / 100 }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("stage", "Stage"),
          numCol("count", "Open POs"),
          moneyCol("balance", "Outstanding balance"),
        ];
        return {
          kpis: [
            { label: "Open POs", value: String(scoped.length) },
            { label: "Outstanding", value: fc(scoped.reduce((s, p) => s + p.balance_due, 0)) },
          ],
          columns,
          rows,
          empty: "No open purchase orders.",
          csv: () =>
            downloadCsv(
              `open-pos-by-stage-${stamp}.csv`,
              toCsv(
                [
                  { key: "stage", label: "Stage" },
                  { key: "count", label: "Open POs" },
                  { key: "balance", label: "Outstanding balance" },
                ],
                rows,
              ),
            ),
        };
      }

      case "activity": {
        const rows = data.activity.map((a) => ({
          when: new Date(a.created_at).toLocaleString(),
          summary: a.summary ?? a.action,
          type: a.entity_type,
          actor: a.actor_name ?? "—",
        }));
        const columns: ColumnDef<Record<string, unknown>>[] = [
          textCol("when", "When"),
          textCol("summary", "Event"),
          textCol("type", "Entity"),
          textCol("actor", "Actor"),
        ];
        return {
          kpis: [{ label: "Events", value: String(rows.length), hint: "Most recent first" }],
          columns,
          rows,
          empty: "No recent activity.",
          csv: () =>
            downloadCsv(
              `recent-activity-${stamp}.csv`,
              toCsv(
                [
                  { key: "when", label: "When" },
                  { key: "summary", label: "Event" },
                  { key: "type", label: "Entity" },
                  { key: "actor", label: "Actor" },
                ],
                rows,
              ),
            ),
        };
      }

      // overview
      default: {
        const revenue = sumMoney(orders, "total");
        const gp = maskedSum(orders, "gross_profit");
        const net = maskedSum(orders, "net_profit");
        const outstanding = sumMoney(receivables, "balance_due");
        const overdue = sumMoney(receivables.filter((r) => r.aging_bucket !== "current"), "balance_due");
        const commOwed = sumMoney(commissions.filter((c) => c.status === "earned" || c.status === "approved"), "amount");
        const commPaid = sumMoney(commissions.filter((c) => c.status === "paid"), "amount");
        const converted = quotes.filter((q) => q.status === "converted").length;
        const postDraft = quotes.filter((q) => q.status !== "draft").length;
        const rows = [
          { metric: "Revenue", value: fc(revenue) },
          ...(canSeeInternal ? [{ metric: "Gross profit", value: fcOrDash(gp) }, { metric: "Net profit", value: fcOrDash(net) }] : []),
          { metric: "Orders", value: String(orders.length) },
          { metric: "Outstanding receivables", value: fc(outstanding) },
          { metric: "Overdue receivables", value: fc(overdue) },
          { metric: "Commission owed", value: fc(commOwed) },
          { metric: "Commission paid", value: fc(commPaid) },
          { metric: "Quote conversion", value: `${(conversionRate({ converted, postDraftTotal: postDraft }) * 100).toFixed(1)}%` },
          ...(canSeeInternal
            ? [
                { metric: "Manufacturer committed", value: fc(data.manufacturerSpend.reduce((s, m) => s + m.committed, 0)) },
                { metric: "Manufacturer paid", value: fc(data.manufacturerSpend.reduce((s, m) => s + m.paid, 0)) },
              ]
            : []),
        ];
        return {
          kpis: [
            { label: "Revenue", value: fc(revenue), hint: `${orders.length} orders` },
            ...(canSeeInternal ? [{ label: "Gross profit", value: fcOrDash(gp) }, { label: "Net profit", value: fcOrDash(net) }] : []),
            { label: "Outstanding", value: fc(outstanding) },
          ],
          columns: [textCol("metric", "Metric"), { accessorKey: "value", header: "Value", cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> }],
          rows,
          empty: "No data for these filters.",
          csv: () =>
            downloadCsv(
              `insights-overview-${stamp}.csv`,
              toCsv([{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], rows),
            ),
        };
      }
    }
  }, [report, orders, lines, quotes, receivables, commissions, data, granularity, canSeeInternal, fc, fcOrDash, stamp, manufacturer, maskedMoneyCol, moneyCol]);

  const visibleReports = REPORTS.filter((r) => !r.adminOnly || canSeeInternal);

  return (
    <div className="space-y-6">
      {data.capped && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          Showing the most recent records (dataset cap reached). Narrow the date range for complete totals over older periods.
        </div>
      )}

      {/* report selector */}
      <div className="flex flex-wrap gap-2">
        {visibleReports.map((r) => (
          <Button
            key={r.key}
            variant={report === r.key ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setReport(r.key);
              setStatus("all");
            }}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <DateInput label="From" value={from} onChange={setFrom} />
        <DateInput label="To" value={to} onChange={setTo} />
        <FilterSelect label="Client" value={clientId} onChange={setClientId} options={clientOptions} />
        <FilterSelect label="Representative" value={repId} onChange={setRepId} options={repOptions} />
        {(report === "sales-by-product" || report === "top-products") && (
          <FilterSelect label="Product" value={productId} onChange={setProductId} options={productOptions} />
        )}
        {(report === "purchase-spend" || report === "open-pos" || report === "sales-by-product") && (
          <FilterSelect label="Manufacturer" value={manufacturer} onChange={setManufacturer} options={manufacturerOptions} />
        )}
        {showStatusFilter && (
          <FilterSelect label="Status" value={status} onChange={setStatus} options={statusOptions} />
        )}
        {report === "revenue-time" && (
          <FilterSelect
            label="Granularity"
            value={granularity}
            onChange={(v) => setGranularity(v as Granularity)}
            options={[
              ["day", "Daily"],
              ["week", "Weekly"],
              ["month", "Monthly"],
            ]}
          />
        )}
        <div className="ml-auto flex items-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
              setClientId("all");
              setProductId("all");
              setRepId("all");
              setManufacturer("all");
              setStatus("all");
            }}
          >
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={view.csv} disabled={view.rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* KPI row */}
      {view.kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {view.kpis.map((k) => (
            <StatTile key={k.label} label={k.label} value={k.value} hint={k.hint} />
          ))}
        </div>
      )}

      {/* table or empty state */}
      {view.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nothing to report" description={view.empty} />
      ) : (
        <div className="overflow-x-auto">
          <DataTable columns={view.columns} data={view.rows} searchPlaceholder="Filter rows…" emptyMessage={view.empty} />
        </div>
      )}
    </div>
  );
}
