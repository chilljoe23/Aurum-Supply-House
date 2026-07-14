import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PricingModel = {
  id: string; name: string; code: string | null; description: string | null;
  currency: string; effective_date: string; expiration_date: string | null;
  status: "active" | "archived"; is_default: boolean; notes: string | null;
  created_at: string; updated_at: string;
  products_priced?: number; clients_assigned?: number;
};

export async function getPricingModels(): Promise<PricingModel[]> {
  const supabase = await createClient();
  const { data: sheets } = await supabase
    .from("pricing_sheets")
    .select("id,name,code,description,currency,effective_date,expiration_date,status,is_default,notes,created_at,updated_at")
    .order("name");
  const models = (sheets ?? []) as PricingModel[];

  // Counts (best-effort; reps may see fewer rows under RLS).
  const { data: items } = await supabase
    .from("pricing_sheet_items")
    .select("pricing_sheet_id,product_id")
    .is("effective_to", null)
    .eq("active", true);
  const { data: clients } = await supabase
    .from("clients")
    .select("default_pricing_sheet_id");

  const priced = new Map<string, Set<string>>();
  for (const it of items ?? []) {
    const s = priced.get(it.pricing_sheet_id) ?? new Set<string>();
    s.add(it.product_id!); priced.set(it.pricing_sheet_id, s);
  }
  const assigned = new Map<string, number>();
  for (const c of clients ?? []) {
    if (!c.default_pricing_sheet_id) continue;
    assigned.set(c.default_pricing_sheet_id, (assigned.get(c.default_pricing_sheet_id) ?? 0) + 1);
  }
  return models.map((m) => ({
    ...m,
    products_priced: priced.get(m.id)?.size ?? 0,
    clients_assigned: assigned.get(m.id) ?? 0,
  }));
}

export async function getPricingModel(id: string): Promise<PricingModel | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("pricing_sheets").select("*").eq("id", id).maybeSingle();
  return (data as PricingModel) ?? null;
}

export type ModelBand = {
  item_id: string; product_id: string; sku: string; name: string;
  strength: string | null; pack_size: string | null;
  selling_price: number; currency: string; min_quantity: number; max_quantity: number | null;
  effective_date: string; updated_at: string;
  true_cost?: number | null; margin_amount?: number | null; margin_pct?: number | null; below_cost?: boolean;
};

// Admins get margin+cost via the security-invoker margin view; reps get price-only
// via pricing_sheet_items joined to the cost-masked catalog_products view.
export async function getModelBands(id: string, canSeeCost: boolean): Promise<ModelBand[]> {
  const supabase = await createClient();
  if (canSeeCost) {
    const { data } = await supabase
      .from("pricing_item_margins")
      .select("*")
      .eq("pricing_sheet_id", id)
      .order("sku");
    return (data ?? []) as ModelBand[];
  }
  const { data } = await supabase
    .from("pricing_sheet_items")
    .select("id,product_id,selling_price,currency,min_quantity,max_quantity,effective_date,updated_at")
    .eq("pricing_sheet_id", id).is("effective_to", null).eq("active", true);
  const rows = data ?? [];
  const ids = rows.map((r) => r.product_id!).filter(Boolean);
  const { data: prods } = await supabase
    .from("catalog_products").select("id,sku,name,strength,pack_size").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const byId = new Map((prods ?? []).map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.product_id!);
    return {
      item_id: r.id, product_id: r.product_id!, sku: p?.sku ?? "—", name: p?.name ?? "—",
      strength: p?.strength ?? null, pack_size: p?.pack_size ?? null,
      selling_price: r.selling_price, currency: r.currency, min_quantity: r.min_quantity,
      max_quantity: r.max_quantity, effective_date: r.effective_date, updated_at: r.updated_at,
    } as ModelBand;
  }).sort((a, b) => a.sku.localeCompare(b.sku) || a.min_quantity - b.min_quantity);
}

export async function getModelClients(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id,company_name,status").eq("default_pricing_sheet_id", id).order("company_name");
  return data ?? [];
}

export async function getUnpricedProducts(sheetId: string, pricedProductIds: string[]) {
  const supabase = await createClient();
  const { data } = await supabase.from("catalog_products").select("id,sku,name").eq("status", "active");
  const priced = new Set(pricedProductIds);
  return (data ?? []).filter((p) => !priced.has(p.id!));
}

export async function getPricingImportBatches() {
  const supabase = await createClient();
  const { data } = await supabase.from("pricing_import_batches").select("*").order("created_at", { ascending: false }).limit(200);
  return data ?? [];
}

// ---- Clients (pricing-focused surface for M2) ------------------------------
export async function getClientsWithPricing() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id,company_name,status,payment_terms,assigned_rep_id,default_pricing_sheet_id,pricing_sheets(name)")
    .order("company_name");
  return data ?? [];
}

export async function getClient(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id,company_name,primary_contact_name,email,phone,status,payment_terms,default_pricing_sheet_id,pricing_sheets(name)")
    .eq("id", id).maybeSingle();
  return data;
}

export async function getClientOverrides(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_price_overrides")
    .select("id,product_id,selling_price,currency,min_quantity,max_quantity,effective_date,effective_to,active,reason")
    .eq("client_id", clientId).is("effective_to", null).eq("active", true);
  const rows = data ?? [];
  const ids = rows.map((r) => r.product_id).filter(Boolean) as string[];
  const { data: prods } = await supabase.from("catalog_products").select("id,sku,name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const byId = new Map((prods ?? []).map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, sku: byId.get(r.product_id!)?.sku ?? "—", name: byId.get(r.product_id!)?.name ?? "—" }));
}

export async function getClientAssignments(clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_pricing_assignments")
    .select("id,pricing_sheet_id,effective_date,expiration_date,active,notes,created_at,pricing_sheets(name)")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}
