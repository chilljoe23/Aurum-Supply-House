import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUntypedClient } from "@/lib/supabase/untyped";
import {
  buildQuoteViewModel,
  type QuoteViewModel,
  type QuoteHeaderInput,
} from "@/lib/quotes/quote-view-model";

// The quote tables/views/RPCs are not yet in the committed database.types.ts
// (they land only after `npm run gen:types` is re-run against a migrated DB), so
// every quote read goes through the loosely-typed client — identical runtime
// behavior, relaxed compile-time relation typing. All reads flow through the
// row-scoped v_quotes / v_quote_items views, so reps are DB-scoped, not just
// hidden in the UI. Quotes carry no cost columns, so there is nothing to mask.

// Re-export the shared order-builder inputs (clients / active catalog / models):
// a quote is built from the exact same catalog and pricing surface as an order.
export { getBuilderData, type BuilderData, type BuilderClient, type BuilderProduct, type BuilderModel } from "@/lib/orders/queries";

export type QuoteListRow = {
  id: string;
  quote_number: string;
  status: string;
  is_expired: boolean;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  pricing_sheet_id: string | null;
  pricing_sheet_name: string | null;
  currency: string;
  total: number;
  quote_date: string | null;
  expiration_date: string | null;
  converted_order_id: string | null;
  converted_order_number: string | null;
  created_at: string;
  updated_at: string;
};

export async function getQuotesList(): Promise<QuoteListRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_quotes")
    .select(
      "id,quote_number,status,is_expired,client_id,company_name,sales_rep_id,sales_rep_name,pricing_sheet_id,pricing_sheet_name,currency,total,quote_date,expiration_date,converted_order_id,converted_order_number,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    quote_number: r.quote_number as string,
    status: r.status as string,
    is_expired: !!r.is_expired,
    client_id: (r.client_id as string | null) ?? null,
    company_name: (r.company_name as string | null) ?? null,
    sales_rep_id: (r.sales_rep_id as string | null) ?? null,
    sales_rep_name: (r.sales_rep_name as string | null) ?? null,
    pricing_sheet_id: (r.pricing_sheet_id as string | null) ?? null,
    pricing_sheet_name: (r.pricing_sheet_name as string | null) ?? null,
    currency: (r.currency as string) ?? "USD",
    total: Number(r.total ?? 0),
    quote_date: (r.quote_date as string | null) ?? null,
    expiration_date: (r.expiration_date as string | null) ?? null,
    converted_order_id: (r.converted_order_id as string | null) ?? null,
    converted_order_number: (r.converted_order_number as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));
}

// ---- Detail -----------------------------------------------------------------

export type QuoteHeader = QuoteListRow & {
  client_snapshot: Record<string, unknown> | null;
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  tax_rate: number;
  tax_amount: number;
  payment_terms: string;
  customer_reference: string | null;
  notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  voided_at: string | null;
  converted_at: string | null;
};

export type QuoteItem = {
  id: string;
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  price_source: string | null;
  price_source_sheet: string | null;
  price_overridden: boolean;
  original_unit_price: number | null;
  manual_reason: string | null;
};

export type QuoteStatusEvent = { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string };
export type QuoteActivity = { id: string; action: string; summary: string | null; created_at: string; actor_name: string | null };

export type QuoteDetail = {
  header: QuoteHeader;
  items: QuoteItem[];
  statusHistory: QuoteStatusEvent[];
  activity: QuoteActivity[];
};

