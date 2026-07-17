// Shared row shapes for the Insights reporting area. Money is normalized to
// numbers in the query layer; profit fields are `number | null` because the
// masked views return NULL for Sales Reps (never a fabricated 0).

export type OrderReportRow = {
  id: string;
  invoice_number: string;
  status: string;
  issue_date: string | null;
  created_at: string;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  gross_profit: number | null;
  net_profit: number | null;
  gross_margin: number | null;
  can_see_internal: boolean;
};

export type LineReportRow = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  issue_date: string | null;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  currency: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  manufacturer_name: string | null;
  quantity: number;
  unit_price: number;
  line_revenue: number;
  line_true_cost: number | null;
  line_gross_profit: number | null;
  can_see_internal: boolean;
};

export type QuoteReportRow = {
  id: string;
  quote_number: string;
  status: string;
  is_expired: boolean;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  currency: string;
  total: number;
  quote_date: string | null;
  expiration_date: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  converted_at: string | null;
  converted_order_id: string | null;
};

export type ReceivableReportRow = {
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
  aging_bucket: string;
};

export type CommissionReportRow = {
  id: string;
  invoice_number: string;
  invoice_status: string;
  client_id: string | null;
  company_name: string | null;
  recipient_id: string | null;
  recipient_name: string | null;
  commission_type: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

export type ManufacturerSpendRow = {
  manufacturer_id: string;
  manufacturer_name: string;
  po_count: number;
  committed: number; // sum(total) of non-void POs
  paid: number; // sum(signed_amount) — refunds netted
  balance: number; // committed - paid
};

export type OpenPoRow = {
  id: string;
  po_number: string;
  manufacturer_id: string;
  manufacturer_name: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  expected_date: string | null;
  next_expected_arrival: string | null;
};

export type ActivityReportRow = {
  id: string;
  action: string;
  summary: string | null;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
};

// Everything the Insights page hands to the client manager in one payload.
export type InsightsData = {
  canSeeInternal: boolean;
  currency: string;
  orders: OrderReportRow[];
  lines: LineReportRow[];
  quotes: QuoteReportRow[];
  receivables: ReceivableReportRow[];
  commissions: CommissionReportRow[];
  manufacturerSpend: ManufacturerSpendRow[]; // admin-only; [] for reps
  openPos: OpenPoRow[]; // admin-only; [] for reps
  activity: ActivityReportRow[];
  capped: boolean; // true if any dataset hit the row cap (surfaced to the user)
};
