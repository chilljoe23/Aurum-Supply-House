"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { assignmentSchema, overrideSchema } from "@/lib/pricing/schemas";

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
  return u;
}

export async function assignPricingModel(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = assignmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const a = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_pricing_model", {
    p_client: a.client_id, p_sheet: a.pricing_sheet_id,
    p_effective: a.effective_date ?? null, p_expiration: a.expiration_date ?? null, p_notes: a.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${a.client_id}`); revalidatePath("/clients");
  return { ok: true };
}

export async function setClientOverride(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const o = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_client_override", {
    p_client: o.client_id, p_product: o.product_id, p_min_qty: o.min_quantity, p_max_qty: o.max_quantity ?? null,
    p_price: o.selling_price, p_currency: o.currency, p_effective: o.effective_date ?? null,
    p_expiration: o.expiration_date ?? null, p_active: o.active, p_reason: o.reason, p_notes: o.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${o.client_id}`);
  return { ok: true };
}

export async function endDateOverride(overrideId: string, clientId: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("client_price_overrides").update({ effective_to: today }).eq("id", overrideId).is("effective_to", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
