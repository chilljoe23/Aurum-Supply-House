import type { RawRow } from "@/lib/catalog/normalize";
import type { PricingMapping } from "./mapping";
import type { PricingFieldKey } from "./fields";

export type NormalizedPricingRow = {
  rowNumber: number;
  sku: string | null;
  selling_price: number | null;
  currency: string;
  min_quantity: number;
  max_quantity: number | null;
  effective_date: string | null; // ISO yyyy-mm-dd
  expiration_date: string | null;
  active: boolean;
  notes: string | null;
  isBlank: boolean;
  errors: string[];
};

function pick(row: RawRow, mapping: PricingMapping, key: PricingFieldKey): unknown {
  for (const [h, m] of Object.entries(mapping)) if (m === key) return row[h];
  return undefined;
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

function parsePrice(v: unknown): { value: number | null; error?: string } {
  const s = str(v);
  if (s === null) return { value: null };
  if (s.startsWith("=")) return { value: null, error: "Unsupported formula in price cell" };
  if (/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(s)) return { value: null, error: "Unexpected date in price cell" };
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { value: null, error: `Invalid price: "${s}"` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: `Invalid price: "${s}"` };
  if (n <= 0) return { value: n, error: "Price must be greater than zero" };
  return { value: n };
}

function parseIntQty(v: unknown, label: string): { value: number | null; error?: string } {
  const s = str(v);
  if (s === null) return { value: null };
  const c = s.replace(/[+,\s]/g, "");
  if (!/^\d+$/.test(c)) return { value: null, error: `Invalid ${label}: "${s}"` };
  return { value: Number(c) };
}

function parseDate(v: unknown, label: string): { value: string | null; error?: string } {
  if (v === null || v === undefined || String(v).trim() === "") return { value: null };
  if (v instanceof Date && !isNaN(v.getTime())) return { value: v.toISOString().slice(0, 10) };
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) || s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return { value: null, error: `Invalid ${label} format: "${s}"` };
  let y: string, mo: string, d: string;
  if (m[1].length === 4) { [, y, mo, d] = m; } else { [, mo, d, y] = m; }
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (isNaN(new Date(iso).getTime())) return { value: null, error: `Invalid ${label}: "${s}"` };
  return { value: iso };
}

const TRUE = new Set(["true", "yes", "y", "active", "1", "enabled"]);
const FALSE = new Set(["false", "no", "n", "inactive", "0", "disabled"]);
function parseActive(v: unknown): { value: boolean; error?: string } {
  const s = str(v);
  if (s === null) return { value: true };
  const w = s.toLowerCase();
  if (TRUE.has(w)) return { value: true };
  if (FALSE.has(w)) return { value: false };
  return { value: true, error: `Invalid active-status value: "${s}"` };
}

export function normalizePricingRow(row: RawRow, mapping: PricingMapping, rowNumber: number): NormalizedPricingRow {
  const errors: string[] = [];
  const sku = str(pick(row, mapping, "sku"));

  const price = parsePrice(pick(row, mapping, "selling_price"));
  if (price.error) errors.push(price.error);

  const min = parseIntQty(pick(row, mapping, "min_quantity"), "minimum quantity");
  if (min.error) errors.push(min.error);
  const max = parseIntQty(pick(row, mapping, "max_quantity"), "maximum quantity");
  if (max.error) errors.push(max.error);

  const minQ = min.value ?? 1;
  const maxQ = max.value;
  if (maxQ !== null && maxQ < minQ) errors.push("Maximum quantity is below minimum quantity");

  const eff = parseDate(pick(row, mapping, "effective_date"), "effective date");
  if (eff.error) errors.push(eff.error);
  const exp = parseDate(pick(row, mapping, "expiration_date"), "expiration date");
  if (exp.error) errors.push(exp.error);
  if (eff.value && exp.value && exp.value < eff.value) errors.push("Expiration date is before effective date");

  const currencyRaw = str(pick(row, mapping, "currency"));
  let currency = "USD";
  if (currencyRaw) {
    if (!/^[A-Za-z]{3}$/.test(currencyRaw)) errors.push(`Invalid currency: "${currencyRaw}"`);
    else currency = currencyRaw.toUpperCase();
  }

  const active = parseActive(pick(row, mapping, "active"));
  if (active.error) errors.push(active.error);

  const isBlank = !sku && price.value === null && !currencyRaw && min.value === null;
  if (!isBlank) {
    if (!sku) errors.push("Missing required field: SKU");
    if (price.value === null && !price.error) errors.push("Missing required field: Selling Price");
  }

  return {
    rowNumber, sku, selling_price: price.value, currency,
    min_quantity: minQ, max_quantity: maxQ,
    effective_date: eff.value, expiration_date: exp.value,
    active: active.value, notes: str(pick(row, mapping, "notes")),
    isBlank, errors,
  };
}

export function normalizePricingRows(rows: RawRow[], mapping: PricingMapping, headerOffset = 2): NormalizedPricingRow[] {
  return rows.map((r, i) => normalizePricingRow(r, mapping, i + headerOffset));
}
