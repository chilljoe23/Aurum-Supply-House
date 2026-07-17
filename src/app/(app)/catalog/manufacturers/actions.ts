"use server";

import { revalidatePath } from "next/cache";
// New manufacturer-cost relations/RPCs are not yet in the generated database
// types, so every call here uses the untyped client (same approach as M5).
import { createUntypedClient as createClient } from "@/lib/supabase/untyped";
import { getCurrentUser } from "@/lib/auth";
import {
  manufacturerCostSchema,
  manufacturerProductSchema,
  promoteCostSchema,
} from "@/lib/manufacturer-costs/schemas";
import type { ExistingRelationship, ExistingCostTier } from "@/lib/manufacturer-costs/classify";
import { toCsv } from "@/lib/catalog/csv";

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
  return u;
}

// ---- Supply relationships (non-cost terms) ---------------------------------

export async function upsertManufacturerProduct(raw: unknown): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const parsed = manufacturerProductSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const m = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_manufacturer_product", {
    p_manufacturer: m.manufacturer_id, p_product: m.product_id,
    p_manufacturer_sku: m.manufacturer_sku ?? null, p_description: m.manufacturer_description ?? null,
    p_currency: m.currency, p_moq: m.moq ?? null, p_order_multiple: m.order_multiple ?? null,
    p_lead_time: m.lead_time_days ?? null, p_active: m.active, p_notes: m.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/catalog/manufacturers/${m.manufacturer_id}`);
  return { ok: true, data: { id: data as string } };
}

export async function setManufacturerProductActive(relationshipId: string, manufacturerId: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("manufacturer_products").update({ active }).eq("id", relationshipId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/catalog/manufacturers/${manufacturerId}`);
  return { ok: true };
}

// ---- Cost bands (append-only via RPC) --------------------------------------

export async function setManufacturerCost(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = manufacturerCostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const c = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_manufacturer_cost", {
    p_relationship: c.manufacturer_product_id, p_min_qty: c.min_quantity, p_max_qty: c.max_quantity ?? null,
    p_cost: c.unit_cost, p_currency: c.currency, p_effective: c.effective_date ?? null,
    p_expiration: c.expiration_date ?? null, p_active: c.active, p_reason: c.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog/manufacturers");
  return { ok: true };
}

// Close an open cost band (no replacement) — deactivates a tier while preserving history.
export async function endManufacturerCostBand(bandId: string, manufacturerId: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("manufacturer_cost_history").update({ effective_to: today }).eq("id", bandId).is("effective_to", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/catalog/manufacturers/${manufacturerId}`);
  return { ok: true };
}

// ---- True-cost promotion (the ONLY bridge to catalog current_true_cost) -----

export async function promoteManufacturerCost(raw: unknown): Promise<Result<{ true_cost: number }>> {
  await requireAdmin();
  const parsed = promoteCostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("promote_manufacturer_cost", {
    p_manufacturer: p.manufacturer_id, p_product: p.product_id, p_reason: p.reason,
    p_effective: p.effective_date ?? null, p_set_preferred: p.set_preferred,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { true_cost: number };
  revalidatePath(`/catalog/manufacturers/${p.manufacturer_id}`);
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${p.product_id}`);
  return { ok: true, data: { true_cost: res.true_cost } };
}

// ---- Resolver (admin-only; M6's PO builder consumes the same RPC) -----------

export async function resolveManufacturerCost(input: {
  manufacturerId: string; productId: string; quantity: number; currency?: string; effective?: string | null;
}): Promise<Result<Record<string, unknown>>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_manufacturer_cost", {
    p_manufacturer: input.manufacturerId, p_product: input.productId, p_quantity: input.quantity,
    p_currency: input.currency ?? "USD", p_effective: input.effective ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Record<string, unknown> };
}

// ---- Import pipeline --------------------------------------------------------

