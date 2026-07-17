// ============================================================================
// Aurum Supply House — packing-slip view model (customer-facing ONLY)
// ----------------------------------------------------------------------------
// The ONE shape the browser preview and the printable/PDF packing slip both
// render, so the two can never drift. Like the invoice view model, it is built to
// EXCLUDE every internal figure — unit price, line price, invoice total, true
// cost, gross profit, margin, commission, internal expenses, manufacturer cost
// source, internal notes, and pricing-resolution source are simply NOT fields on
// this type, so they cannot leak onto a shipping document. A packing slip shows
// quantities and lot traceability only.
// ============================================================================

import { COMPANY_NAME, COMPANY_LOCATION } from "@/lib/documents/branding";
import { addressLines, type InvoiceViewAddress } from "@/lib/orders/invoice-view-model";

export type PackingSlipViewLine = {
  sku: string;
  description: string; // name + strength + pack size, composed
  quantityOrdered: number;
  quantityThisShipment: number;
  previouslyShipped: number;
  remainingAfter: number;
  lotNumber: string | null;
  expirationDate: string | null;
  retestDate: string | null;
};

export type PackingSlipViewModel = {
  company: { name: string; location: string; logoPath: string | null };
  packingSlipNumber: string; // PS-####  (the shipment number)
  shipmentDate: string | null;
  orderNumber: string; // the invoice/order number
  isVoid: boolean; // the shipment was voided/corrected
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  customerReference: string | null; // customer PO / reference, when present
  billTo: InvoiceViewAddress;
  shipTo: InvoiceViewAddress;
  lines: PackingSlipViewLine[];
  footer: string;
};

function composeDescription(name: string, strength?: string | null, pack?: string | null): string {
  return [name, strength, pack].filter(Boolean).join(" · ");
}

type Addr = Record<string, unknown> | null | undefined;

export type PackingSlipHeaderInput = {
  invoice_number: string;
  client_snapshot: Record<string, unknown> | null;
};

export type PackingSlipShipmentInput = {
  shipment_number: string;
  shipment_date: string | null;
  status: string;
  carrier: string | null;
  service: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
};

// A line in THIS shipment, plus the ordered/previously-shipped context needed to
// compute remaining-after. All inputs are already customer-safe (from the
// row-scoped fulfillment views).
export type PackingSlipLineInput = {
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  quantity_ordered: number;
  quantity_this_shipment: number;
  previously_shipped: number;
  lot_number: string | null;
  expiration_date: string | null;
  retest_date: string | null;
};

export type PackingSlipSettingsInput = {
  company_name: string;
  logo_path: string | null;
};

export function buildPackingSlipViewModel(
  header: PackingSlipHeaderInput,
  shipment: PackingSlipShipmentInput,
  lines: PackingSlipLineInput[],
  settings: PackingSlipSettingsInput,
): PackingSlipViewModel {
  const snap = (header.client_snapshot ?? {}) as Record<string, unknown>;
  const company = snap.company_name as string | undefined;
  const billing = snap.billing_address as Addr;
  const shipping = snap.shipping_address as Addr;
  const shipLines = addressLines(shipping);
  // Only a genuine, present customer reference is shown (never invented).
  const reference =
    (snap.customer_po as string | undefined) ??
    (snap.purchase_order as string | undefined) ??
    (snap.reference as string | undefined) ??
    null;

  return {
    company: {
      name: settings.company_name || COMPANY_NAME,
      location: COMPANY_LOCATION,
      logoPath: settings.logo_path,
    },
    packingSlipNumber: shipment.shipment_number,
    shipmentDate: shipment.shipment_date,
    orderNumber: header.invoice_number,
    isVoid: shipment.status === "void",
    carrier: shipment.carrier,
    service: shipment.service,
    trackingNumber: shipment.tracking_number,
    trackingUrl: shipment.tracking_url,
    customerReference: reference && String(reference).trim() ? String(reference).trim() : null,
    billTo: { name: company ?? null, lines: addressLines(billing) },
    shipTo: { name: company ?? null, lines: shipLines.length ? shipLines : addressLines(billing) },
    lines: lines.map((l) => {
      const ordered = Number(l.quantity_ordered);
      const thisShip = Number(l.quantity_this_shipment);
      const prev = Number(l.previously_shipped);
      const remainingAfter = Math.max(0, ordered - prev - thisShip);
      return {
        sku: l.sku,
        description: composeDescription(l.product_name, l.strength, l.pack_size),
        quantityOrdered: ordered,
        quantityThisShipment: thisShip,
        previouslyShipped: prev,
        remainingAfter,
        lotNumber: l.lot_number ?? null,
        expirationDate: l.expiration_date ?? null,
        retestDate: l.retest_date ?? null,
      };
    }),
    footer: `Thank you for your business — ${COMPANY_NAME}.`,
  };
}
