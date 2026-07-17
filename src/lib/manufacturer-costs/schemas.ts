import { z } from "zod";

const opt = z.string().trim().optional().transform((v) => (v === "" ? undefined : v));
const dateOpt = z
  .string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional().or(z.literal(""))
  .transform((v) => (v ? v : undefined));
// Empty string / null → null; otherwise coerce to an integer.
const intOpt = (min: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int().min(min).nullable(),
  );

// Manual cost-band set/edit (append-only via RPC; reason required).
export const manufacturerCostSchema = z
  .object({
    manufacturer_product_id: z.string().uuid(),
    min_quantity: z.coerce.number().int().min(1).default(1),
    max_quantity: intOpt(1),
    unit_cost: z.coerce.number().gt(0, "Cost must be greater than zero"),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
    effective_date: dateOpt,
    expiration_date: dateOpt,
    active: z.boolean().default(true),
    reason: z.string().trim().min(1, "A reason is required"),
  })
  .refine((v) => v.max_quantity == null || v.max_quantity >= v.min_quantity, {
    message: "Maximum quantity must be ≥ minimum", path: ["max_quantity"],
  });

// Create / edit a manufacturer-product supply relationship (non-cost terms).
export const manufacturerProductSchema = z.object({
  manufacturer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  manufacturer_sku: opt,
  manufacturer_description: opt,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter code").default("USD"),
  moq: intOpt(0),
  order_multiple: intOpt(1),
  lead_time_days: intOpt(0),
  active: z.boolean().default(true),
  notes: opt,
});

// Promote a manufacturer's current base cost to the catalog's true cost.
export const promoteCostSchema = z.object({
  manufacturer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
  effective_date: dateOpt,
  set_preferred: z.boolean().default(true),
});

export type ManufacturerCostInput = z.infer<typeof manufacturerCostSchema>;
export type ManufacturerProductInput = z.infer<typeof manufacturerProductSchema>;
export type PromoteCostInput = z.infer<typeof promoteCostSchema>;
