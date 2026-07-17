"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createUntypedClient } from "@/lib/supabase/untyped";
import { callRpc } from "@/lib/supabase/rpc";
import { getCurrentUser } from "@/lib/auth";
import {
  orderDraftSchema,
  issueSchema,
  paymentSchema,
  voidSchema,
  expenseSchema,
  lotSchema,
  deleteOrderSchema,
  lineStatusSchema,
  shipmentSchema,
  voidShipmentSchema,
} from "@/lib/orders/schemas";

export type Result<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function requireStaff() {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authorized");
  return u;
}

// Owner/Admin gate for fulfillment writes (the DB RPCs re-verify app.is_admin();
// this is the UI-layer boundary that keeps the actions off reps' surface).
async function requireAdmin() {
  const u = await getCurrentUser();
  if (!u || (u.role !== "owner" && u.role !== "admin")) throw new Error("Not authorized");
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
  const { data, error } = await callRpc(supabase, "save_order_draft", {
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
      lot_number: l.lot_number ?? null,
      manufacturing_date: l.manufacturing_date ?? null,
      expiration_date: l.expiration_date ?? null,
      retest_date: l.retest_date ?? null,
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
  const { data, error } = await callRpc(supabase, "resolve_price", {
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
  const { data, error } = await callRpc(supabase, "issue_invoice", {
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
  const { error } = await callRpc(supabase, "record_payment", {
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

// ---- Owner-only permanent deletion ------------------------------------------
// Distinct from Void (which retains the record). The Owner-only, eligibility-
// gated, atomic teardown lives entirely in the SECURITY DEFINER RPC
// public.hard_delete_order; this action only forwards the request and surfaces
// the DB's safe business-reason message verbatim on refusal. The RPC re-verifies
// Owner + Draft/Void + no payments/paid commissions server-side, so the UI's
// eligibility gating is convenience only, never the security boundary.
export async function deleteOrderPermanently(raw: unknown): Promise<Result<{ former_order_number?: string }>> {
  await requireStaff();
  const parsed = deleteOrderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  // Untyped client: hard_delete_order is not in the committed generated types
  // until gen:types re-runs against the migrated DB (same pattern as lot assign).
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("hard_delete_order", {
    p_invoice: parsed.data.invoice_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  const former = (data as { former_order_number?: string } | null)?.former_order_number;
  return { ok: true, data: { former_order_number: former } };
}

// ---- Internal expenses ------------------------------------------------------
export async function addExpense(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const e = parsed.data;
  const supabase = await createServerClient();
  const { error } = await callRpc(supabase, "add_order_expense", {
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

// ---- Assign a lot number to an invoice line ---------------------------------
// Works on drafts AND issued invoices via the narrowly-scoped, audited RPC
// (app.assign_invoice_lot). General issued-invoice immutability is unchanged.
export async function assignInvoiceLot(raw: unknown, invoiceId: string): Promise<Result> {
  await requireStaff();
  const parsed = lotSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const l = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("assign_invoice_lot", {
    p_item: l.item_id,
    p_lot: l.lot_number ?? null,
    p_manufacturing_date: l.manufacturing_date ?? null,
    p_expiration_date: l.expiration_date ?? null,
    p_retest_date: l.retest_date ?? null,
    p_coa_path: null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/orders/${invoiceId}`);
  return { ok: true };
}

// ---- Fulfillment: set a line's operational status ---------------------------
// Owner/Admin only. "partially_shipped" / "shipped" are derived and rejected by
// the schema. The DB RPC additionally refuses cancelling a line that has shipped.
export async function setLineFulfillmentStatus(raw: unknown, invoiceId: string): Promise<Result> {
  await requireAdmin();
  const parsed = lineStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("set_line_fulfillment_status", {
    p_item: parsed.data.item_id,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${invoiceId}`);
  return { ok: true };
}

// ---- Fulfillment: create a shipment (atomic; over-ship rejected by the RPC) --
export async function createShipment(raw: unknown): Promise<Result<{ shipment_number: string }>> {
  await requireAdmin();
  const parsed = shipmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const s = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("create_shipment", {
    p_invoice: s.invoice_id,
    p_shipment_date: s.shipment_date ?? null,
    p_carrier: s.carrier ?? null,
    p_service: s.service ?? null,
    p_tracking_number: s.tracking_number ?? null,
    p_tracking_url: s.tracking_url ?? null,
    p_notes: s.notes ?? null,
    p_lines: s.lines.map((l) => ({
      invoice_item_id: l.invoice_item_id,
      quantity: l.quantity,
      lot_number: l.lot_number ?? null,
      manufacturing_date: l.manufacturing_date ?? null,
      expiration_date: l.expiration_date ?? null,
      retest_date: l.retest_date ?? null,
    })),
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${s.invoice_id}`);
  const number = (data as { shipment_number?: string } | null)?.shipment_number ?? "";
  return { ok: true, data: { shipment_number: number } };
}

// ---- Fulfillment: void a shipment (audited correction; append-only preserved)-
export async function voidShipment(raw: unknown, invoiceId: string): Promise<Result> {
  await requireAdmin();
  const parsed = voidShipmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("void_shipment", {
    p_shipment: parsed.data.shipment_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath("/orders");
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
