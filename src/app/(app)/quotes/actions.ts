"use server";

import { revalidatePath } from "next/cache";
import { createUntypedClient } from "@/lib/supabase/untyped";
import { getCurrentUser } from "@/lib/auth";
import {
  quoteDraftSchema,
  sendSchema,
  transitionSchema,
  voidSchema,
  duplicateSchema,
  convertSchema,
} from "@/lib/quotes/schemas";

// NB: the live per-line price resolver is identical to the order builder's — a
// quote is priced through the exact same server-side app.resolve_price. The
// builder imports resolveLinePrice directly from the orders actions module.

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireStaff() {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authorized");
  return u;
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /not authorized|permission/i.test(error.message)) {
    return "You do not have permission to perform this action.";
  }
  return error.message.replace(/^.*ERROR:\s*/i, "");
}

// ---- Create / update a draft ------------------------------------------------
export async function saveQuoteDraft(raw: unknown): Promise<Result<{ id: string }>> {
  await requireStaff();
  const parsed = quoteDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("save_quote_draft", {
    p_quote: d.quote_id ?? null,
    p_client: d.client_id,
    p_selected_model: d.selected_model_id ?? null,
    p_currency: d.currency,
    p_shipping: d.shipping,
    p_fees: d.fees,
    p_tax_rate: d.tax_rate,
    p_discount: d.discount,
    p_payment_terms: d.payment_terms,
    p_customer_reference: d.customer_reference ?? null,
    p_quote_date: d.quote_date ?? null,
    p_expiration_date: d.expiration_date ?? null,
    p_notes: d.notes ?? null,
    p_lines: d.lines.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      manual_price: l.manual_price ?? null,
      manual_reason: l.manual_reason ?? null,
    })),
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  if (d.quote_id) revalidatePath(`/quotes/${d.quote_id}`);
  return { ok: true, data: { id: data as string } };
}

// ---- Send -------------------------------------------------------------------
export async function sendQuote(raw: unknown): Promise<Result<{ quote_number: string }>> {
  await requireStaff();
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("send_quote", { p_quote: parsed.data.quote_id });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${parsed.data.quote_id}`);
  return { ok: true, data: { quote_number: data as string } };
}

// ---- Lifecycle transition (accept / decline / mark expired) -----------------
export async function transitionQuote(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = transitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("transition_quote_status", {
    p_quote: p.quote_id,
    p_to: p.to,
    p_note: p.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${p.quote_id}`);
  return { ok: true };
}

// ---- Void -------------------------------------------------------------------
export async function voidQuote(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = voidSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("void_quote", { p_quote: parsed.data.quote_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${parsed.data.quote_id}`);
  return { ok: true };
}

// ---- Duplicate --------------------------------------------------------------
export async function duplicateQuote(raw: unknown): Promise<Result<{ id: string }>> {
  await requireStaff();
  const parsed = duplicateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("duplicate_quote", {
    p_quote: parsed.data.quote_id,
    p_retain: parsed.data.retain_prices,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  return { ok: true, data: { id: data as string } };
}

// ---- Convert to order -------------------------------------------------------
export async function convertQuote(raw: unknown): Promise<Result<{ order_id: string }>> {
  await requireStaff();
  const parsed = convertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("convert_quote_to_order", { p_quote: parsed.data.quote_id });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${parsed.data.quote_id}`);
  revalidatePath("/orders");
  return { ok: true, data: { order_id: data as string } };
}

// ---- Discard a draft --------------------------------------------------------
export async function deleteQuoteDraft(quoteId: string): Promise<Result> {
  await requireStaff();
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("delete_quote_draft", { p_quote: quoteId });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/quotes");
  return { ok: true };
}
