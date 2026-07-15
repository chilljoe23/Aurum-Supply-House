// Client-safe AR types + constants (no server-only imports), so client
// components can use them without pulling the server query module into the bundle.

export type ArAgingRow = {
  id: string;
  invoice_number: string;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  currency: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  total: number;
  amount_paid: number;
  balance_due: number;
  days_overdue: number;
  aging_bucket: "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
};

export const AGING_BUCKETS: { key: ArAgingRow["aging_bucket"]; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90_plus", label: "90+ days" },
];

export type ArSummary = {
  invoice_count: number;
  total_outstanding: number;
  current_amt: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  overdue_amt: number;
};
