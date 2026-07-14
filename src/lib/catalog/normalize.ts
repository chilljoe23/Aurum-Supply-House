import { CATALOG_FIELDS, type CatalogFieldKey } from "./fields";
import type { ColumnMapping } from "./mapping";

// A single spreadsheet row keyed by raw header text.
export type RawRow = Record<string, unknown>;

export type NormalizedRow = {
  rowNumber: number;
  sku: string | null;
  name: string | null;
  description: string | null;
  strength: string | null;
  product_form: string | null;
  pack_size: string | null;
  unit_of_measure: string | null;
  manufacturer: string | null; // name; resolved to id server-side
  manufacturer_sku: string | null;
  category: string | null;
  true_cost: number | null;
  currency: string;
  moq: number | null;
  lead_time_days: number | null;
  notes: string | null;
  active: boolean;
  isBlank: boolean;
  errors: string[];
  warnings: string[];
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function looksLikeFormula(v: unknown): boolean {
  return typeof v === "string" && v.trim().startsWith("=");
}

// Parse a monetary value tolerantly: strips $, commas, spaces. Rejects
// formulas, blanks-as-error handled by caller, and non-numeric/date-like text.
function parseCost(v: unknown): { value: number | null; error?: string } {
  if (v === null || v === undefined || String(v).trim() === "")
    return { value: null };
  if (looksLikeFormula(v))
    return { value: null, error: "Unsupported formula in cost cell" };
  if (v instanceof Date)
    return { value: null, error: "Unexpected date format in cost cell" };
  const raw = String(v).trim();
  // Detect date-like text mistakenly in a cost column.
  if (/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(raw))
    return { value: null, error: "Unexpected date format in cost cell" };
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned))
    return { value: null, error: `Invalid cost value: "${raw}"` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: `Invalid cost value: "${raw}"` };
  if (n < 0) return { value: n, error: "Cost cannot be negative" };
  return { value: n };
}

function parseInt0(
  v: unknown,
  label: string,
): { value: number | null; error?: string } {
  const s = str(v);
  if (s === null) return { value: null };
  const cleaned = s.replace(/[,\s]/g, "");
  if (!/^-?\d+$/.test(cleaned))
    return { value: null, error: `Invalid ${label}: "${s}"` };
  const n = Number(cleaned);
  if (n < 0) return { value: null, error: `${label} cannot be negative` };
  return { value: n };
}

const TRUE_WORDS = new Set(["true", "yes", "y", "active", "1", "enabled", "a"]);
const FALSE_WORDS = new Set([
  "false", "no", "n", "inactive", "0", "disabled", "discontinued", "i",
]);

function parseActive(v: unknown): { value: boolean; error?: string } {
  const s = str(v);
  if (s === null) return { value: true }; // default active
  const w = s.toLowerCase();
  if (TRUE_WORDS.has(w)) return { value: true };
  if (FALSE_WORDS.has(w)) return { value: false };
  return { value: true, error: `Invalid active-status value: "${s}"` };
}

// Build a per-field accessor from a raw row + column mapping.
function pick(
  row: RawRow,
  mapping: ColumnMapping,
  key: CatalogFieldKey,
): unknown {
  for (const [header, mapped] of Object.entries(mapping)) {
    if (mapped === key) return row[header];
  }
  return undefined;
}

export type NormalizeOptions = { requireCost: boolean };

export function normalizeRow(
  row: RawRow,
  mapping: ColumnMapping,
  rowNumber: number,
  opts: NormalizeOptions,
): NormalizedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const sku = str(pick(row, mapping, "sku"));
  const name = str(pick(row, mapping, "name"));

  const cost = parseCost(pick(row, mapping, "true_cost"));
  if (cost.error) errors.push(cost.error);

  const moq = parseInt0(pick(row, mapping, "moq"), "MOQ");
  if (moq.error) errors.push(moq.error);

  const lead = parseInt0(pick(row, mapping, "lead_time_days"), "lead time");
  if (lead.error) errors.push(lead.error);

  // Currency has no dedicated import column in Phase 1; defaults to USD.
  // (Multi-currency imports are a later addition — the schema already supports it.)
  const currency = "USD";

  const active = parseActive(pick(row, mapping, "active"));
  if (active.error) errors.push(active.error);

  const values: Omit<NormalizedRow, "isBlank" | "errors" | "warnings"> = {
    rowNumber,
    sku,
    name,
    description: str(pick(row, mapping, "description")),
    strength: str(pick(row, mapping, "strength")),
    product_form: str(pick(row, mapping, "product_form")),
    pack_size: str(pick(row, mapping, "pack_size")),
    unit_of_measure: str(pick(row, mapping, "unit_of_measure")),
    manufacturer: str(pick(row, mapping, "manufacturer")),
    manufacturer_sku: str(pick(row, mapping, "manufacturer_sku")),
    category: str(pick(row, mapping, "category")),
    true_cost: cost.value,
    currency,
    moq: moq.value,
    lead_time_days: lead.value,
    notes: str(pick(row, mapping, "notes")),
    active: active.value,
  };

  // Blank row: nothing meaningful mapped.
  const isBlank =
    !sku &&
    !name &&
    values.description === null &&
    values.true_cost === null &&
    values.strength === null &&
    values.manufacturer === null;

  if (!isBlank) {
    if (!sku) errors.push("Missing required field: SKU");
    if (!name) errors.push("Missing required field: Product Name");
    if (opts.requireCost && values.true_cost === null && !cost.error)
      errors.push("Missing required field: True Cost");
  }

  return { ...values, isBlank, errors, warnings };
}

export function normalizeRows(
  rows: RawRow[],
  mapping: ColumnMapping,
  opts: NormalizeOptions,
  headerOffset = 2, // first data row is spreadsheet row 2 by default
): NormalizedRow[] {
  return rows.map((r, i) => normalizeRow(r, mapping, i + headerOffset, opts));
}

export const _fieldKeys = CATALOG_FIELDS.map((f) => f.key);
