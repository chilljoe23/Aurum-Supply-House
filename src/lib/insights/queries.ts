import "server-only";
import { createUntypedClient } from "@/lib/supabase/untyped";
import type { CurrentUser } from "@/lib/auth";
import { toMoney } from "@/lib/insights/calculations";
import type {
  ActivityReportRow,
  CommissionReportRow,
  InsightsData,
  LineReportRow,
  ManufacturerSpendRow,
  OpenPoRow,
  OrderReportRow,
  QuoteReportRow,
  ReceivableReportRow,
} from "@/lib/insights/types";

// Insights reads go exclusively through the RLS-scoped, column-masked surfaces
// (v_orders, v_report_order_lines, v_quotes, v_ar_aging, v_commissions,
// v_purchase_orders, v_manufacturer_payments) and the rep-safe
// report_recent_activity() RPC. Reps get their own book with profit NULL; the
// PO/manufacturer surfaces return zero rows for reps at the DB layer (0350).
//
// A single hard cap bounds each dataset. When a cap is hit we surface it to the
// user (no silent truncation) rather than pretend the totals are complete.
const ROW_CAP = 5000;
const EARNED = ["sent", "partial", "paid"] as const;

export async function getInsightsData(user: CurrentUser): Promise<InsightsData> {
  const canSeeInternal = user.role === "owner" || user.role === "admin";
  const supabase = await createUntypedClient();

  const [orders, lines, quotes, receivables, commissions, activity, pos, mfrPayments] =
    await Promise.all([
      supabase
        .from("v_orders")
        .select(
          "id,invoice_number,status,issue_date,created_at,client_id,company_name,sales_rep_id,sales_rep_name,currency,subtotal,discount,shipping,fees,tax_amount,total,amount_paid,balance_due,gross_profit,net_profit,gross_margin,can_see_internal",
        )
        .in("status", EARNED as unknown as string[])
        .order("issue_date", { ascending: false, nullsFirst: false })
        .limit(ROW_CAP),
      supabase
        .from("v_report_order_lines")
        .select(
          "id,invoice_id,invoice_number,status,issue_date,client_id,company_name,sales_rep_id,sales_rep_name,currency,product_id,sku,product_name,manufacturer_name,quantity,unit_price,line_revenue,line_true_cost,line_gross_profit,can_see_internal",
        )
        .in("status", EARNED as unknown as string[])
        .limit(ROW_CAP),
      supabase
        .from("v_quotes")
        .select(
          "id,quote_number,status,is_expired,client_id,company_name,sales_rep_id,sales_rep_name,currency,total,quote_date,expiration_date,sent_at,accepted_at,converted_at,converted_order_id",
        )
        .order("quote_date", { ascending: false, nullsFirst: false })
        .limit(ROW_CAP),
      supabase
        .from("v_ar_aging")
        .select(
          "id,invoice_number,client_id,company_name,sales_rep_id,sales_rep_name,currency,status,issue_date,due_date,total,amount_paid,balance_due,days_overdue,aging_bucket",
        )
        .order("due_date", { nullsFirst: false })
        .limit(ROW_CAP),
      supabase
        .from("v_commissions")
        .select(
          "id,invoice_number,invoice_status,client_id,company_name,recipient_id,recipient_name,commission_type,amount,status,paid_at,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(ROW_CAP),
      supabase.rpc("report_recent_activity", { p_limit: 40 }),
      // PO + manufacturer surfaces are admin-only at the DB layer; reps get [].
      canSeeInternal
        ? supabase
            .from("v_purchase_orders")
            .select(
              "id,po_number,manufacturer_id,manufacturer_name,status,currency,total,amount_paid,balance_due,expected_date,next_expected_arrival",
            )
            .order("created_at", { ascending: false })
            .limit(ROW_CAP)
        : Promise.resolve({ data: [] as unknown[] }),
      canSeeInternal
        ? supabase
            .from("v_manufacturer_payments")
            .select("manufacturer_id,manufacturer_name,signed_amount")
            .limit(ROW_CAP)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const orderRows = (orders.data ?? []) as Record<string, unknown>[];
  const lineRows = (lines.data ?? []) as Record<string, unknown>[];
  const quoteRows = (quotes.data ?? []) as Record<string, unknown>[];
  const arRows = (receivables.data ?? []) as Record<string, unknown>[];
  const commRows = (commissions.data ?? []) as Record<string, unknown>[];
  const actRows = (activity.data ?? []) as Record<string, unknown>[];
  const poRows = (pos.data ?? []) as Record<string, unknown>[];
  const mfrPayRows = (mfrPayments.data ?? []) as Record<string, unknown>[];

  const capped =
    orderRows.length >= ROW_CAP ||
    lineRows.length >= ROW_CAP ||
    quoteRows.length >= ROW_CAP ||
    arRows.length >= ROW_CAP ||
    commRows.length >= ROW_CAP;

  const num = (v: unknown): number => toMoney(v);
  const maskedNum = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
  const str = (v: unknown): string => (v == null ? "" : String(v));
  const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

  const mappedOrders: OrderReportRow[] = orderRows.map((r) => ({
    id: str(r.id),
    invoice_number: str(r.invoice_number),
    status: str(r.status),
    issue_date: strOrNull(r.issue_date),
    created_at: str(r.created_at),
    client_id: strOrNull(r.client_id),
    company_name: strOrNull(r.company_name),
    sales_rep_id: strOrNull(r.sales_rep_id),
    sales_rep_name: strOrNull(r.sales_rep_name),
    currency: str(r.currency) || "USD",
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    shipping: num(r.shipping),
    fees: num(r.fees),
    tax_amount: num(r.tax_amount),
    total: num(r.total),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    gross_profit: maskedNum(r.gross_profit),
    net_profit: maskedNum(r.net_profit),
    gross_margin: maskedNum(r.gross_margin),
    can_see_internal: Boolean(r.can_see_internal),
  }));

  const mappedLines: LineReportRow[] = lineRows.map((r) => ({
    id: str(r.id),
    invoice_id: str(r.invoice_id),
    invoice_number: str(r.invoice_number),
    status: str(r.status),
    issue_date: strOrNull(r.issue_date),
    client_id: strOrNull(r.client_id),
    company_name: strOrNull(r.company_name),
    sales_rep_id: strOrNull(r.sales_rep_id),
    sales_rep_name: strOrNull(r.sales_rep_name),
    currency: str(r.currency) || "USD",
    product_id: strOrNull(r.product_id),
    sku: str(r.sku),
    product_name: str(r.product_name),
    manufacturer_name: strOrNull(r.manufacturer_name),
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    line_revenue: num(r.line_revenue),
    line_true_cost: maskedNum(r.line_true_cost),
    line_gross_profit: maskedNum(r.line_gross_profit),
    can_see_internal: Boolean(r.can_see_internal),
  }));

  const mappedQuotes: QuoteReportRow[] = quoteRows.map((r) => ({
    id: str(r.id),
    quote_number: str(r.quote_number),
    status: str(r.status),
    is_expired: Boolean(r.is_expired),
    client_id: strOrNull(r.client_id),
    company_name: strOrNull(r.company_name),
    sales_rep_id: strOrNull(r.sales_rep_id),
    sales_rep_name: strOrNull(r.sales_rep_name),
    currency: str(r.currency) || "USD",
    total: num(r.total),
    quote_date: strOrNull(r.quote_date),
    expiration_date: strOrNull(r.expiration_date),
    sent_at: strOrNull(r.sent_at),
    accepted_at: strOrNull(r.accepted_at),
    converted_at: strOrNull(r.converted_at),
    converted_order_id: strOrNull(r.converted_order_id),
  }));

  const mappedReceivables: ReceivableReportRow[] = arRows.map((r) => ({
    id: str(r.id),
    invoice_number: str(r.invoice_number),
    client_id: strOrNull(r.client_id),
    company_name: strOrNull(r.company_name),
    sales_rep_id: strOrNull(r.sales_rep_id),
    sales_rep_name: strOrNull(r.sales_rep_name),
    currency: str(r.currency) || "USD",
    status: str(r.status),
    issue_date: strOrNull(r.issue_date),
    due_date: strOrNull(r.due_date),
    total: num(r.total),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    days_overdue: num(r.days_overdue),
    aging_bucket: str(r.aging_bucket),
  }));

  const mappedCommissions: CommissionReportRow[] = commRows.map((r) => ({
    id: str(r.id),
    invoice_number: str(r.invoice_number),
    invoice_status: str(r.invoice_status),
    client_id: strOrNull(r.client_id),
    company_name: strOrNull(r.company_name),
    recipient_id: strOrNull(r.recipient_id),
    recipient_name: strOrNull(r.recipient_name),
    commission_type: str(r.commission_type),
    amount: num(r.amount),
    status: str(r.status),
    paid_at: strOrNull(r.paid_at),
    created_at: str(r.created_at),
  }));

  const mappedActivity: ActivityReportRow[] = actRows.map((r) => ({
    id: str(r.id),
    action: str(r.action),
    summary: strOrNull(r.summary),
    entity_type: str(r.entity_type),
    entity_id: strOrNull(r.entity_id),
    created_at: str(r.created_at),
    actor_id: strOrNull(r.actor_id),
    actor_name: strOrNull(r.actor_name),
  }));

  const mappedPos: OpenPoRow[] = poRows.map((r) => ({
    id: str(r.id),
    po_number: str(r.po_number),
    manufacturer_id: str(r.manufacturer_id),
    manufacturer_name: str(r.manufacturer_name),
    status: str(r.status),
    currency: str(r.currency) || "USD",
    total: num(r.total),
    amount_paid: num(r.amount_paid),
    balance_due: num(r.balance_due),
    expected_date: strOrNull(r.expected_date),
    next_expected_arrival: strOrNull(r.next_expected_arrival),
  }));

  // Manufacturer spend: committed = sum(total) of non-void POs by manufacturer;
  // paid = sum(signed_amount) from the payments ledger (refund_credit already
  // negated in the view). Both aggregated here, never cross-currency summed
  // beyond the app's single reporting currency assumption.
  const spendByMfr = new Map<string, ManufacturerSpendRow>();
  for (const po of mappedPos) {
    if (po.status === "void") continue;
    const row =
      spendByMfr.get(po.manufacturer_id) ??
      { manufacturer_id: po.manufacturer_id, manufacturer_name: po.manufacturer_name, po_count: 0, committed: 0, paid: 0, balance: 0 };
    row.po_count += 1;
    row.committed += po.total;
    spendByMfr.set(po.manufacturer_id, row);
  }
  for (const p of mfrPayRows) {
    const id = str(p.manufacturer_id);
    if (!id) continue;
    const row =
      spendByMfr.get(id) ??
      { manufacturer_id: id, manufacturer_name: str(p.manufacturer_name), po_count: 0, committed: 0, paid: 0, balance: 0 };
    row.paid += num(p.signed_amount);
    if (!row.manufacturer_name) row.manufacturer_name = str(p.manufacturer_name);
    spendByMfr.set(id, row);
  }
  const manufacturerSpend = [...spendByMfr.values()]
    .map((r) => ({ ...r, committed: Math.round(r.committed * 100) / 100, paid: Math.round(r.paid * 100) / 100, balance: Math.round((r.committed - r.paid) * 100) / 100 }))
    .sort((a, b) => b.committed - a.committed);

  return {
    canSeeInternal,
    currency: mappedOrders[0]?.currency ?? "USD",
    orders: mappedOrders,
    lines: mappedLines,
    quotes: mappedQuotes,
    receivables: mappedReceivables,
    commissions: mappedCommissions,
    manufacturerSpend,
    openPos: mappedPos,
    activity: mappedActivity,
    capped,
  };
}
