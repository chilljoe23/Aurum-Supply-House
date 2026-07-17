import type { NormalizedMfrCostRow } from "./normalize";

export type MfrCostClassification =
  | "new_manufacturer_product"
  | "new_cost"
  | "cost_update"
  | "product_data_update"
  | "tier_added"
  | "tier_updated"
  | "no_change"
  | "invalid"
  | "duplicate_in_file"
  | "unknown_sku"
  | "future_dated"
  | "expired"
  | "blank";

export type ExistingRelationship = {
  sku: string;
  manufacturer_sku: string | null;
  manufacturer_description: string | null;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
};

export type ExistingCostTier = { sku: string; min_quantity: number; unit_cost: number };

export type ClassifiedMfrCostRow = NormalizedMfrCostRow & {
  classification: MfrCostClassification;
  oldCost: number | null;
  newCost: number | null;
  diff: number | null;
  pct: number | null;
};

const relKey = (sku: string) => sku.toLowerCase();
const tierKey = (sku: string, min: number) => `${sku.toLowerCase()}|${min}`;

// Rows that are invalid / unknown / duplicate / blank are NOT applied by the RPC.
export function isApplicableMfr(c: MfrCostClassification): boolean {
  return !["invalid", "unknown_sku", "duplicate_in_file", "blank"].includes(c);
}

// Detect quantity-tier ranges that overlap WITHIN the file for the same SKU.
// Two rows overlap when [minA, maxA] ∩ [minB, maxB] ≠ ∅ (NULL max = unbounded).
// Returns the set of row numbers that participate in any overlap (excluding exact
// duplicates, which are handled separately as duplicate_in_file).
function overlappingRowNumbers(rows: NormalizedMfrCostRow[], knownSkus: Set<string>): Set<number> {
  const flagged = new Set<number>();
  const bySku = new Map<string, { rowNumber: number; min: number; max: number }[]>();
  for (const r of rows) {
    if (r.isBlank || r.errors.length > 0 || !r.sku || r.unit_cost === null) continue;
    if (!knownSkus.has(r.sku.toLowerCase())) continue;
    const list = bySku.get(r.sku.toLowerCase()) ?? [];
    list.push({ rowNumber: r.rowNumber, min: r.min_quantity, max: r.max_quantity ?? Number.MAX_SAFE_INTEGER });
    bySku.set(r.sku.toLowerCase(), list);
  }
  for (const list of bySku.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.min === b.min) continue; // same min = duplicate, not overlap
        if (a.min <= b.max && b.min <= a.max) { flagged.add(a.rowNumber); flagged.add(b.rowNumber); }
      }
    }
  }
  return flagged;
}

export function classifyMfrCostRows(
  rows: NormalizedMfrCostRow[],
  relationships: Map<string, ExistingRelationship>,
  tiers: Map<string, number>,
  knownSkus: Set<string>,
  today: string,
): ClassifiedMfrCostRow[] {
  const seen = new Set<string>();
  const overlaps = overlappingRowNumbers(rows, knownSkus);

  return rows.map((row) => {
    const base = {
      ...row,
      oldCost: null as number | null,
      newCost: row.unit_cost,
      diff: null as number | null,
      pct: null as number | null,
    };

    if (row.isBlank) return { ...base, classification: "blank" as const, newCost: null };
    if (row.errors.length > 0 || !row.sku || row.unit_cost === null) {
      return { ...base, classification: "invalid" as const };
    }
    if (!knownSkus.has(row.sku.toLowerCase())) {
      return { ...base, classification: "unknown_sku" as const, errors: [...row.errors, `Unknown SKU: ${row.sku}`] };
    }
    const k = tierKey(row.sku, row.min_quantity);
    if (seen.has(k)) {
      return { ...base, classification: "duplicate_in_file" as const, errors: [...row.errors, `Duplicate SKU/tier in file: ${row.sku} @ min ${row.min_quantity}`] };
    }
    seen.add(k);
    if (overlaps.has(row.rowNumber)) {
      return { ...base, classification: "invalid" as const, errors: [...row.errors, `Overlapping quantity tier for ${row.sku}`] };
    }

    // Date tags (still importable)
    if (row.effective_date && row.effective_date > today) {
      return { ...base, classification: "future_dated" as const };
    }
    if (row.expiration_date && row.expiration_date < today) {
      return { ...base, classification: "expired" as const };
    }

    const rel = relationships.get(relKey(row.sku));
    if (!rel) {
      return { ...base, classification: "new_manufacturer_product" as const };
    }

    const ex = tiers.get(k);
    if (ex === undefined) {
      return { ...base, classification: row.min_quantity === 1 ? ("new_cost" as const) : ("tier_added" as const) };
    }
    if (Number(row.unit_cost) !== Number(ex)) {
      const diff = Number((row.unit_cost - ex).toFixed(4));
      const pct = ex > 0 ? Number((diff / ex).toFixed(4)) : null;
      return {
        ...base,
        classification: row.min_quantity === 1 ? ("cost_update" as const) : ("tier_updated" as const),
        oldCost: ex, diff, pct,
      };
    }

    // Same cost — is any provided relationship datum different?
    const dataChanged =
      (row.manufacturer_sku !== null && row.manufacturer_sku !== rel.manufacturer_sku) ||
      (row.manufacturer_description !== null && row.manufacturer_description !== rel.manufacturer_description) ||
      (row.moq !== null && row.moq !== rel.moq) ||
      (row.order_multiple !== null && row.order_multiple !== rel.order_multiple) ||
      (row.lead_time_days !== null && row.lead_time_days !== rel.lead_time_days);

    if (dataChanged) return { ...base, classification: "product_data_update" as const, oldCost: ex };
    return { ...base, classification: "no_change" as const, oldCost: ex };
  });
}

const ALL: MfrCostClassification[] = [
  "new_manufacturer_product", "new_cost", "cost_update", "product_data_update",
  "tier_added", "tier_updated", "no_change", "invalid", "duplicate_in_file",
  "unknown_sku", "future_dated", "expired", "blank",
];

export function summarizeMfrCost(rows: ClassifiedMfrCostRow[]) {
  const counts = {} as Record<MfrCostClassification, number>;
  for (const c of ALL) counts[c] = 0;
  for (const r of rows) counts[r.classification]++;
  const valid = rows.filter((r) => isApplicableMfr(r.classification)).length;
  return { counts, valid, total: rows.length };
}
