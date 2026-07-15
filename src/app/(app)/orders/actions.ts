"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  orderDraftSchema,
  issueSchema,
  paymentSchema,
  voidSchema,
  expenseSchema,
} from "@/lib/orders/schemas";

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
  // Postgres RAISE messages are user-facing and already explanatory.
  return error.message.replace(/^.*ERROR:\s*/i, "");
}

// ---- Create / update a draft ------------------------------------------------
export async function saveOrderDraft(raw: unknown): Promise<Result<{ id: string }>> {
  await requireStaff();
  const parsed = orderDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("save_order_draft", {
    p_invoice: d.invoice_id ?? null,
    p_client: d.client_id,
    p_selected_model: d.selected_model_id ?? null,
    p_currency: d.currency,
    p_shipping: d.shipping,
    p_fees: d.fees,
    p_tax_rate: d.tax_rate,
    p_discount: d.discount,
    p_notes: d.notes ?? null,
    p_lines: d.lines.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      manual_price: l.manual_price ?? null,
      manual_reason: l.manual_reason ?? null,
    })),
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  if (d.invoice_id) revalidatePath(`/orders/${d.invoice_id}`);
  return { ok: true, data: { id: data as string } };
}

// ---- Live price resolution for the builder ----------------------------------
export type ResolvedPrice = {
  resolved: boolean;
  price: number | null;
  source: string;
  pricing_sheet_name: string | null;
  warning: string | null;
};

export async function resolveLinePrice(
  clientId: string,
  productId: string,
  quantity: number,
  selectedModel: string | null,
  currency: string,
): Promise<ResolvedPrice | { error: string }> {
  await requireStaff();
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("resolve_price", {
    p_client_id: clientId,
    p_product_id: productId,
    p_quantity: quantity,
    p_currency: currency,
    p_selected_model: selectedModel,
  });
  if (error) return { error: friendly(error) };
  const j = data as Record<string, unknown>;
  return {
    resolved: !!j.resolved,
    price: j.price != null ? Number(j.price) : null,
    source: (j.source as string) ?? "unresolved",
    pricing_sheet_name: (j.pricing_sheet_name as string | null) ?? null,
    warning: (j.warning as string | null) ?? null,
  };
}

// ---- Issue ------------------------------------------------------------------
export async function issueInvoice(raw: unknown): Promise<Result<{ invoice_number: string }>> {
  await requireStaff();
  const parsed = issueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_invoice: parsed.data.invoice_id,
    p_issue_date: parsed.data.issue_date ?? null,
    p_due_date: parsed.data.due_date ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${parsed.data.invoice_id}`);
  return { ok: true, data: { invoice_number: data as string } };
}

// ---- Record payment ---------------------------------------------------------
export async function recordPayment(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("record_payment", {
    p_invoice: p.invoice_id,
    p_amount: p.amount,
    p_method: p.method,
    p_reference: p.reference ?? null,
    p_received_at: p.received_at ? `${p.received_at}T12:00:00Z` : null,
    p_note: p.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${p.invoice_id}`);
  return { ok: true };
}

// ---- Void -------------------------------------------------------------------
export async function voidInvoice(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = voidSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("void_invoice", {
    p_invoice: parsed.data.invoice_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${parsed.data.invoice_id}`);
  return { ok: true };
}

// ---- Internal expenses ------------------------------------------------------
export async function addExpense(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const e = parsed.data;
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("add_order_expense", {
    p_invoice: e.invoice_id,
    p_type: e.type,
    p_amount: e.amount,
    p_note: e.note ?? null,
    p_incurred_on: e.incurred_on ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/orders/${e.invoice_id}`);
  return { ok: true };
}

export async function deleteExpense(expenseId: string, invoiceId: string): Promise<Result> {
  await requireStaff();
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_order_expense", { p_expense: expenseId });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/orders/${invoiceId}`);
  return { ok: true };
}

// ---- Discard a draft --------------------------------------------------------
export async function deleteDraft(invoiceId: string): Promise<Result> {
  await requireStaff();
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_draft", { p_invoice: invoiceId });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  return { ok: true };
}
