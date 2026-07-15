import { z } from "zod";

// Shared validation for the PO builder + every purchasing server action, so the
// client form and the server enforce the same rules. The database re-derives all
// persisted money; these bounds are a first line of defense only.

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

// ---- Manufacturer payment types --------------------------------------------
export const MFR_PAYMENT_TYPES = ["deposit", "balance", "additional", "refund_credit"] as const;
export const MFR_PAYMENT_TYPE_OPTIONS: { value: (typeof MFR_PAYMENT_TYPES)[number]; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "balance", label: "Balance" },
  { value: "additional", label: "Additional payment" },
  { value: "refund_credit", label: "Refund / credit" },
];

export const PAYMENT_METHODS = ["wire", "ach", "check", "card", "cash", "other"] as const;
export const PAYMENT_METHOD_OPTIONS: { value: (typeof PAYMENT_METHODS)[number]; label: string }[] = [
  { value: "wire", label: "Wire" },
  { value: "ach", label: "ACH" },
  { value: "check", label: "Check" },
  { value: "card", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

// ---- Attachment categories (map to po_attachment_type enum) -----------------
export const ATTACHMENT_CATEGORIES = [
  "manufacturer_invoice",
  "coa",
  "packing_list",
  "testing_document",
  "shipping_document",
  "tracking",
  "other",
] as const;
export const ATTACHMENT_CATEGORY_OPTIONS: { value: (typeof ATTACHMENT_CATEGORIES)[number]; label: string }[] = [
  { value: "manufacturer_invoice", label: "Manufacturer invoice" },
  { value: "coa", label: "COA" },
  { value: "packing_list", label: "Packing list" },
  { value: "testing_document", label: "Testing document" },
  { value: "shipping_document", label: "Shipping document" },
  { value: "tracking", label: "Tracking" },
  { value: "other", label: "General attachment" },
];

// ---- PO line ----------------------------------------------------------------
export const poLineSchema = z
  .object({
    product_id: z.string().uuid("Select a product"),
    quantity: z.coerce.number().gt(0, "Quantity must be greater than zero").max(10_000_000),
    // Manual cost is the fallback ONLY when the resolver cannot resolve a cost;
    // when present a reason is mandatory.
    manual_cost: z.coerce.number().gt(0, "Manual cost must be greater than zero").optional().nullable(),
    manual_reason: opt,
    notes: opt,
  })
  .refine((v) => v.manual_cost == null || (v.manual_reason && v.manual_reason.length > 0), {
    message: "A manual cost requires a reason",
    path: ["manual_reason"],
  });

// ---- Draft (create / update) ------------------------------------------------
export const poDraftSchema = z.object({
  po_id: uuidOpt,
  manufacturer_id: z.string().uuid("Select a manufacturer"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
  shipping: money(),
  fees: money(),
  tax: money(),
  expected_date: dateOpt,
  payment_terms: opt,
  notes: opt,
  lines: z.array(poLineSchema).default([]),
});
export type PoDraftInput = z.infer<typeof poDraftSchema>;
export type PoLineInput = z.infer<typeof poLineSchema>;

// ---- Send / transition / void -----------------------------------------------
export const sendPoSchema = z.object({ po_id: z.string().uuid() });

export const transitionPoSchema = z.object({
  po_id: z.string().uuid(),
  to: z.enum([
    "sent",
    "confirmed",
    "deposit_paid",
    "production",
    "testing",
    "ready_to_ship",
    "shipped",
    "received",
    "closed",
  ]),
  note: opt,
});

export const voidPoSchema = z.object({
  po_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required to void a purchase order").max(500),
});

// ---- Manufacturer payment ---------------------------------------------------
export const mfrPaymentSchema = z.object({
  po_id: z.string().uuid(),
  type: z.enum(MFR_PAYMENT_TYPES).default("deposit"),
  amount: z.coerce.number().gt(0, "Amount must be greater than zero"),
  payment_date: dateOpt,
  method: z.enum(PAYMENT_METHODS).default("wire"),
  reference: opt,
  notes: opt,
});
export type MfrPaymentInput = z.infer<typeof mfrPaymentSchema>;

// ---- Attachment (metadata; the file is uploaded to private storage first) ---
export const poAttachmentSchema = z.object({
  po_id: z.string().uuid(),
  type: z.enum(ATTACHMENT_CATEGORIES).default("other"),
  filename: z.string().trim().min(1, "A filename is required").max(300),
  storage_path: z.string().trim().min(1),
  file_type: opt,
  size_bytes: z.coerce.number().int().min(0).optional().nullable(),
  note: opt,
});

// ---- Tracking / shipment ----------------------------------------------------
export const poShipmentSchema = z.object({
  po_id: z.string().uuid(),
  carrier: opt,
  tracking_number: opt,
  ship_date: dateOpt,
  expected_arrival_date: dateOpt,
  received_date: dateOpt,
  notes: opt,
});

// ---- Receiving --------------------------------------------------------------
export const receivePoLineSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.coerce.number().gt(0, "Quantity must be greater than zero"),
  received_date: dateOpt,
  lot_number: opt,
  notes: opt,
  shipment_id: uuidOpt,
});
