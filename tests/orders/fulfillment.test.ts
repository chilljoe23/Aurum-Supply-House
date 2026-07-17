// Unit tests for the fulfillment derivation rules and the customer-safe
// packing-slip view model. Run: npm test  (node:test + TypeScript type-stripping —
// no new deps.)
//
// These mirror the authoritative SQL in
// supabase/migrations/0398_fulfillment_views.sql and prove (1) line/order status
// is derived deterministically from quantities, and (2) the packing slip cannot
// carry any pricing / cost / profit / commission data.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveLineStatus,
  deriveOrderStatus,
  type LineFacts,
} from "../../src/lib/orders/fulfillment.ts";
import { buildPackingSlipViewModel } from "../../src/lib/orders/packing-slip-view-model.ts";

// ---- Per-line derivation ----------------------------------------------------

test("line: zero shipped resolves to the operational status", () => {
  for (const s of ["not_yet_shipped", "in_production", "ready_to_ship", "backordered", "cancelled"] as const) {
    assert.equal(deriveLineStatus({ operationalStatus: s, quantityOrdered: 10, quantityShipped: 0 }), s);
  }
});

test("line: 0 < shipped < ordered resolves to partially_shipped", () => {
  assert.equal(deriveLineStatus({ operationalStatus: "ready_to_ship", quantityOrdered: 10, quantityShipped: 4 }), "partially_shipped");
  assert.equal(deriveLineStatus({ operationalStatus: "not_yet_shipped", quantityOrdered: 3, quantityShipped: 1 }), "partially_shipped");
});

test("line: shipped == ordered resolves to shipped (and shipped>=ordered clamps to shipped)", () => {
  assert.equal(deriveLineStatus({ operationalStatus: "not_yet_shipped", quantityOrdered: 5, quantityShipped: 5 }), "shipped");
  assert.equal(deriveLineStatus({ operationalStatus: "in_production", quantityOrdered: 5, quantityShipped: 5 }), "shipped");
});

test("line: independent statuses coexist within one order", () => {
  const lines: LineFacts[] = [
    { operationalStatus: "not_yet_shipped", quantityOrdered: 4, quantityShipped: 4 }, // shipped
    { operationalStatus: "in_production", quantityOrdered: 2, quantityShipped: 0 }, // in_production
    { operationalStatus: "not_yet_shipped", quantityOrdered: 6, quantityShipped: 0 }, // not_yet_shipped
    { operationalStatus: "not_yet_shipped", quantityOrdered: 10, quantityShipped: 3 }, // partially_shipped
  ];
  assert.deepEqual(lines.map(deriveLineStatus), ["shipped", "in_production", "not_yet_shipped", "partially_shipped"]);
});

// ---- Per-order derivation ---------------------------------------------------

test("order: nothing shipped and nothing active → not_started", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "not_yet_shipped", quantityOrdered: 5, quantityShipped: 0 },
      { operationalStatus: "not_yet_shipped", quantityOrdered: 3, quantityShipped: 0 },
    ]),
    "not_started",
  );
});

test("order: a line in production (no shipment yet) → in_progress", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "in_production", quantityOrdered: 5, quantityShipped: 0 },
      { operationalStatus: "not_yet_shipped", quantityOrdered: 3, quantityShipped: 0 },
    ]),
    "in_progress",
  );
  assert.equal(
    deriveOrderStatus([{ operationalStatus: "backordered", quantityOrdered: 5, quantityShipped: 0 }]),
    "in_progress",
  );
});

test("order: something shipped with a shippable remainder → partially_shipped", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "not_yet_shipped", quantityOrdered: 10, quantityShipped: 4 },
      { operationalStatus: "not_yet_shipped", quantityOrdered: 5, quantityShipped: 0 },
    ]),
    "partially_shipped",
  );
});

test("order: every non-cancelled quantity shipped → fully_shipped", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "not_yet_shipped", quantityOrdered: 4, quantityShipped: 4 },
      { operationalStatus: "not_yet_shipped", quantityOrdered: 6, quantityShipped: 6 },
    ]),
    "fully_shipped",
  );
});

test("order: a shipped line plus a fully-cancelled line → fully_shipped", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "not_yet_shipped", quantityOrdered: 4, quantityShipped: 4 },
      { operationalStatus: "cancelled", quantityOrdered: 6, quantityShipped: 0 },
    ]),
    "fully_shipped",
  );
});

