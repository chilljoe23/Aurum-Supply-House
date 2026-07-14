"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { assignmentSchema, overrideSchema } from "@/lib/pricing/schemas";
import { clientCreateSchema, clientEditSchema, CLIENT_STATUSES } from "@/lib/clients/schemas";
import type { Database } from "@/types/database.types";

type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type ClientStatus = Database["public"]["Enums"]["client_status"];

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
  return u;
}

// Client CRUD is available to any active staff member; reps are constrained to
// their own book by RLS and by the self-assignment rule enforced below.
async function requireStaff() {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authorized");
  return u;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Strip empty address fields so we persist a clean, compact jsonb object.
function cleanAddress(a: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    if (v && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

// ---- Clients: CRUD ----------------------------------------------------------

export async function createClient(raw: unknown, force = false): Promise<Result<{ id: string }>> {
  const user = await requireStaff();
  const parsed = clientCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const c = parsed.data;
  const supabase = await createServerClient();

  // Near-duplicate company-name guard (case/whitespace-insensitive).
  if (!force) {
    const { data: existing } = await supabase.from("clients").select("id,company_name");
    const match = (existing ?? []).find((x) => normalizeName(x.company_name) === normalizeName(c.company_name));
    if (match) {
      return {
        ok: false,
        error: `A client named "${match.company_name}" already exists. Confirm to create a duplicate.`,
        fieldErrors: { _duplicateOf: [match.id] },
      };
    }
  }

  // Rep assignment rule: a sales rep may only self-assign. Owner/admin may assign
  // any active rep (validated below). RLS enforces the same at the DB layer.
  const isAdmin = user.role === "owner" || user.role === "admin";
  let assignedRep: string | null;
  if (isAdmin) {
    assignedRep = c.assigned_rep_id ?? null;
    if (assignedRep) {
      const err = await validateActiveRep(supabase, assignedRep);
      if (err) return { ok: false, error: err, fieldErrors: { assigned_rep_id: [err] } };
    }
  } else {
    assignedRep = user.id; // self-assign, regardless of submitted value
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      company_name: c.company_name,
      primary_contact_name: c.primary_contact_name ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      payment_terms: c.payment_terms,
      status: c.status,
      notes: c.notes ?? null,
      assigned_rep_id: assignedRep,
      default_pricing_sheet_id: c.default_pricing_sheet_id ?? null,
      billing_address: cleanAddress(c.billing_address),
      shipping_address: cleanAddress(c.shipping_address),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/clients");
  return { ok: true, data: { id: data.id } };
}

export async function updateClient(id: string, raw: unknown): Promise<Result> {
  const user = await requireStaff();
  const parsed = clientEditSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const c = parsed.data;
  const supabase = await createServerClient();

  const isAdmin = user.role === "owner" || user.role === "admin";

  // Build the update. Reps cannot reassign a client away from themselves; the
  // assigned_rep_id field is simply omitted for reps (RLS would reject it anyway).
  const patch: ClientUpdate = {
    company_name: c.company_name,
    primary_contact_name: c.primary_contact_name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    payment_terms: c.payment_terms,
    status: c.status,
    notes: c.notes ?? null,
    default_pricing_sheet_id: c.default_pricing_sheet_id ?? null,
    billing_address: cleanAddress(c.billing_address),
    shipping_address: cleanAddress(c.shipping_address),
  };
  if (isAdmin) {
    const assignedRep = c.assigned_rep_id ?? null;
    if (assignedRep) {
      const err = await validateActiveRep(supabase, assignedRep);
      if (err) return { ok: false, error: err, fieldErrors: { assigned_rep_id: [err] } };
    }
    patch.assigned_rep_id = assignedRep;
  }

  const { error } = await supabase.from("clients").update(patch).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

export async function setClientStatus(id: string, status: string): Promise<Result> {
  await requireStaff();
  if (!(CLIENT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.from("clients").update({ status: status as ClientStatus }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

async function validateActiveRep(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  repId: string,
): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("id,status").eq("id", repId).maybeSingle();
  if (!data) return "Selected representative was not found.";
  if (data.status !== "active") return "Selected representative is not active.";
  return null;
}

function friendlyError(error: { code?: string; message: string }): string {
  // RLS denial surfaces as an empty result / permission error — make it human.
  if (error.code === "42501") return "You do not have permission to perform this action.";
  return error.message;
}

// ---- Clients: pricing (M2 — preserved unchanged) ---------------------------

export async function assignPricingModel(raw: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = assignmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const a = parsed.data;
  const supabase = await createServerClient();
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
  const supabase = await createServerClient();
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
  const supabase = await createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("client_price_overrides").update({ effective_to: today }).eq("id", overrideId).is("effective_to", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
