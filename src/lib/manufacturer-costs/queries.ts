import "server-only";
import { createUntypedClient } from "@/lib/supabase/untyped";

// All manufacturer-cost relations are new (not yet in generated database.types).
// They are admin-only via RLS, so a non-admin caller gets zero rows on every
// read below. Reads go through the untyped client until types are regenerated.

export type ManufacturerDetail = {
  id: string;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  payment_terms: string | null;
  default_currency: string;
  default_lead_time_days: number | null;
  notes: string | null;
  status: "active" | "discontinued";
};

export async function getManufacturerDetail(id: string): Promise<ManufacturerDetail | null> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturers")
    .select("id, name, legal_name, contact_name, email, phone, payment_terms, default_currency, default_lead_time_days, notes, status")
    .eq("id", id)
    .maybeSingle();
  return (data as ManufacturerDetail) ?? null;
}

export type ManufacturerProductCost = {
  manufacturer_product_id: string;
  manufacturer_id: string;
  manufacturer_name: string;
  product_id: string;
  sku: string;
  product_name: string;
  product_status: "active" | "discontinued";
  manufacturer_sku: string | null;
  manufacturer_description: string | null;
  current_unit_cost: number | null;
  base_unit_cost: number | null;
  currency: string;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
  active: boolean;
  is_preferred: boolean;
  cost_effective_date: string | null;
  cost_expiration_date: string | null;
  active_band_count: number;
  last_cost_update: string | null;
  notes: string | null;
};

export async function getManufacturerProductCosts(manufacturerId: string): Promise<ManufacturerProductCost[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_product_costs")
    .select("*")
    .eq("manufacturer_id", manufacturerId)
    .order("sku", { ascending: true });
  return (data ?? []) as ManufacturerProductCost[];
}

export type ManufacturerCostBand = {
  id: string;
  manufacturer_product_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_cost: number;
  currency: string;
  effective_date: string;
  expiration_date: string | null;
  previous_cost: number | null;
  source: string;
  reason: string | null;
  created_at: string;
};

// Current (open) quantity-cost tiers across a manufacturer's relationships.
export async function getManufacturerCostBands(manufacturerId: string): Promise<ManufacturerCostBand[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_cost_bands")
    .select("*")
    .eq("manufacturer_id", manufacturerId)
    .order("sku", { ascending: true })
    .order("min_quantity", { ascending: true });
  return (data ?? []) as ManufacturerCostBand[];
}

export type ManufacturerCostHistoryRow = {
  id: string;
  manufacturer_product_id: string;
  sku: string;
  product_name: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_cost: number;
  previous_cost: number | null;
  currency: string;
  effective_date: string;
  effective_to: string | null;
  expiration_date: string | null;
  source: string;
  reason: string | null;
  created_at: string;
};

// Full effective-dated cost ledger (open + closed) for a manufacturer.
export async function getManufacturerCostHistory(manufacturerId: string, limit = 500): Promise<ManufacturerCostHistoryRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_cost_history")
    .select("id, manufacturer_product_id, min_quantity, max_quantity, unit_cost, previous_cost, currency, effective_date, effective_to, expiration_date, source, reason, created_at, manufacturer_products!inner(manufacturer_id, products(sku, name))")
    .eq("manufacturer_products.manufacturer_id", manufacturerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const mp = (r.manufacturer_products ?? {}) as { products?: { sku?: string; name?: string } };
    return {
      id: r.id,
      manufacturer_product_id: r.manufacturer_product_id,
      sku: mp.products?.sku ?? "—",
      product_name: mp.products?.name ?? "—",
      min_quantity: r.min_quantity,
      max_quantity: r.max_quantity,
      unit_cost: r.unit_cost,
      previous_cost: r.previous_cost,
      currency: r.currency,
      effective_date: r.effective_date,
      effective_to: r.effective_to,
      expiration_date: r.expiration_date,
      source: r.source,
      reason: r.reason,
      created_at: r.created_at,
    } as ManufacturerCostHistoryRow;
  });
}

export type ManufacturerImportBatch = {
  id: string;
  manufacturer_id: string;
  filename: string;
  file_type: string | null;
  worksheet: string | null;
  status: string;
  mode: string | null;
  row_count: number;
  relationships_created: number;
  costs_created: number;
  costs_updated: number;
  tiers_changed: number;
  rows_skipped: number;
  storage_path: string;
  error_report_path: string | null;
  created_at: string;
  committed_at: string | null;
};

export async function getManufacturerImportBatches(manufacturerId: string): Promise<ManufacturerImportBatch[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_cost_import_batches")
    .select("*")
    .eq("manufacturer_id", manufacturerId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as ManufacturerImportBatch[];
}

export async function getManufacturerImportRows(batchId: string) {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_cost_import_rows")
    .select("row_number, sku, classification, status, messages")
    .eq("batch_id", batchId)
    .order("row_number", { ascending: true });
  return data ?? [];
}

// Per-manufacturer roll-up for the manufacturers list page.
export type ManufacturerCostStat = { manufacturer_id: string; products_supplied: number; last_cost_update: string | null };

export async function getManufacturerCostStats(): Promise<Map<string, ManufacturerCostStat>> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_product_costs")
    .select("manufacturer_id, last_cost_update");
  const stats = new Map<string, ManufacturerCostStat>();
  for (const r of (data ?? []) as { manufacturer_id: string; last_cost_update: string | null }[]) {
    const cur = stats.get(r.manufacturer_id) ?? { manufacturer_id: r.manufacturer_id, products_supplied: 0, last_cost_update: null };
    cur.products_supplied += 1;
    if (r.last_cost_update && (!cur.last_cost_update || r.last_cost_update > cur.last_cost_update)) {
      cur.last_cost_update = r.last_cost_update;
    }
    stats.set(r.manufacturer_id, cur);
  }
  return stats;
}
