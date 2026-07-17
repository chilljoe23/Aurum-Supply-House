import { z } from "zod";

// Shared validation for the order builder + every order server action, so the
// client form and the server enforce the same rules. Money is validated as
// non-negative fixed-precision; the database re-derives all persisted figures.

const opt = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const uuidOpt = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().uuid().optional());
const dateOpt = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

const money = (max = 100_000_000) =>
  z.coerce.number().min(0, "Cannot be negative").max(max, "Too large").default(0);

export const PAYMENT_METHODS = ["ach", "wire", "check", "card", "cash", "other"] as const;
export const PAYMENT_METHOD_OPTIONS: { value: (typeof PAYMENT_METHODS)[number]; label: string }[] = [
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "check", label: "Check" },
  { value: "card", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export const EXPENSE_TYPES = [
  "outbound_shipping",
  "payment_processing_fee",
  "packaging",
  "testing",
  "referral_expense",
  "other",
] as const;
export const EXPENSE_TYPE_OPTIONS: { value: (typeof EXPENSE_TYPES)[number]; label: string }[] = [
  { value: "outbound_shipping", label: "Outbound shipping (company-paid freight)" },
  { value: "payment_processing_fee", label: "Payment processing fee" },
  { value: "packaging", label: "Packaging" },
  { value: "testing", label: "Testing" },
  { value: "referral_expense", label: "Referral expense" },
  { value: "other", label: "Other" },
];

// ---- Line item --------------------------------------------------------------
export const lineItemSchema = z
  .object({
    product_id: z.string().uuid("Select a product"),
    quantity: z.coerce.number().gt(0, "Quantity must be greater than zero").max(10_000_000),
    // A manual override is optional; when present a reason is mandatory.
    manual_price: z.coerce.number().gt(0, "Override price must be greater than zero").optional().nullable(),
    manual_reason: opt,
    // Optional lot traceability captured on the draft line.
    lot_number: opt,
    manufacturing_date: dateOpt,
    expiration_date: dateOpt,
    retest_date: dateOpt,
  })
  .refine((v) => v.manual_price == null || (v.manual_reason && v.manual_reason.length > 0), {
    message: "A manual price override requires a reason",
    path: ["manual_reason"],
  });

// ---- Draft (create / update) ------------------------------------------------
export const orderDraftSchema = z.object({
  invoice_id: uuidOpt,
  client_id: z.string().uuid("Select a client"),
  selected_model_id: uuidOpt,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
  shipping: money(),
  fees: money(),
  discount: money(),
  tax_rate: z.coerce.number().min(0, "Cannot be negative").max(1, "Enter tax as a fraction (0–1)").default(0),
  notes: opt,
  lines: z.array(lineItemSchema).default([]),
});
export type OrderDraftInput = z.infer<typeof orderDraftSchema>;
export type LineItemInput = z.infer<typeof lineItemSchema>;

// ---- Issue ------------------------------------------------------------------
export const issueSchema = z.object({
  invoice_id: z.string().uuid(),
  issue_date: dateOpt,
  due_date: dateOpt,
});

// ---- Payment ----------------------------------------------------------------
export const paymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().gt(0, "Amount must be greater than zero"),
  method: z.enum(PAYMENT_METHODS).default("wire"),
  reference: opt,
  received_at: dateOpt,
  note: opt,
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// ---- Void -------------------------------------------------------------------
export const voidSchema = z.object({
  invoice_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required to void an invoice").max(500),
});

// ---- Owner-only permanent deletion (Draft/Void only; DB re-verifies) --------
export const deleteOrderSchema = z.object({
  invoice_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A deletion reason is required").max(500),
});

// ---- Lot assignment (post-issue, narrowly scoped + audited) -----------------
export const lotSchema = z.object({
  item_id: z.string().uuid(),
  lot_number: opt,
  manufacturing_date: dateOpt,
  expiration_date: dateOpt,
  retest_date: dateOpt,
});

// ---- Internal expense -------------------------------------------------------
export const expenseSchema = z.object({
  invoice_id: z.string().uuid(),
  type: z.enum(EXPENSE_TYPES).default("other"),
  amount: z.coerce.number().min(0, "Cannot be negative"),
  note: opt,
  incurred_on: dateOpt,
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

// ---- Fulfillment: operational line status (manually settable subset) --------
// "partially_shipped" / "shipped" are deliberately NOT accepted here — they are
// derived from shipment quantities and can never be selected by hand.
export const OPERATIONAL_STATUSES = [
  "not_yet_shipped",
  "in_production",
  "ready_to_ship",
  "backordered",
  "cancelled",
] as const;

export const lineStatusSchema = z.object({
  item_id: z.string().uuid(),
  status: z.enum(OPERATIONAL_STATUSES),
});
export type LineStatusInput = z.infer<typeof lineStatusSchema>;

// ---- Fulfillment: create shipment -------------------------------------------
const shipQty = z.coerce.number().gt(0, "Quantity must be greater than zero").max(10_000_000);

export const shipmentLineSchema = z.object({
  invoice_item_id: z.string().uuid(),
  quantity: shipQty,
  // Optional lot snapshot overrides; when omitted the DB snapshots the line's lot.
  lot_number: opt,
  manufacturing_date: dateOpt,
  expiration_date: dateOpt,
  retest_date: dateOpt,
});

export const shipmentSchema = z.object({
  invoice_id: z.string().uuid(),
  shipment_date: dateOpt,
  carrier: opt,
  service: opt,
  tracking_number: opt,
  tracking_url: opt,
  notes: opt,
  lines: z.array(shipmentLineSchema).min(1, "Select at least one line to ship"),
});
export type ShipmentInput = z.infer<typeof shipmentSchema>;
export type ShipmentLineInput = z.infer<typeof shipmentLineSchema>;

// ---- Fulfillment: void a shipment (audited correction) ----------------------
export const voidShipmentSchema = z.object({
  shipment_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A void reason is required").max(500),
});