test("order: all lines cancelled → cancelled", () => {
  assert.equal(
    deriveOrderStatus([
      { operationalStatus: "cancelled", quantityOrdered: 4, quantityShipped: 0 },
      { operationalStatus: "cancelled", quantityOrdered: 6, quantityShipped: 0 },
    ]),
    "cancelled",
  );
});

test("order: empty line set → not_started", () => {
  assert.equal(deriveOrderStatus([]), "not_started");
});

// ---- Packing slip: customer-safe field set ----------------------------------

const HEADER = {
  invoice_number: "AUR-1001",
  client_snapshot: {
    company_name: "Acme Labs",
    billing_address: { line1: "1 Main St", city: "Sarasota", region: "FL", postal_code: "34236", country: "USA" },
    shipping_address: { line1: "9 Dock Rd", city: "Tampa", region: "FL", postal_code: "33602", country: "USA" },
    // Bait: internal figures that might live on a snapshot must NEVER surface.
    total: 99999,
    gross_profit: 4242,
    true_cost: 1111,
  },
};
const SHIPMENT = {
  shipment_number: "PS-1001",
  shipment_date: "2026-07-17",
  status: "finalized",
  carrier: "FedEx",
  service: "Priority Overnight",
  tracking_number: "123456789",
  tracking_url: "https://track/123456789",
};
const LINES = [
  {
    sku: "SKU-1",
    product_name: "Widget",
    strength: "10mg",
    pack_size: "10ct",
    quantity_ordered: 10,
    quantity_this_shipment: 4,
    previously_shipped: 3,
    lot_number: "LOT-9",
    expiration_date: "2027-01-01",
    retest_date: null,
  },
];

test("packing slip: remaining-after is ordered − previously − this shipment (never negative)", () => {
  const m = buildPackingSlipViewModel(HEADER, SHIPMENT, LINES, { company_name: "Aurum Supply House", logo_path: null });
  assert.equal(m.lines[0].remainingAfter, 3); // 10 − 3 − 4
  const over = buildPackingSlipViewModel(
    HEADER,
    SHIPMENT,
    [{ ...LINES[0], previously_shipped: 8, quantity_this_shipment: 5 }],
    { company_name: "Aurum Supply House", logo_path: null },
  );
  assert.equal(over.lines[0].remainingAfter, 0); // clamped, never negative
});

test("packing slip: model exposes NO pricing/cost/profit/commission surface", () => {
  const m = buildPackingSlipViewModel(HEADER, SHIPMENT, LINES, { company_name: "Aurum Supply House", logo_path: null });
  const flat = JSON.stringify(m).toLowerCase();
  for (const banned of [
    "unit_price",
    "unitprice",
    "line_total",
    "linetotal",
    "subtotal",
    "true_cost",
    "truecost",
    "gross_profit",
    "grossprofit",
    "net_profit",
    "margin",
    "commission",
    "expense",
    "99999", // the bait total
    "4242", // the bait gross profit
    "1111", // the bait true cost
  ]) {
    assert.equal(flat.includes(banned), false, `packing slip must not expose "${banned}"`);
  }
});

test("packing slip: exact customer-safe key allow-lists (top level + per line)", () => {
  const m = buildPackingSlipViewModel(HEADER, SHIPMENT, LINES, { company_name: "Aurum Supply House", logo_path: null });
  assert.deepEqual(
    Object.keys(m).sort(),
    [
      "billTo",
      "carrier",
      "company",
      "customerReference",
      "footer",
      "isVoid",
      "lines",
      "orderNumber",
      "packingSlipNumber",
      "service",
      "shipTo",
      "shipmentDate",
      "trackingNumber",
      "trackingUrl",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(m.lines[0]).sort(),
    [
      "description",
      "expirationDate",
      "lotNumber",
      "previouslyShipped",
      "quantityOrdered",
      "quantityThisShipment",
      "remainingAfter",
      "retestDate",
      "sku",
    ].sort(),
  );
});

test("packing slip: footer is the fixed customer-facing thank-you", () => {
  const m = buildPackingSlipViewModel(HEADER, SHIPMENT, LINES, { company_name: "Aurum Supply House", logo_path: null });
  assert.equal(m.footer, "Thank you for your business — Aurum Supply House.");
});
