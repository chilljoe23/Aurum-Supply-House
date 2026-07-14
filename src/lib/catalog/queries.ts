import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  strength: string | null;
  product_form: string | null;
  pack_size: string | null;
  unit_of_measure: string | null;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  manufacturer_sku: string | null;
  category: string | null;
  moq: number | null;
  lead_time_days: number | null;
  currency: string;
  status: "active" | "discontinued";
  notes: string | null;
  created_at: string;
  updated_at: string;
  true_cost: number | null;
  can_see_cost: boolean;
};

// Catalog read surface — the view masks true_cost for non-admins at the DB layer.
export async function getCatalogProducts(): Promise<CatalogProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_products")
    .select("*")
    .order("name", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as CatalogProduct[];
}

export async function getCatalogProduct(id: string): Promise<CatalogProduct | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as CatalogProduct) ?? null;
}

export type CostHistoryRow = {
  id: string;
  true_cost: number;
  previous_cost: number | null;
  currency: string;
  effective_date: string;
  effective_to: string | null;
  source: string;
  reason: string | null;
  created_at: string;
};

// Admin-only (RLS). Returns [] for reps.
export async function getCostHistory(productId: string): Promise<CostHistoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_cost_history")
    .select("id, true_cost, previous_cost, currency, effective_date, effective_to, source, reason, created_at")
    .eq("product_id", productId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as CostHistoryRow[];
}

export type Manufacturer = {
  id: string;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  payment_terms: string | null;
  default_currency: string;
  notes: string | null;
  status: "active" | "discontinued";
};

export async function getManufacturers(): Promise<Manufacturer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("manufacturers")
    .select("id, name, legal_name, contact_name, email, phone, payment_terms, default_currency, notes, status")
    .order("name", { ascending: true });
  return (data ?? []) as Manufacturer[];
}

// Which pricing sheets include this product (M2 will build on this).
export async function getPricingCoverage(productId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pricing_sheet_items")
    .select("pricing_sheet_id, selling_price, pricing_sheets(name, status)")
    .eq("product_id", productId);
  return data ?? [];
}

export type ImportBatch = {
  id: string;
  filename: string;
  file_type: string | null;
  worksheet: string | null;
  status: string;
  mode: string | null;
  row_count: number;
  products_created: number;
  products_updated: number;
  costs_updated: number;
  rows_skipped: number;
  storage_path: string;
  error_report_path: string | null;
  created_at: string;
  committed_at: string | null;
};

export async function getImportBatches(): Promise<ImportBatch[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_import_batches")
    .select("*")
    .eq("kind", "catalog")
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as ImportBatch[];
}

export async function getImportRows(batchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_import_rows")
    .select("row_number, sku, classification, status, messages")
    .eq("batch_id", batchId)
    .order("row_number", { ascending: true });
  return data ?? [];
}

// Import rows that touched a given SKU (product detail → import history).
export async function getImportHistoryForSku(sku: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_import_rows")
    .select("batch_id, classification, status, created_at, catalog_import_batches(filename, created_at)")
    .eq("sku", sku)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}
