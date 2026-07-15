"use server";

import { revalidatePath } from "next/cache";
import { createUntypedClient } from "@/lib/supabase/untyped";
import { getCurrentUser } from "@/lib/auth";
import {
  poDraftSchema,
  sendPoSchema,
  transitionPoSchema,
  voidPoSchema,
  mfrPaymentSchema,
  poShipmentSchema,
  receivePoLineSchema,
  poAttachmentSchema,
} from "@/lib/purchase-orders/schemas";
import { getManufacturerCatalog, type PoCatalogProduct } from "@/lib/purchase-orders/queries";

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
  return u;
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /not authorized|permission/i.test(error.message)) {
    return "You do not have permission to perform this action.";
  }
  return error.message.replace(/^.*ERROR:\s*/i, "");
}

// ---- Builder: load one manufacturer's active product relationships ----------
export async function loadManufacturerCatalog(
  manufacturerId: string,
): Promise<Result<PoCatalogProduct[]>> {
  await requireAdmin();
  try {
    const products = await getManufacturerCatalog(manufacturerId);
    return { ok: true, data: products };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---- Live cost resolution for the builder (mirrors resolveLinePrice) --------
export type ResolvedCost = {
  resolved: boolean;
  unit_cost: number | null;
  currency: string;
  source: string;
  tier_min: number | null;
  tier_max: number | null;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
  warnings: string[];
  warning: string | null;
};

export async function resolvePoLineCost(
  manufacturerId: string,
  productId: string,
  quantity: number,
  currency: string,
): Promise<ResolvedCost | { error: string }> {
  await requireAdmin();
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("resolve_manufacturer_cost", {
    p_manufacturer: manufacturerId,
    p_product: productId,
    p_quantity: quantity,
    p_currency: currency,
    p_effective: null,
  });
  if (error) return { error: friendly(error) };
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    resolved: !!j.resolved,
    unit_cost: j.unit_cost != null ? Number(j.unit_cost) : null,
    currency: (j.currency as string) ?? currency,
    source: (j.source as string) ?? "unresolved",
    tier_min: j.tier_min_quantity != null ? Number(j.tier_min_quantity) : null,
    tier_max: j.tier_max_quantity != null ? Number(j.tier_max_quantity) : null,
    moq: j.moq != null ? Number(j.moq) : null,
    order_multiple: j.order_multiple != null ? Number(j.order_multiple) : null,
    lead_time_days: j.lead_time_days != null ? Number(j.lead_time_days) : null,
    warnings: Array.isArray(j.warnings) ? (j.warnings as string[]) : [],
    warning: (j.warning as string | null) ?? null,
  };
}

// ---- Create / update a draft PO ---------------------------------------------
export async function savePoDraft(raw: unknown): Promise<Result<{ id: string }>> {
  await requireAdmin();
  const parsed = poDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("save_po_draft", {
    p_po: d.po_id ?? null,
    p_manufacturer: d.manufacturer_id,
    p_currency: d.currency,
    p_shipping: d.shipping,
    p_fees: d.fees,
    p_tax: d.tax,
    p_expected_date: d.expected_date ?? null,
    p_payment_terms: d.payment_terms ?? null,
    p_notes: d.notes ?? null,
    p_lines: d.lines.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      manual_cost: l.manual_cost ?? null,
      manual_reason: l.manual_reason ?? null,
      notes: l.notes ?? null,
    })),
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/purchasing");
  if (d.po_id) revalidatePath(`/purchasing/${d.po_id}`);
  return { ok: true, data: { id: data as string } };
}

// ---- Send -------------------------------------------------------------------
export async function sendPo(raw: unknown): Promise<Result<{ po_number: string }>> {
  await requireAdmin();
  const parsed = sendPoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("send_po", { p_po: parsed.data.po_id });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/purchasing");
  revalidatePath(`/purchasing/${parsed.data.po_id}`);
  return { ok: true, data: { po_number: data as string } };
}

// ---- Advance status ---------------------------------------------------------
export async function transitionPo(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = transitionPoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("transition_po_status", {
    p_po: parsed.data.po_id,
    p_to: parsed.data.to,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/purchasing/${parsed.data.po_id}`);
  revalidatePath("/purchasing");
  return { ok: true };
}

// ---- Void -------------------------------------------------------------------
export async function voidPo(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = voidPoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("void_po", {
    p_po: parsed.data.po_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/purchasing/${parsed.data.po_id}`);
  revalidatePath("/purchasing");
  return { ok: true };
}

// ---- Record a manufacturer payment ------------------------------------------
export async function recordManufacturerPayment(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = mfrPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("record_manufacturer_payment", {
    p_po: p.po_id,
    p_type: p.type,
    p_amount: p.amount,
    p_date: p.payment_date ?? null,
    p_method: p.method,
    p_reference: p.reference ?? null,
    p_notes: p.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/purchasing/${p.po_id}`);
  return { ok: true };
}

// ---- Tracking / shipment ----------------------------------------------------
export async function addPoShipment(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = poShipmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const s = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("add_po_shipment", {
    p_po: s.po_id,
    p_carrier: s.carrier ?? null,
    p_tracking: s.tracking_number ?? null,
    p_ship_date: s.ship_date ?? null,
    p_expected_arrival: s.expected_arrival_date ?? null,
    p_received_date: s.received_date ?? null,
    p_notes: s.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/purchasing/${s.po_id}`);
  return { ok: true };
}

// ---- Receiving --------------------------------------------------------------
export async function receivePoLine(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = receivePoLineSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const r = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("receive_po_line", {
    p_item: r.item_id,
    p_quantity: r.quantity,
    p_received_date: r.received_date ?? null,
    p_lot: r.lot_number ?? null,
    p_notes: r.notes ?? null,
    p_shipment: r.shipment_id ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true };
}

// ---- Discard a draft --------------------------------------------------------
export async function deletePoDraft(poId: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("delete_po_draft", { p_po: poId });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/purchasing");
  return { ok: true };
}

// ---- Attachments: upload to private storage, then register metadata ---------
export async function uploadPoAttachment(formData: FormData): Promise<Result> {
  await requireAdmin();
  const poId = String(formData.get("po_id") ?? "");
  const category = String(formData.get("type") ?? "other");
  const note = String(formData.get("note") ?? "");
  const file = formData.get("file");
  if (!poId || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: "File is too large (max 25 MB)." };
  }

  const supabase = await createUntypedClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${poId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from("po-attachments")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) return { ok: false, error: upErr.message };

  const parsed = poAttachmentSchema.safeParse({
    po_id: poId,
    type: category,
    filename: file.name,
    storage_path: path,
    file_type: file.type || undefined,
    size_bytes: file.size,
    note: note || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Validation failed" };

  const { error } = await supabase.rpc("add_po_attachment", {
    p_po: parsed.data.po_id,
    p_type: parsed.data.type,
    p_filename: parsed.data.filename,
    p_storage_path: parsed.data.storage_path,
    p_file_type: parsed.data.file_type ?? null,
    p_size: parsed.data.size_bytes ?? null,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    // best-effort cleanup of the orphaned object
    await supabase.storage.from("po-attachments").remove([path]);
    return { ok: false, error: friendly(error) };
  }
  revalidatePath(`/purchasing/${poId}`);
  return { ok: true };
}

// ---- Signed download URL for a private attachment (never a public URL) ------
export async function getPoAttachmentUrl(storagePath: string): Promise<Result<{ url: string }>> {
  await requireAdmin();
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.storage.from("po-attachments").createSignedUrl(storagePath, 120);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: data.signedUrl } };
}
