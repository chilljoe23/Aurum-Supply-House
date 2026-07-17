// ============================================================================
// Commission-statement view model — the single, client-safe builder shared by
// the on-screen preview (StatementBuilder) and the server PDF route, so the two
// can never drift (mirrors the invoice-view-model / one-component philosophy).
//
// The company header identity is fixed by the shared document-branding policy:
// name + city/state/country ONLY (COMPANY_NAME / COMPANY_LOCATION). No settings
// address, email, or phone is placed on this recipient-facing document.
//
// Only recipient-safe fields are ever produced here. Client true cost, gross
// profit, margin, and company net profit are NOT fields on StatementModel and
// therefore cannot appear on the statement or in its PDF.
// ============================================================================

import { COMPANY_NAME, COMPANY_LOCATION } from "@/lib/documents/branding";
import { formatRate } from "@/lib/commissions/calculations";
import { COMMISSION_TYPE_OPTIONS, COMMISSION_STATUS_LABELS, type CommissionType } from "@/lib/commissions/schemas";
import type { CommissionRow } from "@/lib/commissions/queries";

export type StatementRow = {
  invoiceNumber: string;
  client: string;
  invoicePaidDate: string | null;
  calcType: string;
  rate: string;
  amount: number;
  status: string;
  commissionPaidDate: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
};

export type StatementModel = {
  company: { name: string; location: string };
  recipient: { name: string; type: string; company: string | null; email: string | null };
  periodLabel: string;
  generatedOn: string;
  currency: string;
  rows: StatementRow[];
  total: number;
  paidTotal: number;
  earnedTotal: number;
  approvedTotal: number;
  owedTotal: number; // earned + approved (not yet paid)
};

// Statuses that the "active" filter keeps (everything except void/pending noise).
export type StatementStatusFilter = "active" | "earned" | "approved" | "paid" | "all";

export type StatementParams = {
  recipientKey: string;
  statusFilter: StatementStatusFilter;
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
  generatedOn: string; // caller supplies (Date is unavailable in some render contexts)
};

const TYPE_LABEL = Object.fromEntries(COMMISSION_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Stable identity for grouping commissions by recipient: internal users keyed by
// their profile id; external partners (no id) keyed by name. Same key on the
// client and the server, so a PDF request reproduces the exact same recipient.
export function recipientKey(c: CommissionRow): string {
  return c.recipient_id ?? `ext:${c.recipient_name}`;
}

export type StatementRecipient = { key: string; name: string; type: string; company: string | null; email: string | null };

export function statementRecipients(commissions: CommissionRow[]): StatementRecipient[] {
  const m = new Map<string, StatementRecipient>();
  for (const c of commissions) {
    const k = recipientKey(c);
    if (!m.has(k)) m.set(k, { key: k, name: c.recipient_name, type: c.recipient_type, company: c.recipient_company, email: c.recipient_email });
  }
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function fmtDate(s: string | null): string | null {
  return s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null;
}

// Build a statement for exactly one recipient. Returns null when the recipient
// key matches nothing in the provided (already RLS-scoped) commission set.
export function buildStatementModel(commissions: CommissionRow[], params: StatementParams): StatementModel | null {
  const rec = statementRecipients(commissions).find((r) => r.key === params.recipientKey);
  if (!rec) return null;

  const rows = commissions
    .filter((c) => recipientKey(c) === params.recipientKey)
    .filter((c) => {
      if (params.statusFilter === "active") return c.status !== "void" && c.status !== "pending";
      if (params.statusFilter === "all") return true;
      return c.status === params.statusFilter;
    })
    .filter((c) => {
      const d = (c.invoice_issue_date ?? c.created_at).slice(0, 10);
      if (params.from && d < params.from) return false;
      if (params.to && d > params.to) return false;
      return true;
    })
    .sort((a, b) => (a.invoice_number < b.invoice_number ? -1 : 1));

  const statementRows: StatementRow[] = rows.map((c) => ({
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
  const earnedTotal = rows.filter((c) => c.status === "earned").reduce((s, c) => s + c.amount, 0);
  const approvedTotal = rows.filter((c) => c.status === "approved").reduce((s, c) => s + c.amount, 0);
  const owedTotal = earnedTotal + approvedTotal;
  const periodLabel = params.from || params.to ? `${fmtDate(params.from) ?? "Beginning"} – ${fmtDate(params.to) ?? "Present"}` : "All dates";

  return {
    company: { name: COMPANY_NAME, location: COMPANY_LOCATION },
    recipient: { name: rec.name, type: rec.type, company: rec.company, email: rec.email },
    periodLabel,
    generatedOn: params.generatedOn,
    currency: "USD",
    rows: statementRows,
    total,
    paidTotal,
    earnedTotal,
    approvedTotal,
    owedTotal,
  };
}
