import type { NormalizedPricingRow } from "./normalize";

export type PricingClassification =
  | "new_price"
  | "price_update"
  | "tier_added"
  | "tier_updated"
  | "no_change"
  | "invalid"
  | "duplicate_in_file"
  | "unknown_sku"
  | "future_dated"
  | "expired"
  | "blank";

export type ExistingBand = { sku: string; min_quantity: number; selling_price: number };

export type ClassifiedPricingRow = NormalizedPricingRow & {
  classification: PricingClassification;
  oldPrice: number | null;
  newPrice: number | null;
  diff: number | null;
  pct: number | null;
};

const key = (sku: string, min: number) => `${sku.toLowerCase()}|${min}`;

// Rows that are invalid / unknown / duplicate / blank are NOT applied.
export function isApplicable(c: PricingClassification): boolean {
  return !["invalid", "unknown_sku", "duplicate_in_file", "blank"].includes(c);
}

export function classifyPricingRows(
  rows: NormalizedPricingRow[],
  existing: Map<string, ExistingBand>,
  knownSkus: Set<string>,
  today: string,
): ClassifiedPricingRow[] {
  const seen = new Set<string>();

  return rows.map((row) => {
    const base = { ...row, oldPrice: null as number | null, newPrice: row.selling_price, diff: null as number | null, pct: null as number | null };

    if (row.isBlank) return { ...base, classification: "blank" as const, newPrice: null };
    if (row.errors.length > 0 || !row.sku || row.selling_price === null) {
      return { ...base, classification: "invalid" as const };
    }
    if (!knownSkus.has(row.sku.toLowerCase())) {
      return { ...base, classification: "unknown_sku" as const, errors: [...row.errors, `Unknown SKU: ${row.sku}`] };
    }
    const k = key(row.sku, row.min_quantity);
    if (seen.has(k)) {
      return { ...base, classification: "duplicate_in_file" as const, errors: [...row.errors, `Duplicate SKU/tier in file: ${row.sku} @ min ${row.min_quantity}`] };
    }
    seen.add(k);

    // date tags (still importable)
    if (row.effective_date && row.effective_date > today) {
      return { ...base, classification: "future_dated" as const };
    }
    if (row.expiration_date && row.expiration_date < today) {
      return { ...base, classification: "expired" as const };
    }

    const ex = existing.get(k);
    if (!ex) {
      return { ...base, classification: row.min_quantity === 1 ? ("new_price" as const) : ("tier_added" as const) };
    }
    const oldPrice = ex.selling_price;
    if (Number(row.selling_price) === Number(oldPrice)) {
      return { ...base, classification: "no_change" as const, oldPrice };
    }
    const diff = Number((row.selling_price - oldPrice).toFixed(4));
    const pct = oldPrice > 0 ? Number((diff / oldPrice).toFixed(4)) : null;
    return {
      ...base,
      classification: row.min_quantity === 1 ? ("price_update" as const) : ("tier_updated" as const),
      oldPrice, diff, pct,
    };
  });
}

export function summarizePricing(rows: ClassifiedPricingRow[]) {
  const counts = {} as Record<PricingClassification, number>;
  for (const c of ["new_price","price_update","tier_added","tier_updated","no_change","invalid","duplicate_in_file","unknown_sku","future_dated","expired","blank"] as PricingClassification[]) counts[c] = 0;
  for (const r of rows) counts[r.classification]++;
  const valid = rows.filter((r) => isApplicable(r.classification)).length;
  return { counts, valid, total: rows.length };
}
