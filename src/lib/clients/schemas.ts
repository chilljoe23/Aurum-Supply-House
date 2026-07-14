import { z } from "zod";

// Shared Zod schemas for the manual Add/Edit Client forms and the create/update
// server actions, so both validate identically (mirrors catalog/pricing schemas).

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// A structured postal address. Every field optional — clients may be created
// with minimal data and completed later. Stored as jsonb on the client row.
export const addressSchema = z.object({
  line1: optionalTrimmed,
  line2: optionalTrimmed,
  city: optionalTrimmed,
  region: optionalTrimmed, // state / province
  postal_code: optionalTrimmed,
  country: optionalTrimmed,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal_code: "",
  country: "",
} as const;

export const PAYMENT_TERMS = [
  "due_on_receipt",
  "net_15",
  "net_30",
  "net_45",
  "net_60",
  "custom",
] as const;

export const CLIENT_STATUSES = ["active", "prospect", "inactive"] as const;

export const PAYMENT_TERMS_OPTIONS: { value: (typeof PAYMENT_TERMS)[number]; label: string }[] = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
  { value: "custom", label: "Custom" },
];

export const CLIENT_STATUS_OPTIONS: { value: (typeof CLIENT_STATUSES)[number]; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "prospect", label: "Prospect" },
  { value: "inactive", label: "Inactive" },
];

// Empty string → undefined so an optional uuid select clears cleanly.
const uuidOptional = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().uuid().optional());

export const clientBaseSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required").max(300),
  primary_contact_name: optionalTrimmed,
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  phone: optionalTrimmed,
  payment_terms: z.enum(PAYMENT_TERMS).default("net_30"),
  status: z.enum(CLIENT_STATUSES).default("active"),
  notes: optionalTrimmed,
  assigned_rep_id: uuidOptional,
  default_pricing_sheet_id: uuidOptional,
  billing_address: addressSchema.default({}),
  shipping_address: addressSchema.default({}),
});

export const clientCreateSchema = clientBaseSchema;
export const clientEditSchema = clientBaseSchema;

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientEditInput = z.infer<typeof clientEditSchema>;
