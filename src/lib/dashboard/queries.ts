import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createUntypedClient } from "@/lib/supabase/untyped";
import { getArSummary } from "@/lib/ar/queries";
import { getCommissionSummary, getCommissionPaidSince } from "@/lib/commissions/queries";
import { conversionRate, maskedSum, monthStartIso, toMoney } from "@/lib/insights/calculations";

// Command Center metrics — all from real, RLS-scoped views. Reps see their own
// book; profit figures are NULL for reps (v_orders masks them) and the PO /
// manufacturer surfaces return zero rows for reps at the DB layer (0350).
// Nothing is fabricated: a figure is zero only when the underlying records sum
// to zero, and profit is null (not zero) whenever it is masked.

export type CommandCenterMetrics = {
  // Month-to-date, time-based
  revenueMtd: number;
  grossProfitMtd: number | null; // null for reps (masked)
  netProfitMtd: number | null; // null for reps (masked)
  commissionPaidMtd: number;
  // Current balances / state
  outstanding: number;
  overdue: number;
  openInvoiceCount: number;
  commissionOwed: number;
  activeClients: number;
  // Quotes (in scope)
  draftQuotes: number;
  sentQuotes: number;
  quoteConversionRate: number; // 0..1
  // Owner/Admin only (null for reps — surfaces are admin-only at the DB layer)
  openPoCount: number | null;
  manufacturerSpendMtd: number | null;
};

export async function getCommandCenterMetrics(canSeeInternal: boolean): Promise<CommandCenterMetrics> {
  const supabase = await createClient();
  const untyped = await createUntypedClient();
  const start = monthStartIso(new Date());

  const [{ data: orders }, ar, comm, paidMonth, { data: quotes }, activeClientsCount] =
    await Promise.all([
      supabase
        .from("v_orders")
        .select("total,gross_profit,net_profit,issue_date,status")
        .in("status", ["sent", "partial", "paid"])
        .gte("issue_date", start)
        .limit(5000),
      getArSummary(),
      getCommissionSummary(),
      getCommissionPaidSince(start),
      untyped.from("v_quotes").select("status").limit(5000),
      countActiveClients(),
    ]);

  const rows = (orders ?? []) as Array<{ total: unknown; gross_profit: unknown; net_profit: unknown }>;
  const revenueMtd = rows.reduce((s, r) => s + toMoney(r.total), 0);
  const grossProfitMtd = maskedSum(rows, "gross_profit");
  const netProfitMtd = maskedSum(rows, "net_profit");

  const quoteRows = (quotes ?? []) as Array<{ status: unknown }>;
  const draftQuotes = quoteRows.filter((q) => q.status === "draft").length;
  const sentQuotes = quoteRows.filter((q) => q.status === "sent").length;
  const converted = quoteRows.filter((q) => q.status === "converted").length;
  const postDraftTotal = quoteRows.filter((q) => q.status !== "draft").length;

  let openPoCount: number | null = null;
  let manufacturerSpendMtd: number | null = null;
  if (canSeeInternal) {
    const [{ data: pos }, { data: pays }] = await Promise.all([
      untyped.from("v_purchase_orders").select("status").limit(5000),
      untyped.from("v_manufacturer_payments").select("signed_amount,payment_date").gte("payment_date", start).limit(5000),
    ]);
    const poRows = (pos ?? []) as Array<{ status: unknown }>;
    openPoCount = poRows.filter(
      (p) => p.status !== "draft" && p.status !== "closed" && p.status !== "void",
    ).length;
    manufacturerSpendMtd = (pays ?? []).reduce((s: number, p: { signed_amount: unknown }) => s + toMoney(p.signed_amount), 0);
  }

  return {
    revenueMtd: Math.round(revenueMtd * 100) / 100,
    grossProfitMtd,
    netProfitMtd,
    commissionPaidMtd: paidMonth,
    outstanding: ar.total_outstanding,
    overdue: ar.overdue_amt,
    openInvoiceCount: ar.invoice_count,
    commissionOwed: comm.owed,
    activeClients: activeClientsCount,
    draftQuotes,
    sentQuotes,
    quoteConversionRate: conversionRate({ converted, postDraftTotal }),
    openPoCount,
    manufacturerSpendMtd:
      manufacturerSpendMtd == null ? null : Math.round(manufacturerSpendMtd * 100) / 100,
  };
}

// Count of active clients the caller may see (RLS scopes reps to their book).
async function countActiveClients(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  return count ?? 0;
}

export type ActivityItem = {
  id: string;
  action: string;
  summary: string | null;
  entity_type: string;
  created_at: string;
  actor_name: string | null;
};

// Rep-safe recent activity via the DB-scoped RPC: admins see company-wide events;
// reps see only their own actions plus events on clients/invoices/quotes in
// their book. Actor names are resolved inside the RPC.
export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase.rpc("report_recent_activity", { p_limit: limit });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    action: String(r.action),
    summary: r.summary == null ? null : String(r.summary),
    entity_type: String(r.entity_type),
    created_at: String(r.created_at),
    actor_name: r.actor_name == null ? null : String(r.actor_name),
  }));
}
