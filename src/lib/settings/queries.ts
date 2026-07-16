import "server-only";
// The quote-* columns on app_settings land only after `npm run gen:types` is
// re-run post-migration, so this read uses the loosely-typed client (identical
// runtime behavior; relaxed compile-time column typing).
import { createUntypedClient as createClient } from "@/lib/supabase/untyped";

export type CompanySettings = {
  company_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: Record<string, string>;
  invoice_number_prefix: string;
  default_payment_terms: string;
  default_tax_rate: number;
  payment_instructions: string | null;
  remittance_details: string | null;
  invoice_terms: string | null;
  invoice_footer: string | null;
  quote_number_prefix: string;
  quote_expiration_days: number;
  quote_terms: string | null;
  quote_footer: string | null;
};

export async function getCompanySettings(): Promise<CompanySettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select(
      "company_name,contact_email,contact_phone,address,invoice_number_prefix,default_payment_terms,default_tax_rate,payment_instructions,remittance_details,invoice_terms,invoice_footer,quote_number_prefix,quote_expiration_days,quote_terms,quote_footer",
    )
    .eq("id", true)
    .maybeSingle();
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    company_name: (d.company_name as string) ?? "Aurum Supply House",
    contact_email: (d.contact_email as string | null) ?? null,
    contact_phone: (d.contact_phone as string | null) ?? null,
    address: (d.address ?? {}) as Record<string, string>,
    invoice_number_prefix: (d.invoice_number_prefix as string) ?? "AUR",
    default_payment_terms: (d.default_payment_terms as string) ?? "net_30",
    default_tax_rate: Number(d.default_tax_rate ?? 0),
    payment_instructions: (d.payment_instructions as string | null) ?? null,
    remittance_details: (d.remittance_details as string | null) ?? null,
    invoice_terms: (d.invoice_terms as string | null) ?? null,
    invoice_footer: (d.invoice_footer as string | null) ?? null,
    quote_number_prefix: (d.quote_number_prefix as string) ?? "QTE",
    quote_expiration_days: Number(d.quote_expiration_days ?? 30),
    quote_terms: (d.quote_terms as string | null) ?? null,
    quote_footer: (d.quote_footer as string | null) ?? null,
  };
}
