"use server";

import { revalidatePath } from "next/cache";
import { createUntypedClient } from "@/lib/supabase/untyped";
import { getCurrentUser } from "@/lib/auth";
import {
  commissionCreateSchema,
  commissionUpdateSchema,
  commissionApproveSchema,
  commissionPaySchema,
  commissionVoidSchema,
  commissionBulkApproveSchema,
  commissionBulkPaySchema,
  commissionPreviewSchema,
} from "@/lib/commissions/schemas";

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

function revalidate(invoiceId?: string) {
  revalidatePath("/commissions");
  revalidatePath("/commissions/statements");
  revalidatePath("/command-center");
  if (invoiceId) revalidatePath(`/orders/${invoiceId}`);
}

// ---- Create -----------------------------------------------------------------
export async function createCommission(raw: unknown): Promise<Result<{ id: string }>> {
  await requireStaff();
  const parsed = commissionCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("create_commission", {
    p_invoice: d.invoice_id,
    p_recipient_type: d.recipient_type,
    p_recipient_id: d.recipient_id ?? null,
    p_recipient_name: d.recipient_name,
    p_recipient_email: d.recipient_email ?? null,
    p_recipient_company: d.recipient_company ?? null,
    p_payment_notes: d.payment_notes ?? null,
    p_commission_type: d.commission_type,
    p_rate: d.rate,
    p_units: d.units ?? null,
    p_note: d.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidate(d.invoice_id);
  return { ok: true, data: { id: data as string } };
}

// ---- Update -----------------------------------------------------------------
export async function updateCommission(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = commissionUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("update_commission", {
    p_commission: d.commission_id,
    p_recipient_type: d.recipient_type,
    p_recipient_id: d.recipient_id ?? null,
    p_recipient_name: d.recipient_name,
    p_recipient_email: d.recipient_email ?? null,
    p_recipient_company: d.recipient_company ?? null,
    p_payment_notes: d.payment_notes ?? null,
    p_commission_type: d.commission_type,
    p_rate: d.rate,
    p_units: d.units ?? null,
    p_note: d.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  return { ok: true };
}

// ---- Approve ----------------------------------------------------------------
export async function approveCommission(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = commissionApproveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("approve_commission", { p_commission: parsed.data.commission_id });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  return { ok: true };
}

// ---- Pay --------------------------------------------------------------------
export async function payCommission(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = commissionPaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("pay_commission", {
    p_commission: p.commission_id,
    p_method: p.method,
    p_reference: p.reference ?? null,
    p_note: p.note ?? null,
    p_paid_at: p.paid_at ? `${p.paid_at}T12:00:00Z` : null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  return { ok: true };
}

// ---- Void -------------------------------------------------------------------
export async function voidCommission(raw: unknown): Promise<Result> {
  await requireStaff();
  const parsed = commissionVoidSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed" };
  const supabase = await createUntypedClient();
  const { error } = await supabase.rpc("void_commission", {
    p_commission: parsed.data.commission_id,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  return { ok: true };
}

// ---- Bulk approve -----------------------------------------------------------
export async function bulkApproveCommissions(raw: unknown): Promise<Result<{ approved: number; skipped: number }>> {
  await requireStaff();
  const parsed = commissionBulkApproveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Select at least one commission" };
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("bulk_approve_commissions", { p_ids: parsed.data.ids });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  const r = (data ?? {}) as { approved?: number; skipped?: number };
  return { ok: true, data: { approved: Number(r.approved ?? 0), skipped: Number(r.skipped ?? 0) } };
}

// ---- Bulk pay ---------------------------------------------------------------
export async function bulkPayCommissions(raw: unknown): Promise<Result<{ paid: number; skipped: number }>> {
  await requireStaff();
  const parsed = commissionBulkPaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Select at least one commission" };
  const p = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("bulk_pay_commissions", {
    p_ids: p.ids,
    p_method: p.method,
    p_reference: p.reference ?? null,
    p_note: p.note ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidate();
  const r = (data ?? {}) as { paid?: number; skipped?: number };
  return { ok: true, data: { paid: Number(r.paid ?? 0), skipped: Number(r.skipped ?? 0) } };
}

// ---- Preview (builder helper) ----------------------------------------------
export type CommissionPreview = {
  amount: number;
  basis: number;
  invoice_subtotal: number;
  invoice_gross_profit: number;
  exceeds_gross_profit: boolean;
  warning: string | null;
};

export async function previewCommission(raw: unknown): Promise<CommissionPreview | { error: string }> {
  await requireStaff();
  const parsed = commissionPreviewSchema.safeParse(raw);
  if (!parsed.success) return { error: "Validation failed" };
  const p = parsed.data;
  const supabase = await createUntypedClient();
  const { data, error } = await supabase.rpc("preview_commission", {
    p_invoice: p.invoice_id,
    p_commission_type: p.commission_type,
    p_rate: p.rate,
    p_units: p.units ?? null,
  });
  if (error) return { error: friendly(error) };
  const j = (data ?? {}) as Record<string, unknown>;
  return {
    amount: Number(j.amount ?? 0),
    basis: Number(j.basis ?? 0),
    invoice_subtotal: Number(j.invoice_subtotal ?? 0),
    invoice_gross_profit: Number(j.invoice_gross_profit ?? 0),
    exceeds_gross_profit: !!j.exceeds_gross_profit,
    warning: (j.warning as string | null) ?? null,
  };
}
