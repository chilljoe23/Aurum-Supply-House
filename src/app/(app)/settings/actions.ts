"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export type Result = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const opt = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));

const settingsSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required").max(200),
  contact_email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  contact_phone: opt,
  address_line1: opt,
  address_line2: opt,
  address_city: opt,
  address_region: opt,
  address_postal_code: opt,
  address_country: opt,
  invoice_number_prefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and dashes only"),
  default_payment_terms: z.enum(["due_on_receipt", "net_15", "net_30", "net_45", "net_60", "custom"]),
  default_tax_rate_pct: z.coerce.number().min(0).max(100),
  payment_instructions: opt,
  remittance_details: opt,
  invoice_terms: opt,
  invoice_footer: opt,
});

export async function updateCompanySettings(raw: unknown): Promise<Result> {
  // Owner-only (app_settings write RLS is is_owner; enforced here too).
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return { ok: false, error: "Only the Owner can change company settings." };

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors };
  const s = parsed.data;

  const address: Record<string, string> = {};
  const put = (k: string, v?: string) => {
    if (v && v.trim()) address[k] = v.trim();
  };
  put("line1", s.address_line1);
  put("line2", s.address_line2);
  put("city", s.address_city);
  put("region", s.address_region);
  put("postal_code", s.address_postal_code);
  put("country", s.address_country);

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      company_name: s.company_name,
      contact_email: s.contact_email ?? null,
      contact_phone: s.contact_phone ?? null,
      address,
      invoice_number_prefix: s.invoice_number_prefix,
      default_payment_terms: s.default_payment_terms,
      default_tax_rate: s.default_tax_rate_pct / 100,
      payment_instructions: s.payment_instructions ?? null,
      remittance_details: s.remittance_details ?? null,
      invoice_terms: s.invoice_terms ?? null,
      invoice_footer: s.invoice_footer ?? null,
    })
    .eq("id", true);

  if (error) return { ok: false, error: error.code === "42501" ? "You do not have permission to change settings." : error.message };
  revalidatePath("/settings");
  return { ok: true };
}
