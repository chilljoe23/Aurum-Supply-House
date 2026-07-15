import "server-only";
import { createClient } from "@/lib/supabase/server";

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
};

export async function getCompanySettings(): Promise<CompanySettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select(
      "company_name,contact_email,contact_phone,address,invoice_number_prefix,default_payment_terms,default_tax_rate,payment_instructions,remittance_details,invoice_terms,invoice_footer",
    )
    .eq("id", true)
    .maybeSingle();
  return {
    company_name: data?.company_name ?? "Aurum Supply House",
    contact_email: data?.contact_email ?? null,
    contact_phone: data?.contact_phone ?? null,
    address: (data?.address ?? {}) as Record<string, string>,
    invoice_number_prefix: data?.invoice_number_prefix ?? "AUR",
    default_payment_terms: data?.default_payment_terms ?? "net_30",
    default_tax_rate: Number(data?.default_tax_rate ?? 0),
    payment_instructions: data?.payment_instructions ?? null,
    remittance_details: data?.remittance_details ?? null,
    invoice_terms: data?.invoice_terms ?? null,
    invoice_footer: data?.invoice_footer ?? null,
  };
}
