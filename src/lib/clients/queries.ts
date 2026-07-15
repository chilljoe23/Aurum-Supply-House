import "server-only";
import { createClient } from "@/lib/supabase/server";

// ---- Types ------------------------------------------------------------------

export type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type ClientDetail = {
  id: string;
  company_name: string;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "prospect";
  payment_terms: string;
  notes: string | null;
  assigned_rep_id: string | null;
  assigned_rep_name: string | null;
  default_pricing_sheet_id: string | null;
  pricing_model_name: string | null;
  billing_address: Address;
  shipping_address: Address;
  created_at: string;
  updated_at: string;
};

export type RepOption = { id: string; full_name: string; email: string; role: string };

function sheetName(v: unknown): string | null {
  const ps = (v as { pricing_sheets?: { name: string } | { name: string }[] | null } | null)?.pricing_sheets;
  if (!ps) return null;
  return Array.isArray(ps) ? ps[0]?.name ?? null : ps.name;
}

// ---- Active representatives (for the assignment picker) ---------------------
// Any active staff member may hold a book; sales reps listed first. RLS lets all
// staff read the profiles roster (profiles_select).
export async function getActiveReps(): Promise<RepOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,email,role")
    .eq("status", "active")
    .in("role", ["sales_rep", "admin", "owner"])
    .order("full_name");
  const rows = (data ?? []) as RepOption[];
  const rank = (r: string) => (r === "sales_rep" ? 0 : r === "admin" ? 1 : 2);
  return rows.sort((a, b) => rank(a.role) - rank(b.role) || a.full_name.localeCompare(b.full_name));
}

