// ============================================================================
// Aurum Supply House — normalized invoice view model (customer-facing ONLY)
// ----------------------------------------------------------------------------
// The ONE shape the browser preview and the printable/PDF document both render,
// so the two can never drift. It is deliberately built to EXCLUDE every internal
// figure — true cost, gross/net profit, margin, commission, internal expenses,
// price-resolution internals, and internal notes are simply not fields here.
// Anything not on this type cannot leak onto a customer document.
// ============================================================================

import { COMPANY_NAME, COMPANY_LOCATION } from "@/lib/documents/branding";

export type InvoiceViewAddress = { name?: string | null; lines: string[] };

export type InvoiceViewLine = {
  sku: string;
  description: string; // name + strength + pack size, composed
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  // Optional lot traceability (COA path deliberately excluded — never on documents).
  lotNumber: string | null;
  manufacturingDate: string | null;
  expirationDate: string | null;
  retestDate: string | null;
};

export type InvoiceViewModel = {
  // Fixed company identity: name + location ONLY (no street/phone/email/website).
  // logoPath is an optional Settings override; documents default to the shipped
  // official wordmark asset.
  company: { name: string; location: string; logoPath: string | null };
  invoiceNumber: string;
  status: string;
  isVoid: boolean;
  isDraft: boolean;
  issueDate: string | null;
  dueDate: string | null;
  paymentTermsLabel: string;
  currency: string;
  billTo: InvoiceViewAddress;
  shipTo: InvoiceViewAddress;
  lines: InvoiceViewLine[];
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentInstructions: string | null;
  remittanceDetails: string | null;
  notes: string | null; // customer-facing invoice notes/terms
  footer: string | null;
};

const TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_45: "Net 45",
  net_60: "Net 60",
  custom: "Custom terms",
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

// Inputs are already customer-facing rows (from v_orders / v_order_items and
// app_settings); this builder just normalizes them into the view model.
export type InvoiceHeaderInput = {
  invoice_number: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string | null;
  client_snapshot: Record<string, unknown> | null;
};

export type InvoiceItemInput = {
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  lot_number?: string | null;
  manufacturing_date?: string | null;
  expiration_date?: string | null;
  retest_date?: string | null;
};

export type SettingsInput = {
  company_name: string;
  logo_path: string | null;
  address: Record<string, unknown> | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_instructions: string | null;
  remittance_details: string | null;
  invoice_terms: string | null;
  invoice_footer: string | null;
};

export function buildInvoiceViewModel(
  header: InvoiceHeaderInput,
  items: InvoiceItemInput[],
  settings: SettingsInput,
): InvoiceViewModel {
  const snap = (header.client_snapshot ?? {}) as Record<string, unknown>;
  const company = snap.company_name as string | undefined;
  const billing = snap.billing_address as Addr;
  const shipping = snap.shipping_address as Addr;
  const shipLines = addressLines(shipping);

  return {
    company: {
      name: settings.company_name || COMPANY_NAME,
      location: COMPANY_LOCATION,
      logoPath: settings.logo_path,
    },
    invoiceNumber: header.invoice_number,
    status: header.status,
    isVoid: header.status === "void",
    isDraft: header.status === "draft",
    issueDate: header.issue_date,
    dueDate: header.due_date,
    paymentTermsLabel: paymentTermsLabel(snap.payment_terms as string | undefined),
    currency: header.currency || "USD",
    billTo: { name: company ?? null, lines: addressLines(billing) },
    // Fall back to billing when no distinct ship-to was captured.
    shipTo: { name: company ?? null, lines: shipLines.length ? shipLines : addressLines(billing) },
    lines: items.map((it) => ({
      sku: it.sku,
      description: composeDescription(it.product_name, it.strength, it.pack_size),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_subtotal),
      lotNumber: it.lot_number ?? null,
      manufacturingDate: it.manufacturing_date ?? null,
      expirationDate: it.expiration_date ?? null,
      retestDate: it.retest_date ?? null,
    })),
    subtotal: Number(header.subtotal),
    discount: Number(header.discount),
    shipping: Number(header.shipping),
    fees: Number(header.fees),
    taxRate: Number(header.tax_rate),
    taxAmount: Number(header.tax_amount),
    total: Number(header.total),
    amountPaid: Number(header.amount_paid),
    balanceDue: Number(header.balance_due),
    paymentInstructions: settings.payment_instructions,
    remittanceDetails: settings.remittance_details,
    notes: header.notes || settings.invoice_terms,
    footer: settings.invoice_footer,
  };
}
