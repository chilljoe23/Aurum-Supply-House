"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HandCoins, Download, CheckCheck, Coins, Loader2, X, FileText, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KpiCard } from "@/components/patterns/kpi-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CommissionStatusBadge } from "@/components/commissions/commission-badge";
import { CommissionActions } from "@/components/commissions/commission-actions";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/orders/schemas";
import { COMMISSION_TYPE_OPTIONS, COMMISSION_STATUS_LABELS, type CommissionType } from "@/lib/commissions/schemas";
import { formatRate } from "@/lib/commissions/calculations";
import { bulkApproveCommissions, bulkPayCommissions } from "@/app/(app)/commissions/actions";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import { formatCurrency } from "@/lib/utils";
import type { CommissionRow, CommissionSummary } from "@/lib/commissions/queries";

const TYPE_LABEL = Object.fromEntries(COMMISSION_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const PAGE_SIZE = 25;
const fmtDate = (s: string | null) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString() : "—");

type SortKey = "date" | "amount" | "status" | "recipient" | "invoice";

export function CommissionsManager({
  commissions,
  summary,
  canManage,
}: {
  commissions: CommissionRow[];
  summary: CommissionSummary;
  canManage: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState("all");
  const [rType, setRType] = React.useState("all");
  const [recipient, setRecipient] = React.useState("all");
  const [client, setClient] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [detail, setDetail] = React.useState<CommissionRow | null>(null);
  const [payOpen, setPayOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const recipientOptions = React.useMemo(
    () => uniquePairs(commissions, (c) => [c.recipient_id ?? c.recipient_name, c.recipient_name]),
    [commissions],
  );
  const clientOptions = React.useMemo(() => uniquePairs(commissions, (c) => [c.client_id, c.company_name]), [commissions]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = commissions.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (rType !== "all" && c.recipient_type !== rType) return false;
      if (recipient !== "all" && (c.recipient_id ?? c.recipient_name) !== recipient) return false;
      if (client !== "all" && c.client_id !== client) return false;
      const d = (c.invoice_issue_date ?? c.created_at).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (needle) {
        const hay = `${c.invoice_number} ${c.company_name ?? ""} ${c.recipient_name}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort.key) {
        case "amount":
          return (a.amount - b.amount) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "recipient":
          return a.recipient_name.localeCompare(b.recipient_name) * dir;
        case "invoice":
          return a.invoice_number.localeCompare(b.invoice_number) * dir;
        default:
          return ((a.invoice_issue_date ?? a.created_at) < (b.invoice_issue_date ?? b.created_at) ? -1 : 1) * dir;
      }
    });
    return rows;
  }, [commissions, status, rType, recipient, client, q, from, to, sort]);

  React.useEffect(() => setPage(0), [status, rType, recipient, client, q, from, to]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const selectableIds = filtered.filter((c) => c.status === "earned" || c.status === "approved").map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedRows = commissions.filter((c) => selected.has(c.id));
  const canApproveCount = selectedRows.filter((c) => c.status === "earned").length;
  const canPayCount = selectedRows.filter((c) => c.status === "approved").length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function doBulkApprove() {
    setBusy(true);
    setNotice(null);
    const res = await bulkApproveCommissions({ ids: Array.from(selected) });
    setBusy(false);
    if (!res.ok) return setNotice(res.error);
    setSelected(new Set());
    setNotice(`Approved ${res.data?.approved ?? 0}${res.data?.skipped ? `, skipped ${res.data.skipped}` : ""}.`);
    router.refresh();
  }

  function exportCsv() {
    const cols = [
      { key: "invoice_number", label: "Invoice" },
      { key: "company_name", label: "Client" },
      { key: "recipient_name", label: "Recipient" },
      { key: "recipient_type", label: "Recipient type" },
      { key: "commission_type", label: "Type" },
      { key: "rate", label: "Rate" },
      { key: "amount", label: "Amount" },
      { key: "status", label: "Status" },
      { key: "invoice_issue_date", label: "Issued" },
      { key: "approved_at", label: "Approved" },
      { key: "paid_at", label: "Paid" },
    ];
    const rows = filtered.map((c) => ({
      ...c,
      recipient_type: c.recipient_type === "external_partner" ? "External" : "Internal",
      commission_type: TYPE_LABEL[c.commission_type] ?? c.commission_type,
      rate: formatRate(c.commission_type as CommissionType, c.rate),
      status: COMMISSION_STATUS_LABELS[c.status] ?? c.status,
      invoice_issue_date: fmtDate(c.invoice_issue_date),
      approved_at: fmtDate(c.approved_at),
      paid_at: fmtDate(c.paid_at),
    }));
    downloadCsv(`commissions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(cols, rows));
  }

  function SortHead({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    return (
      <th className={`py-2 pr-3 font-medium ${className ?? ""}`}>
        <button
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}
        >
          {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
        </button>
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Pending" value={formatCurrency(summary.pending)} icon={HandCoins} hint="Awaiting invoice payment" />
        <KpiCard label="Earned" value={formatCurrency(summary.earned)} icon={HandCoins} hint="Invoice paid; awaiting approval" />
        <KpiCard label="Approved" value={formatCurrency(summary.approved)} icon={HandCoins} hint="Ready to pay" />
        <KpiCard label="Owed" value={formatCurrency(summary.owed)} icon={HandCoins} hint="Earned + approved" />
        <KpiCard label="Paid" value={formatCurrency(summary.paid)} icon={Coins} hint="Lifetime" />
      </div>

      {commissions.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No commissions yet"
          description="Commissions are added from an order's detail page — pick internal reps or external partners and choose how each is calculated."
        />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, client, recipient…" className="h-9 w-64" />
            </div>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={[["all", "All statuses"], ...(["pending", "earned", "approved", "paid", "void"] as const).map((s) => [s, COMMISSION_STATUS_LABELS[s]] as [string, string])]} />
            <FilterSelect label="Recipient type" value={rType} onChange={setRType} options={[["all", "Internal & external"], ["internal_user", "Internal"], ["external_partner", "External"]]} />
            <FilterSelect label="Recipient" value={recipient} onChange={setRecipient} options={[["all", "All recipients"], ...recipientOptions]} />
            <FilterSelect label="Client" value={client} onChange={setClient} options={[["all", "All clients"], ...clientOptions]} />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href="/commissions/statements">
                  <FileText className="h-4 w-4" /> Statements
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>

          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

          {/* Bulk action bar */}
          {canManage && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <Button size="sm" variant="outline" onClick={doBulkApprove} disabled={busy || canApproveCount === 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Approve {canApproveCount || ""}
              </Button>
              <Button size="sm" onClick={() => setPayOpen(true)} disabled={busy || canPayCount === 0}>
                <Coins className="h-4 w-4" /> Mark paid {canPayCount || ""}
              </Button>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {canManage && (
                    <th className="w-10 py-2 pl-4">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" disabled={selectableIds.length === 0} />
                    </th>
                  )}
                  <SortHead label="Invoice" k="invoice" className="pl-2" />
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <SortHead label="Recipient" k="recipient" />
                  <th className="py-2 pr-3 font-medium">Type / rate</th>
                  <SortHead label="Amount" k="amount" className="text-right" />
                  <SortHead label="Status" k="status" />
                  <th className="py-2 pr-3 font-medium">Dates</th>
                  {canManage && <th className="py-2 pr-4 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.id} className="border-b border-border align-top last:border-0">
                    {canManage && (
                      <td className="py-2.5 pl-4">
                        {(c.status === "earned" || c.status === "approved") && (
                          <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.invoice_number}`} />
                        )}
                      </td>
                    )}
                    <td className="py-2.5 pl-2 pr-3">
                      <button className="font-mono text-xs font-medium hover:underline" onClick={() => setDetail(c)}>
                        {c.invoice_number}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3">{c.company_name ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <div>{c.recipient_name}</div>
                      <div className="text-xs text-muted-foreground">{c.recipient_type === "external_partner" ? "External" : "Internal"}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {TYPE_LABEL[c.commission_type] ?? c.commission_type}
                      <div className="text-xs">{formatRate(c.commission_type as CommissionType, c.rate)}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(c.amount)}</td>
                    <td className="py-2.5 pr-3">
                      <CommissionStatusBadge status={c.status} />
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {c.status === "paid" ? `Paid ${fmtDate(c.paid_at)}` : c.status === "approved" ? `Approved ${fmtDate(c.approved_at)}` : `Issued ${fmtDate(c.invoice_issue_date)}`}
                    </td>
                    {canManage && (
                      <td className="py-2.5 pr-4 text-right">
                        <CommissionActions id={c.id} status={c.status} amount={c.amount} currency="USD" onDone={() => router.refresh()} />
                      </td>
                    )}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 9 : 7} className="h-24 text-center text-muted-foreground">
                      No commissions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {detail && <DetailDrawer c={detail} canManage={canManage} onClose={() => setDetail(null)} onDone={() => router.refresh()} />}
      {payOpen && (
        <BulkPayDialog
          ids={Array.from(selected)}
          count={canPayCount}
          onClose={() => setPayOpen(false)}
          onDone={(msg) => {
            setPayOpen(false);
            setSelected(new Set());
            setNotice(msg);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DetailDrawer({ c, canManage, onClose, onDone }: { c: CommissionRow; canManage: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Commission <CommissionStatusBadge status={c.status} />
          </DialogTitle>
          <DialogDescription>
            <Link href={`/orders/${c.invoice_id}`} className="font-mono hover:underline">
              {c.invoice_number}
            </Link>{" "}
            · {c.company_name ?? "—"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Row label="Recipient" value={c.recipient_name} />
          <Row label="Recipient type" value={c.recipient_type === "external_partner" ? "External partner" : "Internal user"} />
          {c.recipient_company && <Row label="Company" value={c.recipient_company} />}
          {c.recipient_email && <Row label="Email" value={c.recipient_email} />}
          <Row label="Type" value={TYPE_LABEL[c.commission_type] ?? c.commission_type} />
          <Row label="Rate" value={formatRate(c.commission_type as CommissionType, c.rate)} />
          <Row label="Invoice subtotal" value={formatCurrency(c.invoice_subtotal)} />
          {c.can_see_internal && c.invoice_gross_profit != null && <Row label="Gross profit (basis)" value={formatCurrency(c.invoice_gross_profit)} />}
          <Row label="Amount" value={formatCurrency(c.amount)} strong />
          <div className="border-t border-border pt-2" />
          <Row label="Created" value={fmtDate(c.created_at)} />
          {c.approved_at && <Row label="Approved" value={fmtDate(c.approved_at)} />}
          {c.paid_at && <Row label="Paid" value={fmtDate(c.paid_at)} />}
          {c.paid_method && <Row label="Payment method" value={c.paid_method} />}
          {c.paid_reference && <Row label="Reference" value={c.paid_reference} />}
          {c.note && <Row label="Note" value={c.note} />}
        </div>
        {canManage && (
          <DialogFooter>
            <CommissionActions id={c.id} status={c.status} amount={c.amount} currency="USD" size="default" onDone={() => { onClose(); onDone(); }} />
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkPayDialog({ ids, count, onClose, onDone }: { ids: string[]; count: number; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState("wire");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await bulkPayCommissions({ ids, method, reference: reference || undefined, note: note || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(`Marked ${res.data?.paid ?? 0} paid${res.data?.skipped ? `, skipped ${res.data.skipped}` : ""}.`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {count} commission{count === 1 ? "" : "s"} paid</DialogTitle>
          <DialogDescription>Only approved commissions in the selection are paid; others are skipped. This is permanent.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Method</Label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Batch ref…" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Note</Label>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || count === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Mark {count} paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function uniquePairs(rows: CommissionRow[], get: (c: CommissionRow) => [string | null, string | null]): [string, string][] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const [id, label] = get(r);
    if (id) seen.set(id, label ?? "—");
  }
  return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