export async function getQuoteDetail(id: string): Promise<QuoteDetail | null> {
  const supabase = await createUntypedClient();
  const { data: header } = await supabase.from("v_quotes").select("*").eq("id", id).maybeSingle();
  if (!header) return null;

  const [{ data: items }, { data: history }, { data: activity }] = await Promise.all([
    supabase.from("v_quote_items").select("*").eq("quote_id", id).order("created_at"),
    supabase.from("quote_status_history").select("id,from_status,to_status,note,created_at").eq("quote_id", id).order("created_at"),
    supabase.from("activity_log").select("id,action,summary,created_at,actor_id").eq("entity_type", "quote").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  const acts = (activity ?? []) as Record<string, unknown>[];
  const actorIds = Array.from(new Set(acts.map((a) => a.actor_id).filter(Boolean))) as string[];
  const actorNames = await nameMap(supabase, actorIds);

  const h = header as Record<string, unknown>;
  return {
    header: shapeHeader(h),
    items: ((items ?? []) as Record<string, unknown>[]).map(shapeItem),
    statusHistory: (history ?? []) as unknown as QuoteStatusEvent[],
    activity: acts.map((a) => ({
      id: a.id as string,
      action: a.action as string,
      summary: (a.summary as string | null) ?? null,
      created_at: a.created_at as string,
      actor_name: a.actor_id ? actorNames.get(a.actor_id as string) ?? null : null,
    })),
  };
}

function shapeHeader(h: Record<string, unknown>): QuoteHeader {
  return {
    id: h.id as string,
    quote_number: h.quote_number as string,
    status: h.status as string,
    is_expired: !!h.is_expired,
    client_id: (h.client_id as string | null) ?? null,
    company_name: (h.company_name as string | null) ?? null,
    client_snapshot: (h.client_snapshot ?? null) as Record<string, unknown> | null,
    sales_rep_id: (h.sales_rep_id as string | null) ?? null,
    sales_rep_name: (h.sales_rep_name as string | null) ?? null,
    pricing_sheet_id: (h.pricing_sheet_id as string | null) ?? null,
    pricing_sheet_name: (h.pricing_sheet_name as string | null) ?? null,
    currency: (h.currency as string) ?? "USD",
    subtotal: Number(h.subtotal ?? 0),
    discount: Number(h.discount ?? 0),
    shipping: Number(h.shipping ?? 0),
    fees: Number(h.fees ?? 0),
    tax_rate: Number(h.tax_rate ?? 0),
    tax_amount: Number(h.tax_amount ?? 0),
    total: Number(h.total ?? 0),
    payment_terms: (h.payment_terms as string) ?? "net_30",
    customer_reference: (h.customer_reference as string | null) ?? null,
    quote_date: (h.quote_date as string | null) ?? null,
    expiration_date: (h.expiration_date as string | null) ?? null,
    notes: (h.notes as string | null) ?? null,
    sent_at: (h.sent_at as string | null) ?? null,
    accepted_at: (h.accepted_at as string | null) ?? null,
    declined_at: (h.declined_at as string | null) ?? null,
    expired_at: (h.expired_at as string | null) ?? null,
    voided_at: (h.voided_at as string | null) ?? null,
    converted_at: (h.converted_at as string | null) ?? null,
    converted_order_id: (h.converted_order_id as string | null) ?? null,
    converted_order_number: (h.converted_order_number as string | null) ?? null,
    created_at: h.created_at as string,
    updated_at: h.updated_at as string,
  };
}

function shapeItem(it: Record<string, unknown>): QuoteItem {
  return {
    id: it.id as string,
    sku: it.sku as string,
    product_name: it.product_name as string,
    strength: (it.strength as string | null) ?? null,
    pack_size: (it.pack_size as string | null) ?? null,
    description: (it.description as string) ?? "",
    quantity: Number(it.quantity ?? 0),
    unit_price: Number(it.unit_price ?? 0),
    line_subtotal: Number(it.line_subtotal ?? 0),
    price_source: (it.price_source as string | null) ?? null,
    price_source_sheet: (it.price_source_sheet as string | null) ?? null,
    price_overridden: !!it.price_overridden,
    original_unit_price: it.original_unit_price != null ? Number(it.original_unit_price) : null,
    manual_reason: (it.manual_reason as string | null) ?? null,
  };
}

async function nameMap(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id,full_name").in("id", ids);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
}

// ---- Editable (builder) -----------------------------------------------------

export type EditableQuote = {
  id: string;
  status: string;
  client_id: string | null;
  selected_model_id: string | null;
  currency: string;
  shipping: number;
  fees: number;
  discount: number;
  tax_rate: number;
  payment_terms: string;
  customer_reference: string | null;
  quote_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  lines: {
    product_id: string | null;
    quantity: number;
    unit_price: number;
    price_overridden: boolean;
    manual_reason: string | null;
    price_source: string | null;
  }[];
};

export async function getEditableQuote(id: string): Promise<EditableQuote | null> {
  const supabase = await createUntypedClient();
  const { data: header } = await supabase.from("v_quotes").select("*").eq("id", id).maybeSingle();
  if (!header) return null;
  const { data: items } = await supabase
    .from("v_quote_items")
    .select("product_id,quantity,unit_price,price_overridden,manual_reason,price_source")
    .eq("quote_id", id)
    .order("created_at");
  const h = header as Record<string, unknown>;
  return {
    id: h.id as string,
    status: h.status as string,
    client_id: (h.client_id as string | null) ?? null,
    selected_model_id: (h.pricing_sheet_id as string | null) ?? null,
    currency: (h.currency as string) ?? "USD",
    shipping: Number(h.shipping ?? 0),
    fees: Number(h.fees ?? 0),
    discount: Number(h.discount ?? 0),
    tax_rate: Number(h.tax_rate ?? 0),
    payment_terms: (h.payment_terms as string) ?? "net_30",
    customer_reference: (h.customer_reference as string | null) ?? null,
    quote_date: (h.quote_date as string | null) ?? null,
    expiration_date: (h.expiration_date as string | null) ?? null,
    notes: (h.notes as string | null) ?? null,
    lines: ((items ?? []) as Record<string, unknown>[]).map((it) => ({
      product_id: (it.product_id as string | null) ?? null,
      quantity: Number(it.quantity ?? 0),
      unit_price: Number(it.unit_price ?? 0),
      price_overridden: !!it.price_overridden,
      manual_reason: (it.manual_reason as string | null) ?? null,
      price_source: (it.price_source as string | null) ?? null,
    })),
  };
}

// ---- Customer-facing quote view model (preview + PDF share this) ------------

async function getQuoteSettings(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("app_settings")
    .select("company_name,logo_path,address,contact_email,contact_phone,quote_terms,quote_footer")
    .eq("id", true)
    .maybeSingle();
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    company_name: (d.company_name as string) ?? "Aurum Supply House",
    logo_path: (d.logo_path as string | null) ?? null,
    address: (d.address ?? {}) as Record<string, unknown>,
    contact_email: (d.contact_email as string | null) ?? null,
    contact_phone: (d.contact_phone as string | null) ?? null,
    quote_terms: (d.quote_terms as string | null) ?? null,
    quote_footer: (d.quote_footer as string | null) ?? null,
  };
}

export async function getQuoteViewModel(id: string): Promise<QuoteViewModel | null> {
  const supabase = await createUntypedClient();
  const { data: header } = await supabase.from("v_quotes").select("*").eq("id", id).maybeSingle();
  if (!header) return null;

  const [{ data: items }, settings] = await Promise.all([
    supabase
      .from("v_quote_items")
      .select("sku,product_name,strength,pack_size,quantity,unit_price,line_subtotal")
      .eq("quote_id", id)
      .order("created_at"),
    getQuoteSettings(supabase),
  ]);

  const h = header as Record<string, unknown>;
  const headerInput: QuoteHeaderInput = {
    quote_number: h.quote_number as string,
    status: h.status as string,
    is_expired: !!h.is_expired,
    quote_date: (h.quote_date as string | null) ?? null,
    expiration_date: (h.expiration_date as string | null) ?? null,
    currency: (h.currency as string) ?? "USD",
    subtotal: Number(h.subtotal ?? 0),
    discount: Number(h.discount ?? 0),
    shipping: Number(h.shipping ?? 0),
    fees: Number(h.fees ?? 0),
    tax_rate: Number(h.tax_rate ?? 0),
    tax_amount: Number(h.tax_amount ?? 0),
    total: Number(h.total ?? 0),
    payment_terms: (h.payment_terms as string | null) ?? null,
    customer_reference: (h.customer_reference as string | null) ?? null,
    notes: (h.notes as string | null) ?? null,
    client_snapshot: (h.client_snapshot ?? null) as Record<string, unknown> | null,
  };

  return buildQuoteViewModel(
    headerInput,
    ((items ?? []) as Record<string, unknown>[]).map((it) => ({
      sku: it.sku as string,
      product_name: it.product_name as string,
      strength: (it.strength as string | null) ?? null,
      pack_size: (it.pack_size as string | null) ?? null,
      quantity: Number(it.quantity ?? 0),
      unit_price: Number(it.unit_price ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
    })),
    settings,
  );
}
