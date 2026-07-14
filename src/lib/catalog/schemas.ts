import { z } from "zod";

// Shared Zod schemas — used by BOTH the manual Add/Edit Product forms and the
// server-side import commit, so the two paths validate identically.

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const productBaseSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(120),
  name: z.string().trim().min(1, "Product name is required").max(300),
  description: optionalTrimmed,
  strength: optionalTrimmed,
  product_form: optionalTrimmed,
  pack_size: optionalTrimmed,
  unit_of_measure: optionalTrimmed,
  manufacturer_id: z.string().uuid().optional().nullable(),
  manufacturer_sku: optionalTrimmed,
  category: optionalTrimmed,
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code")
    .default("USD"),
  moq: z.coerce.number().int("MOQ must be a whole number").min(0, "MOQ cannot be negative").optional().nullable(),
  lead_time_days: z.coerce.number().int().min(0, "Lead time cannot be negative").optional().nullable(),
  notes: optionalTrimmed,
  active: z.boolean().default(true),
});

// Manual product create — cost optional; when present must be >= 0.
export const productCreateSchema = productBaseSchema.extend({
  true_cost: z.coerce.number().min(0, "Cost cannot be negative").optional().nullable(),
});

// Manual product edit — a cost change requires a reason (enforced downstream).
export const productEditSchema = productBaseSchema.extend({
  true_cost: z.coerce.number().min(0, "Cost cannot be negative").optional().nullable(),
  cost_change_reason: optionalTrimmed,
});

export const manufacturerSchema = z.object({
  name: z.string().trim().min(1, "Manufacturer name is required").max(300),
  legal_name: optionalTrimmed,
  contact_name: optionalTrimmed,
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  phone: optionalTrimmed,
  payment_terms: z
    .enum(["due_on_receipt", "net_15", "net_30", "net_45", "net_60", "custom"])
    .optional(),
  default_currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .default("USD"),
  notes: optionalTrimmed,
  active: z.boolean().default(true),
});

// A single resolved import row as sent to the commit RPC.
export const importRowSchema = z.object({
  row_number: z.number().int(),
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  strength: z.string().nullish(),
  product_form: z.string().nullish(),
  pack_size: z.string().nullish(),
  unit_of_measure: z.string().nullish(),
  manufacturer_id: z.string().uuid().nullish(),
  manufacturer_sku: z.string().nullish(),
  category: z.string().nullish(),
  true_cost: z.number().min(0).nullish(),
  currency: z.string().default("USD"),
  moq: z.number().int().min(0).nullish(),
  lead_time_days: z.number().int().min(0).nullish(),
  notes: z.string().nullish(),
  active: z.boolean().default(true),
  valid: z.boolean(),
  classification: z.string(),
  errors: z.array(z.string()).default([]),
});

export const importCommitSchema = z.object({
  batchId: z.string().uuid(),
  mode: z.enum(["atomic", "valid_only"]),
  rows: z.array(importRowSchema),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductEditInput = z.infer<typeof productEditSchema>;
export type ManufacturerInput = z.infer<typeof manufacturerSchema>;
export type ImportRowInput = z.infer<typeof importRowSchema>;
