import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createUntypedClient } from "@/lib/supabase/untyped";

// All reads go through v_commissions (row-scoped; reps see only their own; the
// invoice gross profit and GP-basis are NULL for non-admins at the DB layer).

export type CommissionRow = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  invoice_issue_date: string | null;
  invoice_due_date: string | null;
  invoice_paid_at: string | null;
  client_id: string | null;
  company_name: string | null;
  invoice_rep_id: string | null;
  invoice_rep_name: string | null;
  recipient_type: string;
  recipient_id: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_company: string | null;
  payment_notes: string | null;
  commission_type: string;
  rate: number;
  units: number | null;
  amount: number;
  status: string;
  invoice_subtotal: number;
  note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  paid_method: string | null;
  paid_reference: string | null;
  paid_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  invoice_gross_profit: number | null; // null for reps (masked)
  basis_amount: number | null; // null for reps when type = percent_of_gross_profit
  can_see_internal: boolean;
};

const COLS =
  "id,invoice_id,invoice_number,invoice_status,invoice_issue_date,invoice_due_date,invoice_paid_at,client_id,company_name,invoice_rep_id,invoice_rep_name,recipient_type,recipient_id,recipient_name,recipient_email,recipient_company,payment_notes,commission_type,rate,units,amount,status,invoice_subtotal,note,approved_by,approved_at,paid_by,paid_at,paid_method,paid_reference,paid_note,created_by,created_at,updated_at,invoice_gross_profit,basis_amount,can_see_internal";

function normalize(r: Record<string, unknown>): CommissionRow {
  return {
    ...(r as unknown as CommissionRow),
    rate: Number(r.rate ?? 0),
    units: r.units == null ? null : Number(r.units),
    amount: Number(r.amount ?? 0),
    invoice_subtotal: Number(r.invoice_subtotal ?? 0),
    invoice_gross_profit: r.invoice_gross_profit == null ? null : Number(r.invoice_gross_profit),
    basis_amount: r.basis_amount == null ? null : Number(r.basis_amount),
    can_see_internal: !!r.can_see_internal,
  };
}

export async function getCommissionsList(): Promise<CommissionRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_commissions")
    .select(COLS)
    .order("created_at", { ascending: false })
    .limit(2000);
  return (data ?? []).map((r) => normalize(r as Record<string, unknown>));
}

export async function getInvoiceCommissions(invoiceId: string): Promise<CommissionRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_commissions")
    .select(COLS)
    .eq("invoice_id", invoiceId)
    .order("created_at");
  return (data ?? []).map((r) => normalize(r as Record<string, unknown>));
}

export type CommissionSummary = {
  pending: number;
  earned: number;
  approved: number;
  paid: number;
  owed: number;
  active_count: number;
};

export async function getCommissionSummary(): Promise<CommissionSummary> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_commission_summary")
    .select("pending,earned,approved,paid,owed,active_count")
    .maybeSingle();
  return {
    pending: Number(data?.pending ?? 0),
    earned: Number(data?.earned ?? 0),
    approved: Number(data?.approved ?? 0),
    paid: Number(data?.paid ?? 0),
    owed: Number(data?.owed ?? 0),
    active_count: Number(data?.active_count ?? 0),
  };
}

// Commission paid within a calendar month (for Command Center). Scoped by view.
export async function getCommissionPaidSince(isoDate: string): Promise<number> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_commissions")
    .select("amount,paid_at,status")
    .eq("status", "paid")
    .gte("paid_at", isoDate)
    .limit(5000);
  return (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

// Active staff who can be internal commission recipients (admins pick from here).
export type RecipientProfile = { id: string; full_name: string; email: string; role: string };

export async function getRecipientProfiles(): Promise<RecipientProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,email,role")
    .eq("status", "active")
    .order("full_name");
  return (data ?? []) as RecipientProfile[];
}
