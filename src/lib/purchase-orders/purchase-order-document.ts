// ============================================================================
// Aurum Supply House — normalized PURCHASE-ORDER view model.
// The ONE shape the browser preview and the printable/PDF document both render,
// so the two can never drift. It is deliberately built to EXCLUDE every figure a
// PO must never show: customer selling prices, customer pricing models, gross
// profit / margin, net profit, commissions, and unrelated customer information.
// Anything not on this type cannot leak onto the document. Unit COST (what Aurum
// pays the manufacturer) IS appropriate on a PO and is the only price shown.
// ============================================================================

export type PoViewAddress = { name?: string | null; lines: string[] };

export type PoViewLine = {
  sku: string;
  manufacturerSku: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
};

export type PurchaseOrderViewModel = {
  company: { name: string; lines: string[]; email: string | null; phone: string | null };
  poNumber: string;
  status: string;
  isVoid: boolean;
  isDraft: boolean;
  poDate: string | null;
  expectedDate: string | null;
  paymentTerms: string | null;
  currency: string;
  vendor: PoViewAddress; // the manufacturer
  shipTo: PoViewAddress; // Aurum's own address
  lines: PoViewLine[];
  subtotal: number;
  shipping: number;
  fees: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null; // manufacturing instructions / PO notes
  footer: string | null;
};

type Addr = Record<string, unknown> | null | undefined;

export function addressLines(a: Addr): string[] {
  const o = (a ?? {}) as Record<string, string | undefined>;
  const l1 = [o.line1, o.line2].filter(Boolean).join(", ");
  const l2 = [o.city, o.region, o.postal_code].filter(Boolean).join(" ");
  return [l1, l2, o.country ?? ""].map((s) => (s ?? "").trim()).filter(Boolean);
}

function composeDescription(name: string, strength?: string | null, pack?: string | null): string {
  return [name, strength, pack].filter(Boolean).join(" · ");
}

export type PoHeaderInput = {
  po_number: string;
  status: string;
  po_date: string | null; // sent_at date or created_at
  expected_date: string | null;
  payment_terms: string | null;
  currency: string;
  subtotal: number;
  shipping: number;
  fees: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  notes: string | null;
  manufacturer_snapshot: Record<string, unknown> | null;
};

export type PoItemInput = {
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  manufacturer_sku: string | null;
  manufacturer_description: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
};

export type PoSettingsInput = {
  company_name: string;
  address: Record<string, unknown> | null;
  contact_email: string | null;
  contact_phone: string | null;
  po_footer: string | null;
};

export function buildPurchaseOrderViewModel(
  header: PoHeaderInput,
  items: PoItemInput[],
  settings: PoSettingsInput,
): PurchaseOrderViewModel {
  const snap = (header.manufacturer_snapshot ?? {}) as Record<string, unknown>;
  const vendorName = (snap.name as string | undefined) ?? null;
  const vendorLines = addressLines(snap.address as Addr);
  const vendorContact: string[] = [];
  if (snap.contact_name) vendorContact.push(String(snap.contact_name));
  if (snap.email) vendorContact.push(String(snap.email));
  if (snap.phone) vendorContact.push(String(snap.phone));

  return {
    company: {
      name: settings.company_name,
      lines: addressLines(settings.address),
      email: settings.contact_email,
      phone: settings.contact_phone,
    },
    poNumber: header.po_number,
    status: header.status,
    isVoid: header.status === "void",
    isDraft: header.status === "draft",
    poDate: header.po_date,
    expectedDate: header.expected_date,
    paymentTerms: header.payment_terms,
    currency: header.currency || "USD",
    vendor: { name: vendorName, lines: [...vendorLines, ...vendorContact] },
    shipTo: { name: settings.company_name, lines: addressLines(settings.address) },
    lines: items.map((it) => ({
      sku: it.sku,
      manufacturerSku: it.manufacturer_sku,
      description: it.manufacturer_description
        ? composeDescription(it.product_name, it.strength, it.pack_size) + ` — ${it.manufacturer_description}`
        : composeDescription(it.product_name, it.strength, it.pack_size),
      quantity: Number(it.quantity),
      unitCost: Number(it.unit_cost),
      lineTotal: Number(it.line_total),
    })),
    subtotal: Number(header.subtotal),
    shipping: Number(header.shipping),
    fees: Number(header.fees),
    tax: Number(header.tax),
    total: Number(header.total),
    amountPaid: Number(header.amount_paid),
    balanceDue: Number(header.balance_due),
    notes: header.notes,
    footer: settings.po_footer,
  };
}
