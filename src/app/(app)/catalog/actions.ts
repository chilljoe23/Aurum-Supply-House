"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  productCreateSchema,
  productEditSchema,
  manufacturerSchema,
} from "@/lib/catalog/schemas";
import { toCsv } from "@/lib/catalog/csv";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) {
    throw new Error("Not authorized");
  }
  return user;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---- Products ---------------------------------------------------------------

export async function createProduct(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const parsed = productCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const p = parsed.data;
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      sku: p.sku,
      name: p.name,
      description: p.description ?? null,
      strength: p.strength ?? null,
      product_form: p.product_form ?? null,
      pack_size: p.pack_size ?? null,
      unit_of_measure: p.unit_of_measure ?? null,
      manufacturer_id: p.manufacturer_id ?? null,
      manufacturer_sku: p.manufacturer_sku ?? null,
      category: p.category ?? null,
      currency: p.currency,
      moq: p.moq ?? null,
      lead_time_days: p.lead_time_days ?? null,
      notes: p.notes ?? null,
      status: p.active ? "active" : "discontinued",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, error: `A product with SKU "${p.sku}" already exists.` };
    return { ok: false, error: error.message };
  }

  if (p.true_cost !== null && p.true_cost !== undefined) {
    const { error: costErr } = await supabase.rpc("record_product_cost", {
      p_product: product.id,
      p_new_cost: p.true_cost,
      p_currency: p.currency,
      p_reason: "Initial cost on product creation",
    });
    if (costErr) return { ok: false, error: `Product created, but cost failed: ${costErr.message}` };
  }

  revalidatePath("/catalog");
  return { ok: true, data: { id: product.id } };
}

export async function updateProduct(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = productEditSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const p = parsed.data;
  const supabase = await createClient();

  // Current cost, to decide whether a cost-history record is needed.
  const { data: current } = await supabase
    .from("products")
    .select("current_true_cost")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("products")
    .update({
      name: p.name,
      description: p.description ?? null,
      strength: p.strength ?? null,
      product_form: p.product_form ?? null,
      pack_size: p.pack_size ?? null,
      unit_of_measure: p.unit_of_measure ?? null,
      manufacturer_id: p.manufacturer_id ?? null,
      manufacturer_sku: p.manufacturer_sku ?? null,
      category: p.category ?? null,
      currency: p.currency,
      moq: p.moq ?? null,
      lead_time_days: p.lead_time_days ?? null,
      notes: p.notes ?? null,
      status: p.active ? "active" : "discontinued",
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  const costChanged =
    p.true_cost !== null &&
    p.true_cost !== undefined &&
    Number(p.true_cost) !== Number(current?.current_true_cost ?? NaN);

  if (costChanged) {
    if (!p.cost_change_reason || p.cost_change_reason.trim() === "") {
      return { ok: false, error: "A reason is required to change the true cost." };
    }
    const { error: costErr } = await supabase.rpc("record_product_cost", {
      p_product: id,
      p_new_cost: p.true_cost,
      p_currency: p.currency,
      p_reason: p.cost_change_reason,
    });
    if (costErr) return { ok: false, error: costErr.message };
  }

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}`);
  return { ok: true };
}

export async function setProductStatus(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ status: active ? "active" : "discontinued" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}`);
  return { ok: true };
}

// ---- Manufacturers ----------------------------------------------------------

