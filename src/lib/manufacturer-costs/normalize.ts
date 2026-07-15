import type { RawRow } from "@/lib/catalog/normalize";
import type { MfrCostMapping } from "./mapping";
import type { MfrCostFieldKey } from "./fields";

export type NormalizedMfrCostRow = {
  rowNumber: number;
  sku: string | null;
  unit_cost: number | null;
  manufacturer_sku: string | null;
  product_name: string | null;
  manufacturer_description: string | null;
  currency: string;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
  min_quantity: number;
  max_quantity: number | null;
  effective_date: string | null; // ISO yyyy-mm-dd
  expiration_date: string | null;
  active: boolean;
  notes: string | null;
  isBlank: boolean;
  errors: string[];
};

function pick(row: RawRow, mapping: MfrCostMapping, key: MfrCostFieldKey): unknown {
  for (const [h, m] of Object.entries(mapping)) if (m === key) return row[h];
  return undefined;
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

function parseCost(v: unknown): { value: number | null; error?: string } {
  const s = str(v);
  if (s === null) return { value: null };
  if (s.startsWith("=")) return { value: null, error: "Unsupported formula in cost cell" };
  if (/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(s)) return { value: null, error: "Unexpected date in cost cell" };
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { value: null, error: `Invalid cost: "${s}"` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, error: `Invalid cost: "${s}"` };
  if (n <= 0) return { value: n, error: "Cost must be greater than zero" };
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

export function normalizeMfrCostRow(row: RawRow, mapping: MfrCostMapping, rowNumber: number): NormalizedMfrCostRow {
  const errors: string[] = [];
  const sku = str(pick(row, mapping, "sku"));

  const cost = parseCost(pick(row, mapping, "unit_cost"));
  if (cost.error) errors.push(cost.error);

  const moq = parseIntQty(pick(row, mapping, "moq"), "MOQ");
  if (moq.error) errors.push(moq.error);
  const om = parseIntQty(pick(row, mapping, "order_multiple"), "order multiple");
  if (om.error) errors.push(om.error);
  if (om.value !== null && om.value < 1) errors.push("Order multiple must be at least 1");
  const lt = parseIntQty(pick(row, mapping, "lead_time_days"), "lead time");
  if (lt.error) errors.push(lt.error);

  const min = parseIntQty(pick(row, mapping, "min_quantity"), "minimum quantity");
  if (min.error) errors.push(min.error);
  const max = parseIntQty(pick(row, mapping, "max_quantity"), "maximum quantity");
  if (max.error) errors.push(max.error);
  const minQ = min.value ?? 1;
  const maxQ = max.value;
  if (minQ < 1) errors.push("Minimum quantity must be at least 1");
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

  const isBlank = !sku && cost.value === null && !currencyRaw && min.value === null && max.value === null;
  if (!isBlank) {
    if (!sku) errors.push("Missing required field: SKU");
    if (cost.value === null && !cost.error) errors.push("Missing required field: Unit Cost");
  }

  return {
    rowNumber, sku, unit_cost: cost.value,
    manufacturer_sku: str(pick(row, mapping, "manufacturer_sku")),
    product_name: str(pick(row, mapping, "product_name")),
    manufacturer_description: str(pick(row, mapping, "manufacturer_description")),
    currency, moq: moq.value, order_multiple: om.value, lead_time_days: lt.value,
    min_quantity: minQ, max_quantity: maxQ,
    effective_date: eff.value, expiration_date: exp.value,
    active: active.value, notes: str(pick(row, mapping, "notes")),
    isBlank, errors,
  };
}

export function normalizeMfrCostRows(rows: RawRow[], mapping: MfrCostMapping, headerOffset = 2): NormalizedMfrCostRow[] {
  return rows.map((r, i) => normalizeMfrCostRow(r, mapping, i + headerOffset));
}
