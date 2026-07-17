import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/orders/schemas";

// Shared validation for the commission builder + every commission server action,
// so the client form and the server enforce the same rules. The database
// re-derives the commission amount from the invoice's frozen economics; the
// client sends only the inputs (type, rate, units, recipient).

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const uuidOpt = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().uuid().optional());

const emailOpt = z
  .string()
  .trim()
  .email("Enter a valid email")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

const dateOpt = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const COMMISSION_TYPES = [
  "percent_of_sale",
  "percent_of_gross_profit",
  "flat",
  "per_unit",
] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export const COMMISSION_TYPE_OPTIONS: { value: CommissionType; label: string; hint: string }[] = [
  { value: "percent_of_sale", label: "% of sales", hint: "Percent of the invoice subtotal" },
  { value: "percent_of_gross_profit", label: "% of gross profit", hint: "Percent of the invoice gross profit" },
  { value: "flat", label: "Fixed amount", hint: "A flat dollar commission" },
  { value: "per_unit", label: "Per unit", hint: "A dollar amount per unit sold" },
];

export const RECIPIENT_TYPES = ["internal_user", "external_partner"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const COMMISSION_STATUSES = ["pending", "earned", "approved", "paid", "void"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  earned: "Earned",
  approved: "Approved",
  paid: "Paid",
  void: "Void",
};

// Rate is stored in canonical form: a fraction (0.05 = 5%) for percent types, and
// a dollar amount for flat / per_unit. The dialog converts a percent field to a
// fraction before submitting.
const rateNum = z.coerce.number().min(0, "Cannot be negative").max(100_000_000, "Too large");
const unitsNum = z.coerce.number().min(0, "Cannot be negative").max(100_000_000).optional();

const recipientShape = {
  recipient_type: z.enum(RECIPIENT_TYPES),
  recipient_id: uuidOpt,
  recipient_name: z.string().trim().min(1, "A recipient name is required").max(200),
  recipient_email: emailOpt,
  recipient_company: opt,
  payment_notes: opt,
  commission_type: z.enum(COMMISSION_TYPES),
  rate: rateNum,
  units: unitsNum,
  note: opt,
};

function refineRecipient(v: {
  recipient_type: RecipientType;
  recipient_id?: string;
  commission_type: CommissionType;
  rate: number;
  units?: number;
}, ctx: z.RefinementCtx) {
  if (v.recipient_type === "internal_user" && !v.recipient_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipient_id"], message: "Select an internal user" });
  }
  if (v.recipient_type === "external_partner" && v.recipient_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recipient_id"], message: "External partners have no internal user" });
  }
  if (v.commission_type === "flat" && v.rate <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate"], message: "A fixed amount must be greater than zero" });
  }
  if (v.commission_type === "per_unit" && !(v.units && v.units > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["units"], message: "Enter a unit quantity greater than zero" });
  }
  if ((v.commission_type === "percent_of_sale" || v.commission_type === "percent_of_gross_profit") && v.rate > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate"], message: "Enter a percentage as a fraction (0–1)" });
  }
}

export const commissionCreateSchema = z
  .object({ invoice_id: z.string().uuid(), ...recipientShape })
  .superRefine(refineRecipient);
export type CommissionCreateInput = z.infer<typeof commissionCreateSchema>;

export const commissionUpdateSchema = z
  .object({ commission_id: z.string().uuid(), ...recipientShape })
  .superRefine(refineRecipient);
export type CommissionUpdateInput = z.infer<typeof commissionUpdateSchema>;

export const commissionApproveSchema = z.object({ commission_id: z.string().uuid() });

export const commissionPaySchema = z.object({
  commission_id: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS).default("wire"),
  reference: opt,
  note: opt,
  paid_at: dateOpt,
});
export type CommissionPayInput = z.infer<typeof commissionPaySchema>;

export const commissionVoidSchema = z.object({
  commission_id: z.string().uuid(),
  reason: opt,
});

export const commissionBulkApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one commission"),
});

export const commissionBulkPaySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one commission"),
  method: z.enum(PAYMENT_METHODS).default("wire"),
  reference: opt,
  note: opt,
});

export const commissionPreviewSchema = z.object({
  invoice_id: z.string().uuid(),
  commission_type: z.enum(COMMISSION_TYPES),
  rate: rateNum,
  units: unitsNum,
});
