import { z } from "zod";
import { PAYMENT_TERMS } from "@/lib/clients/schemas";

// Shared validation for the quote builder + every quote server action, so the
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

// ---- Line item --------------------------------------------------------------
export const lineItemSchema = z
  .object({
    product_id: z.string().uuid("Select a product"),
    quantity: z.coerce.number().gt(0, "Quantity must be greater than zero").max(10_000_000),
    // A manual override is optional; when present a reason is mandatory (admin-only server-side).
    manual_price: z.coerce.number().gt(0, "Override price must be greater than zero").optional().nullable(),
    manual_reason: opt,
  })
  .refine((v) => v.manual_price == null || (v.manual_reason && v.manual_reason.length > 0), {
    message: "A manual price override requires a reason",
    path: ["manual_reason"],
  });

// ---- Draft (create / update) ------------------------------------------------
export const quoteDraftSchema = z.object({
  quote_id: uuidOpt,
  client_id: z.string().uuid("Select a client"),
  selected_model_id: uuidOpt,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
  shipping: money(),
  fees: money(),
  discount: money(),
  tax_rate: z.coerce.number().min(0, "Cannot be negative").max(1, "Enter tax as a fraction (0–1)").default(0),
  payment_terms: z.enum(PAYMENT_TERMS).default("net_30"),
  customer_reference: opt,
  quote_date: dateOpt,
  expiration_date: dateOpt,
  notes: opt,
  lines: z.array(lineItemSchema).default([]),
});
export type QuoteDraftInput = z.infer<typeof quoteDraftSchema>;
export type LineItemInput = z.infer<typeof lineItemSchema>;

// ---- Send -------------------------------------------------------------------
export const sendSchema = z.object({ quote_id: z.string().uuid() });

// ---- Lifecycle transition (accept / decline / expire) -----------------------
export const transitionSchema = z.object({
  quote_id: z.string().uuid(),
  to: z.enum(["accepted", "declined", "expired"]),
  note: opt,
});

// ---- Void -------------------------------------------------------------------
export const voidSchema = z.object({
  quote_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required to void a quote").max(500),
});

// ---- Duplicate --------------------------------------------------------------
export const duplicateSchema = z.object({
  quote_id: z.string().uuid(),
  retain_prices: z.coerce.boolean().default(false),
});

// ---- Convert to order -------------------------------------------------------
export const convertSchema = z.object({ quote_id: z.string().uuid() });
