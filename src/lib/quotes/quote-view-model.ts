// ============================================================================
// Aurum Supply House — normalized quote view model (customer-facing ONLY)
// ----------------------------------------------------------------------------
// The ONE shape the browser preview and the printable/PDF document both render,
// so the two can never drift. Deliberately built to EXCLUDE every internal
// figure — a quote has no true cost / profit / margin / commission / expense, and
// price-resolution diagnostics (price_source, manual reasons) and internal notes
// are simply not fields here. Anything not on this type cannot leak onto a
// customer document.
// ============================================================================

import { COMPANY_NAME, COMPANY_LOCATION } from "@/lib/documents/branding";

export type QuoteViewAddress = { name?: string | null; lines: string[] };

export type QuoteViewLine = {
  sku: string;
  description: string; // name + strength + pack size, composed
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type QuoteViewModel = {
  // Fixed company identity: name + location ONLY (no street/phone/email/website).
  // logoPath is an optional Settings override; documents default to the shipped
  // official wordmark asset.
  company: { name: string; location: string; logoPath: string | null };
  quoteNumber: string;
  status: string;
  statusLabel: string;
  isVoid: boolean;
  isDraft: boolean;
  isExpired: boolean;
  showAcceptance: boolean; // customer acceptance area (sent/accepted only)
  quoteDate: string | null;
  expirationDate: string | null;
  paymentTermsLabel: string;
  currency: string;
  customerReference: string | null;
  billTo: QuoteViewAddress;
  shipTo: QuoteViewAddress;
  lines: QuoteViewLine[];
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string | null; // customer-facing quote notes/terms
  footer: string | null; // footer / disclaimer from Settings
};

const TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  net_60: "Net 60",
  custom: "Custom terms",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
  void: "Void",
};

type Addr = Record<string, unknown> | null | undefined;

export function addressLines(a: Addr): string[] {
  const o = (a ?? {}) as Record<string, string | undefined>;
  const l1 = [o.line1, o.line2].filter(Boolean).join(", ");
  const l2 = [o.city, o.region, o.postal_code].filter(Boolean).join(" ");
  return [l1, l2, o.country ?? ""].map((s) => (s ?? "").trim()).filter(Boolean);
}

export function paymentTermsLabel(term: string | null | undefined): string {
  return TERM_LABELS[term ?? "net_30"] ?? term ?? "Net 30";
}

function composeDescription(name: string, strength?: string | null, pack?: string | null): string {
  return [name, strength, pack].filter(Boolean).join(" · ");
}

export type QuoteHeaderInput = {
  quote_number: string;
  status: string;
  is_expired: boolean;
  quote_date: string | null;
  expiration_date: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_terms: string | null;
  customer_reference: string | null;
  notes: string | null;
  client_snapshot: Record<string, unknown> | null;
};

export type QuoteItemInput = {
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
};

export type QuoteSettingsInput = {
  company_name: string;
  logo_path: string | null;
  address: Record<string, unknown> | null;
  contact_email: string | null;
  contact_phone: string | null;
  quote_terms: string | null;
  quote_footer: string | null;
};

export function buildQuoteViewModel(
  header: QuoteHeaderInput,
  items: QuoteItemInput[],
  settings: QuoteSettingsInput,
): QuoteViewModel {
  const snap = (header.client_snapshot ?? {}) as Record<string, unknown>;
  const company = snap.company_name as string | undefined;
  const billing = snap.billing_address as Addr;
  const shipping = snap.shipping_address as Addr;
  const shipLines = addressLines(shipping);
  const status = header.status;

  return {
    company: {
      name: settings.company_name || COMPANY_NAME,
      location: COMPANY_LOCATION,
      logoPath: settings.logo_path,
    },
    quoteNumber: header.quote_number,
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    isVoid: status === "void",
    isDraft: status === "draft",
    isExpired: header.is_expired || status === "expired",
    showAcceptance: status === "sent" || status === "accepted",
    quoteDate: header.quote_date,
    expirationDate: header.expiration_date,
    paymentTermsLabel: paymentTermsLabel((header.payment_terms ?? snap.payment_terms) as string | undefined),
    currency: header.currency || "USD",
    customerReference: header.customer_reference,
    billTo: { name: company ?? null, lines: addressLines(billing) },
    // Fall back to billing when no distinct ship-to was captured.
    shipTo: { name: company ?? null, lines: shipLines.length ? shipLines : addressLines(billing) },
    lines: items.map((it) => ({
      sku: it.sku,
      description: composeDescription(it.product_name, it.strength, it.pack_size),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_subtotal),
    })),
    subtotal: Number(header.subtotal),
    discount: Number(header.discount),
    shipping: Number(header.shipping),
    fees: Number(header.fees),
    taxRate: Number(header.tax_rate),
    taxAmount: Number(header.tax_amount),
    total: Number(header.total),
    notes: header.notes || settings.quote_terms,
    footer: settings.quote_footer,
  };
}
