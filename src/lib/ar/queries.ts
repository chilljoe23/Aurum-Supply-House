import "server-only";
import { createUntypedClient } from "@/lib/supabase/untyped";
import type { ArAgingRow, ArSummary } from "@/lib/ar/types";

// Accounts Receivable reads go through v_ar_aging / v_ar_summary (row-scoped;
// reps see only their book). These views carry NO cost/profit columns.
export type { ArAgingRow, ArSummary } from "@/lib/ar/types";
export { AGING_BUCKETS } from "@/lib/ar/types";

export async function getArAging(): Promise<ArAgingRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_ar_aging")
    .select(
      "id,invoice_number,client_id,company_name,sales_rep_id,sales_rep_name,currency,status,issue_date,due_date,total,amount_paid,balance_due,days_overdue,aging_bucket",
    )
    .order("due_date", { nullsFirst: false })
    .limit(2000);
  return (data ?? []).map((r) => ({
    ...(r as unknown as ArAgingRow),
    currency: (r.currency as string) ?? "USD",
    total: Number(r.total ?? 0),
    amount_paid: Number(r.amount_paid ?? 0),
    balance_due: Number(r.balance_due ?? 0),
    days_overdue: Number(r.days_overdue ?? 0),
  }));
}

export async function getArSummary(): Promise<ArSummary> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_ar_summary")
    .select("invoice_count,total_outstanding,current_amt,d1_30,d31_60,d61_90,d90_plus,overdue_amt")
    .maybeSingle();
  return {
    invoice_count: Number(data?.invoice_count ?? 0),
    total_outstanding: Number(data?.total_outstanding ?? 0),
    current_amt: Number(data?.current_amt ?? 0),
    d1_30: Number(data?.d1_30 ?? 0),
    d31_60: Number(data?.d31_60 ?? 0),
    d61_90: Number(data?.d61_90 ?? 0),
    d90_plus: Number(data?.d90_plus ?? 0),
    overdue_amt: Number(data?.overdue_amt ?? 0),
  };
}
