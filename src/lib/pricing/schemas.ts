import { z } from "zod";

const opt = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const dateOpt = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().or(z.literal("")).transform((v) => (v ? v : undefined));

export const pricingModelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: opt,
  description: opt,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
  effective_date: dateOpt,
  expiration_date: dateOpt,
  is_default: z.boolean().default(false),
  notes: opt,
  active: z.boolean().default(true),
});

export const priceItemSchema = z.object({
  pricing_sheet_id: z.string().uuid(),
  product_id: z.string().uuid(),
  min_quantity: z.coerce.number().int().min(1).default(1),
  max_quantity: z.coerce.number().int().min(1).optional().nullable(),
  selling_price: z.coerce.number().gt(0, "Price must be greater than zero"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default("USD"),
  effective_date: dateOpt,
  expiration_date: dateOpt,
  active: z.boolean().default(true),
  notes: opt,
  reason: z.string().trim().min(1, "A reason is required"),
}).refine((v) => v.max_quantity == null || v.max_quantity >= v.min_quantity, {
  message: "Maximum quantity must be ≥ minimum", path: ["max_quantity"],
});

export const overrideSchema = z.object({
  client_id: z.string().uuid(),
  product_id: z.string().uuid(),
  min_quantity: z.coerce.number().int().min(1).default(1),
  max_quantity: z.coerce.number().int().min(1).optional().nullable(),
  selling_price: z.coerce.number().gt(0, "Price must be greater than zero"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default("USD"),
  effective_date: dateOpt,
  expiration_date: dateOpt,
  active: z.boolean().default(true),
  reason: z.string().trim().min(1, "A reason is required"),
  notes: opt,
});

export const assignmentSchema = z.object({
  client_id: z.string().uuid(),
  pricing_sheet_id: z.string().uuid(),
  effective_date: dateOpt,
  expiration_date: dateOpt,
  notes: opt,
});

export const bulkAdjustSchema = z.object({
  pricing_sheet_id: z.string().uuid(),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number(),
  product_ids: z.array(z.string().uuid()).nullable().default(null),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type PricingModelInput = z.infer<typeof pricingModelSchema>;
export type PriceItemInput = z.infer<typeof priceItemSchema>;
export type OverrideInput = z.infer<typeof overrideSchema>;
