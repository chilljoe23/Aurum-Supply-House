import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getArSummary } from "@/lib/ar/queries";
import { getCommissionSummary, getCommissionPaidSince } from "@/lib/commissions/queries";

// Command Center metrics — all from real, RLS-scoped views. Reps see their own
// book; profit figures are NULL for reps (v_orders masks them). Nothing is
// fabricated: a figure is zero only when the underlying records sum to zero.

export type CommandCenterMetrics = {
  revenueMtd: number;
  netProfitMtd: number | null; // null for reps (masked)
  outstanding: number;
  overdue: number;
  openInvoiceCount: number;
  commissionOwed: number;
  commissionPaidThisMonth: number;
};

function monthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export async function getCommandCenterMetrics(): Promise<CommandCenterMetrics> {
  const supabase = await createClient();
  const start = monthStartIso();

  const [{ data: orders }, ar, comm, paidMonth] = await Promise.all([
    supabase
      .from("v_orders")
      .select("total,net_profit,issue_date,status")
      .in("status", ["sent", "partial", "paid"])
      .gte("issue_date", start)
      .limit(5000),
    getArSummary(),
    getCommissionSummary(),
    getCommissionPaidSince(start),
  ]);

  const rows = orders ?? [];
  const revenueMtd = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const anyMasked = rows.some((r) => r.net_profit == null);
  const netProfitMtd = anyMasked ? null : rows.reduce((s, r) => s + Number(r.net_profit ?? 0), 0);

  return {
    revenueMtd,
    netProfitMtd,
    outstanding: ar.total_outstanding,
    overdue: ar.overdue_amt,
    openInvoiceCount: ar.invoice_count,
    commissionOwed: comm.owed,
    commissionPaidThisMonth: paidMonth,
  };
}

export type ActivityItem = {
  id: string;
  action: string;
  summary: string | null;
  entity_type: string;
  created_at: string;
  actor_name: string | null;
};

export async function getRecentActivity(limit = 12): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("id,action,summary,entity_type,created_at,actor_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", ids);
    names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  }
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    entity_type: r.entity_type,
    created_at: r.created_at,
    actor_name: r.actor_id ? names.get(r.actor_id) ?? null : null,
  }));
}