// ---- List -------------------------------------------------------------------
// RLS scopes rows automatically (admin: all; rep: own book). Returns the full
// detail shape so the list can drive in-place editing without a second fetch.
export async function getClientsList(): Promise<ClientDetail[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select(
      "id,company_name,primary_contact_name,email,phone,status,payment_terms,notes,assigned_rep_id,default_pricing_sheet_id,billing_address,shipping_address,created_at,updated_at,pricing_sheets(name)",
    )
    .order("company_name");
  const rows = data ?? [];

  const repIds = Array.from(new Set(rows.map((r) => r.assigned_rep_id).filter(Boolean))) as string[];
  const repNames = await repNameMap(repIds);

  return rows.map((r) => ({
    id: r.id,
    company_name: r.company_name,
    primary_contact_name: r.primary_contact_name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    payment_terms: r.payment_terms,
    notes: r.notes,
    assigned_rep_id: r.assigned_rep_id,
    assigned_rep_name: r.assigned_rep_id ? repNames.get(r.assigned_rep_id) ?? null : null,
    default_pricing_sheet_id: r.default_pricing_sheet_id,
    pricing_model_name: sheetName(r),
    billing_address: (r.billing_address ?? {}) as Address,
    shipping_address: (r.shipping_address ?? {}) as Address,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

// ---- Detail -----------------------------------------------------------------
export async function getClientDetail(id: string): Promise<ClientDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select(
      "id,company_name,primary_contact_name,email,phone,status,payment_terms,notes,assigned_rep_id,default_pricing_sheet_id,billing_address,shipping_address,created_at,updated_at,pricing_sheets(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const repNames = await repNameMap(data.assigned_rep_id ? [data.assigned_rep_id] : []);
  return {
    id: data.id,
    company_name: data.company_name,
    primary_contact_name: data.primary_contact_name,
    email: data.email,
    phone: data.phone,
    status: data.status,
    payment_terms: data.payment_terms,
    notes: data.notes,
    assigned_rep_id: data.assigned_rep_id,
    assigned_rep_name: data.assigned_rep_id ? repNames.get(data.assigned_rep_id) ?? null : null,
    default_pricing_sheet_id: data.default_pricing_sheet_id,
    pricing_model_name: sheetName(data),
    billing_address: (data.billing_address ?? {}) as Address,
    shipping_address: (data.shipping_address ?? {}) as Address,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

async function repNameMap(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id,full_name").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

// ---- Derived panels ---------------------------------------------------------
// All read existing tables/views only. RLS keeps them scoped to what the caller
// may see. Everything is empty until M4 produces invoices — panels render honest
// empty states rather than fabricating data.

export type ClientInvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  balance_due: number;
  issue_date: string | null;
  created_at: string;
};

export async function getClientInvoices(clientId: string): Promise<ClientInvoiceRow[]> {
  const supabase = await createClient();
  // Read through v_orders so reps (who no longer have base-table access after
  // M4 migration 0210) still see their own clients' invoices — masked, scoped.
  const { data } = await supabase
    .from("v_orders")
    .select("id,invoice_number,status,total,balance_due,issue_date,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as ClientInvoiceRow[];
}

export type PurchaseSummary = {
  order_count: number;
  lifetime_total: number;
  outstanding_balance: number;
  last_order_date: string | null;
};

export async function getClientPurchaseSummary(clientId: string): Promise<PurchaseSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_orders")
    .select("total,balance_due,issue_date,created_at,status")
    .eq("client_id", clientId)
    .neq("status", "void");
  const rows = data ?? [];
  const billed = rows.filter((r) => r.status !== "draft");
  const lifetime = billed.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const outstanding = billed.reduce((s, r) => s + Number(r.balance_due ?? 0), 0);
  const last = billed
    .map((r) => r.issue_date ?? r.created_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return {
    order_count: billed.length,
    lifetime_total: lifetime,
    outstanding_balance: outstanding,
    last_order_date: last,
  };
}

export type ClientProfit = {
  revenue: number;
  gross_profit: number;
  net_profit: number;
  invoices: number;
};

// Sensitive (cost-derived) — callers gate this to admins, mirroring M2 cost masking.
export async function getClientProfit(clientId: string): Promise<ClientProfit> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_profit_by_client")
    .select("revenue,gross_profit,net_profit,invoices")
    .eq("client_id", clientId)
    .maybeSingle();
  return {
    revenue: Number(data?.revenue ?? 0),
    gross_profit: Number(data?.gross_profit ?? 0),
    net_profit: Number(data?.net_profit ?? 0),
    invoices: Number(data?.invoices ?? 0),
  };
}

export type ClientCommissionSummary = { total: number; paid: number; owed: number };

export async function getClientCommissions(clientId: string): Promise<ClientCommissionSummary> {
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id").eq("client_id", clientId);
  const ids = (inv ?? []).map((r) => r.id);
  if (ids.length === 0) return { total: 0, paid: 0, owed: 0 };
  const { data } = await supabase
    .from("commissions")
    .select("amount,status")
    .in("invoice_id", ids);
  const rows = data ?? [];
  const total = rows.filter((r) => r.status !== "void").reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const paid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const owed = rows
    .filter((r) => r.status === "pending" || r.status === "approved")
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return { total, paid, owed };
}

export type ClientProductRow = { sku: string; product_name: string; units: number; revenue: number };

export async function getClientProducts(clientId: string): Promise<ClientProductRow[]> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("v_orders")
    .select("id")
    .eq("client_id", clientId)
    .neq("status", "void")
    .neq("status", "draft");
  const ids = (inv ?? []).map((r) => r.id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("v_order_items")
    .select("sku,product_name,quantity,line_subtotal")
    .in("invoice_id", ids);
  const agg = new Map<string, ClientProductRow>();
  for (const r of data ?? []) {
    const key = r.sku ?? "—";
    const cur = agg.get(key) ?? { sku: key, product_name: r.product_name ?? "—", units: 0, revenue: 0 };
    cur.units += Number(r.quantity ?? 0);
    cur.revenue += Number(r.line_subtotal ?? 0);
    agg.set(key, cur);
  }
  return Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue);
}

export type TimelineRow = {
  id: string;
  action: string;
  summary: string | null;
  created_at: string;
  actor_name: string | null;
};

export async function getClientTimeline(clientId: string): Promise<TimelineRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("id,action,summary,created_at,actor_id")
    .eq("entity_type", "client")
    .eq("entity_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = data ?? [];
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  const actors = await repNameMap(actorIds);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    created_at: r.created_at,
    actor_name: r.actor_id ? actors.get(r.actor_id) ?? null : null,
  }));
}
