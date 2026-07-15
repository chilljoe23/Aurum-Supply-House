"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { callRpc } from "@/lib/supabase/rpc";
import { getCurrentUser } from "@/lib/auth";
import { pricingModelSchema, priceItemSchema, bulkAdjustSchema } from "@/lib/pricing/schemas";
import { toCsv } from "@/lib/catalog/csv";

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
  return u;
}

export async function createPricingModel(raw: unknown): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const parsed = pricingModelSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const m = parsed.data;
  const supabase = await createClient();
  if (m.is_default) {
    await supabase.from("pricing_sheets").update({ is_default: false }).eq("currency", m.currency).eq("is_default", true);
  }
  const { data, error } = await supabase.from("pricing_sheets").insert({
    name: m.name, code: m.code ?? null, description: m.description ?? null, currency: m.currency,
    effective_date: m.effective_date ?? new Date().toISOString().slice(0, 10),
    expiration_date: m.expiration_date ?? null, is_default: m.is_default, notes: m.notes ?? null,
    status: m.active ? "active" : "archived",
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing");
  return { ok: true, data: { id: data.id } };
}

export async function updatePricingModel(id: string, raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = pricingModelSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const m = parsed.data;
  const supabase = await createClient();
  if (m.is_default) {
    await supabase.from("pricing_sheets").update({ is_default: false }).eq("currency", m.currency).eq("is_default", true).neq("id", id);
  }
  const { error } = await supabase.from("pricing_sheets").update({
    name: m.name, code: m.code ?? null, description: m.description ?? null, currency: m.currency,
    effective_date: m.effective_date ?? undefined, expiration_date: m.expiration_date ?? null,
    is_default: m.is_default, notes: m.notes ?? null, status: m.active ? "active" : "archived",
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing"); revalidatePath(`/pricing/${id}`);
  return { ok: true };
}

export async function setModelStatus(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("pricing_sheets").update({ status: active ? "active" : "archived" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing"); revalidatePath(`/pricing/${id}`);
  return { ok: true };
}

export async function duplicateModel(id: string, name: string, code: string): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await callRpc(supabase, "duplicate_pricing_model", { p_sheet: id, p_name: name, p_code: code || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pricing");
  return { ok: true, data: { id: data as string } };
}

export async function setPrice(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = priceItemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await callRpc(supabase, "set_product_price", {
    p_sheet: p.pricing_sheet_id, p_product: p.product_id, p_min_qty: p.min_quantity,
    p_max_qty: p.max_quantity ?? null, p_price: p.selling_price, p_currency: p.currency,
    p_effective: p.effective_date ?? null, p_expiration: p.expiration_date ?? null,
    p_active: p.active, p_notes: p.notes ?? null, p_reason: p.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/pricing/${p.pricing_sheet_id}`);
  return { ok: true };
}

export async function endDatePriceBand(itemId: string, sheetId: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("pricing_sheet_items").update({ effective_to: today }).eq("id", itemId).is("effective_to", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/pricing/${sheetId}`);
  return { ok: true };
}

export async function getBulkPreview(sheetId: string, type: "percent" | "fixed", value: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("pricing_item_margins").select("sku,name,selling_price,min_quantity,max_quantity").eq("pricing_sheet_id", sheetId).order("sku");
  return (data ?? []).map((r) => {
    const np = type === "percent" ? Math.round(r.selling_price! * (1 + value / 100) * 10000) / 10000 : Math.round((r.selling_price! + value) * 10000) / 10000;
    return { ...r, new_price: np, invalid: np <= 0 };
  });
}

export async function bulkAdjust(raw: unknown): Promise<Result<{ adjusted: number; skipped: number }>> {
  await requireAdmin();
  const parsed = bulkAdjustSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const b = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_adjust_prices", {
    p_sheet: b.pricing_sheet_id, p_product_ids: b.product_ids, p_type: b.type, p_value: b.value, p_reason: b.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/pricing/${b.pricing_sheet_id}`);
  return { ok: true, data: data as { adjusted: number; skipped: number } };
}

export async function createPricingImportBatch(input: { filename: string; storage_path: string; file_type: string; worksheet: string; pricing_sheet_id: string }): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("pricing_import_batches").insert({
    filename: input.filename, storage_path: input.storage_path, file_type: input.file_type,
    worksheet: input.worksheet, pricing_sheet_id: input.pricing_sheet_id, status: "previewed",
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

type PRow = { row_number: number; sku: string | null; selling_price: number | null; currency?: string; min_quantity?: number; max_quantity?: number | null; effective_date?: string | null; expiration_date?: string | null; active?: boolean; valid: boolean; classification: string; errors?: string[] };

export async function commitPricingImport(input: { batchId: string; sheetId: string; mode: "atomic" | "valid_only"; rows: PRow[] }): Promise<Result<{ summary: Record<string, number> }>> {
  await requireAdmin();
  const supabase = await createClient();
  const rpcRows = input.rows.map((r) => ({
    row_number: r.row_number, sku: r.sku, selling_price: r.selling_price,
    currency: r.currency ?? "USD", min_quantity: r.min_quantity ?? 1, max_quantity: r.max_quantity ?? null,
    effective_date: r.effective_date ?? null, expiration_date: r.expiration_date ?? null,
    active: r.active ?? true, valid: r.valid, classification: r.classification, errors: r.errors ?? [],
  }));
  const { data, error } = await supabase.rpc("import_pricing", { p_batch: input.batchId, p_sheet: input.sheetId, p_rows: rpcRows, p_mode: input.mode });
  if (error) {
    await supabase.from("pricing_import_batches").update({ status: "failed", error: error.message }).eq("id", input.batchId);
    return { ok: false, error: error.message };
  }
  const skipped = input.rows.filter((r) => !r.valid || (r.errors && r.errors.length));
  if (skipped.length) {
    const csv = toCsv(
      [{ key: "row_number", label: "Row" }, { key: "sku", label: "SKU" }, { key: "classification", label: "Classification" }, { key: "errors", label: "Errors" }],
      skipped.map((r) => ({ row_number: r.row_number, sku: r.sku ?? "", classification: r.classification, errors: (r.errors ?? []).join("; ") })),
    );
    const path = `pricing-errors/${input.batchId}.csv`;
    await supabase.storage.from("imports").upload(path, new Blob([csv], { type: "text/csv" }), { upsert: true });
    await supabase.from("pricing_import_batches").update({ error_report_path: path }).eq("id", input.batchId);
  }
  revalidatePath("/pricing"); revalidatePath(`/pricing/${input.sheetId}`);
  return { ok: true, data: { summary: data as Record<string, number> } };
}

// Open active bands for a model, for import classification (admin only).
export async function getModelBandKeys(sheetId: string): Promise<{ sku: string; min_quantity: number; selling_price: number }[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("pricing_sheet_items")
    .select("product_id,min_quantity,selling_price,products(sku)")
    .eq("pricing_sheet_id", sheetId).is("effective_to", null).eq("active", true);
  return (data ?? []).map((r) => ({
    sku: (r as { products?: { sku?: string } }).products?.sku ?? "",
    min_quantity: r.min_quantity, selling_price: r.selling_price,
  })).filter((r) => r.sku);
}

export async function getPricingSignedDownload(path: string): Promise<Result<{ url: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("imports").createSignedUrl(path, 120);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: data.signedUrl } };
}