export async function createManufacturer(
  raw: unknown,
  force = false,
): Promise<ActionResult<{ id: string; duplicateOf?: string }>> {
  await requireAdmin();
  const parsed = manufacturerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const m = parsed.data;
  const supabase = await createClient();

  if (!force) {
    const { data: existing } = await supabase
      .from("manufacturers")
      .select("id, name")
      .order("created_at", { ascending: true });
    const match = (existing ?? []).find(
      (x) => normalizeName(x.name) === normalizeName(m.name),
    );
    if (match) {
      return {
        ok: false,
        error: `A manufacturer named "${match.name}" already exists. Confirm to create a duplicate.`,
        fieldErrors: { _duplicateOf: [match.id] },
      };
    }
  }

  const { data, error } = await supabase
    .from("manufacturers")
    .insert({
      name: m.name,
      legal_name: m.legal_name ?? null,
      contact_name: m.contact_name ?? null,
      email: m.email ?? null,
      phone: m.phone ?? null,
      payment_terms: m.payment_terms ?? null,
      default_currency: m.default_currency,
      notes: m.notes ?? null,
      status: m.active ? "active" : "discontinued",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog/manufacturers");
  return { ok: true, data: { id: data.id } };
}

// ---- Import ----------------------------------------------------------------

export async function createImportBatch(input: {
  filename: string;
  storage_path: string;
  file_type: string;
  worksheet: string;
}): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_import_batches")
    .insert({
      filename: input.filename,
      storage_path: input.storage_path,
      file_type: input.file_type,
      worksheet: input.worksheet,
      kind: "catalog",
      status: "previewed",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

type ImportRow = {
  row_number: number;
  sku: string | null;
  name: string | null;
  description?: string | null;
  strength?: string | null;
  product_form?: string | null;
  pack_size?: string | null;
  unit_of_measure?: string | null;
  manufacturer?: string | null;
  manufacturer_sku?: string | null;
  category?: string | null;
  true_cost?: number | null;
  currency?: string;
  moq?: number | null;
  lead_time_days?: number | null;
  notes?: string | null;
  active?: boolean;
  valid: boolean;
  classification: string;
  errors?: string[];
};

export async function commitImport(input: {
  batchId: string;
  mode: "atomic" | "valid_only";
  rows: ImportRow[];
  createMissingManufacturers: boolean;
}): Promise<ActionResult<{ summary: Record<string, number> }>> {
  await requireAdmin();
  const supabase = await createClient();

  // Resolve manufacturers by normalized name; optionally create missing ones.
  const { data: mfrs } = await supabase.from("manufacturers").select("id, name");
  const byNorm = new Map((mfrs ?? []).map((m) => [normalizeName(m.name), m.id]));

  const distinctNames = Array.from(
    new Set(
      input.rows
        .map((r) => (r.manufacturer ?? "").trim())
        .filter((n) => n.length > 0),
    ),
  );
  for (const name of distinctNames) {
    const norm = normalizeName(name);
    if (byNorm.has(norm)) continue;
    if (input.createMissingManufacturers) {
      const { data: created, error } = await supabase
        .from("manufacturers")
        .insert({ name })
        .select("id")
        .single();
      if (!error && created) byNorm.set(norm, created.id);
    }
  }

  const rpcRows = input.rows.map((r) => ({
    row_number: r.row_number,
    sku: r.sku,
    name: r.name,
    description: r.description ?? null,
    strength: r.strength ?? null,
    product_form: r.product_form ?? null,
    pack_size: r.pack_size ?? null,
    unit_of_measure: r.unit_of_measure ?? null,
    manufacturer_id: r.manufacturer
      ? byNorm.get(normalizeName(r.manufacturer)) ?? null
      : null,
    manufacturer_sku: r.manufacturer_sku ?? null,
    category: r.category ?? null,
    true_cost: r.true_cost ?? null,
    currency: r.currency ?? "USD",
    moq: r.moq ?? null,
    lead_time_days: r.lead_time_days ?? null,
    notes: r.notes ?? null,
    active: r.active ?? true,
    valid: r.valid,
    classification: r.classification,
    errors: r.errors ?? [],
  }));

  const { data: summary, error } = await supabase.rpc("import_catalog", {
    p_batch: input.batchId,
    p_rows: rpcRows,
    p_mode: input.mode,
  });

  if (error) {
    await supabase
      .from("catalog_import_batches")
      .update({ status: "failed", error: error.message })
      .eq("id", input.batchId);
    return { ok: false, error: error.message };
  }

  // Build and store an error report for skipped/invalid rows (best effort).
  const skipped = input.rows.filter((r) => !r.valid || (r.errors && r.errors.length));
  if (skipped.length > 0) {
    const csv = toCsv(
      [
        { key: "row_number", label: "Row" },
        { key: "sku", label: "SKU" },
        { key: "name", label: "Product Name" },
        { key: "classification", label: "Classification" },
        { key: "errors", label: "Errors" },
      ],
      skipped.map((r) => ({
        row_number: r.row_number,
        sku: r.sku ?? "",
        name: r.name ?? "",
        classification: r.classification,
        errors: (r.errors ?? []).join("; "),
      })),
    );
    const path = `errors/${input.batchId}.csv`;
    await supabase.storage
      .from("imports")
      .upload(path, new Blob([csv], { type: "text/csv" }), { upsert: true });
    await supabase
      .from("catalog_import_batches")
      .update({ error_report_path: path })
      .eq("id", input.batchId);
  }

  revalidatePath("/catalog");
  revalidatePath("/catalog/imports");
  return { ok: true, data: { summary: summary as Record<string, number> } };
}

export async function getSignedDownload(
  path: string,
): Promise<ActionResult<{ url: string }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("imports")
    .createSignedUrl(path, 120);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: data.signedUrl } };
}