// Existing relationships + open cost tiers for a manufacturer, for import classification.
export async function getManufacturerCostKeys(manufacturerId: string): Promise<{ relationships: ExistingRelationship[]; tiers: ExistingCostTier[] }> {
  await requireAdmin();
  const supabase = await createClient();
  const { data: rels } = await supabase
    .from("manufacturer_product_costs")
    .select("sku, manufacturer_sku, manufacturer_description, moq, order_multiple, lead_time_days")
    .eq("manufacturer_id", manufacturerId);
  const { data: bands } = await supabase
    .from("manufacturer_cost_bands")
    .select("sku, min_quantity, unit_cost")
    .eq("manufacturer_id", manufacturerId);
  return {
    relationships: (rels ?? []) as ExistingRelationship[],
    tiers: (bands ?? []) as ExistingCostTier[],
  };
}

export async function createManufacturerCostBatch(input: {
  manufacturerId: string; filename: string; storage_path: string; file_type: string; worksheet: string;
}): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manufacturer_cost_import_batches")
    .insert({
      manufacturer_id: input.manufacturerId, filename: input.filename, storage_path: input.storage_path,
      file_type: input.file_type, worksheet: input.worksheet, status: "previewed",
    })
    .select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

type MfrRow = {
  row_number: number; sku: string | null; unit_cost: number | null; currency?: string;
  min_quantity?: number; max_quantity?: number | null; manufacturer_sku?: string | null;
  manufacturer_description?: string | null; moq?: number | null; order_multiple?: number | null;
  lead_time_days?: number | null; effective_date?: string | null; expiration_date?: string | null;
  active?: boolean; notes?: string | null; valid: boolean; classification: string; errors?: string[];
};

export async function commitManufacturerCostImport(input: {
  batchId: string; manufacturerId: string; mode: "atomic" | "valid_only"; rows: MfrRow[];
}): Promise<Result<{ summary: Record<string, number> }>> {
  await requireAdmin();
  const supabase = await createClient();
  const rpcRows = input.rows.map((r) => ({
    row_number: r.row_number, sku: r.sku, unit_cost: r.unit_cost, currency: r.currency ?? "USD",
    min_quantity: r.min_quantity ?? 1, max_quantity: r.max_quantity ?? null,
    manufacturer_sku: r.manufacturer_sku ?? null, manufacturer_description: r.manufacturer_description ?? null,
    moq: r.moq ?? null, order_multiple: r.order_multiple ?? null, lead_time_days: r.lead_time_days ?? null,
    effective_date: r.effective_date ?? null, expiration_date: r.expiration_date ?? null,
    active: r.active ?? true, notes: r.notes ?? null,
    valid: r.valid, classification: r.classification, errors: r.errors ?? [],
  }));
  const { data, error } = await supabase.rpc("import_manufacturer_costs", {
    p_batch: input.batchId, p_manufacturer: input.manufacturerId, p_rows: rpcRows, p_mode: input.mode,
  });
  if (error) {
    await supabase.from("manufacturer_cost_import_batches").update({ status: "failed", error: error.message }).eq("id", input.batchId);
    return { ok: false, error: error.message };
  }
  const skipped = input.rows.filter((r) => !r.valid || (r.errors && r.errors.length));
  if (skipped.length) {
    const csv = toCsv(
      [{ key: "row_number", label: "Row" }, { key: "sku", label: "SKU" }, { key: "classification", label: "Classification" }, { key: "errors", label: "Errors" }],
      skipped.map((r) => ({ row_number: r.row_number, sku: r.sku ?? "", classification: r.classification, errors: (r.errors ?? []).join("; ") })),
    );
    const path = `mfr-costs/${input.batchId}-errors.csv`;
    await supabase.storage.from("imports").upload(path, new Blob([csv], { type: "text/csv" }), { upsert: true });
    await supabase.from("manufacturer_cost_import_batches").update({ error_report_path: path }).eq("id", input.batchId);
  }
  revalidatePath(`/catalog/manufacturers/${input.manufacturerId}`);
  return { ok: true, data: { summary: data as Record<string, number> } };
}

export async function getManufacturerCostSignedDownload(path: string): Promise<Result<{ url: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("imports").createSignedUrl(path, 120);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: data.signedUrl } };
}
