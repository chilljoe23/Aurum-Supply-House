import type { NormalizedRow } from "./normalize";

export type RowClassification =
  | "new"
  | "no_change"
  | "product_update"
  | "cost_update"
  | "product_and_cost_update"
  | "invalid"
  | "duplicate_in_file"
  | "blank";

// Minimal shape of an existing catalog product needed to detect changes.
export type ExistingProduct = {
  id: string;
  sku: string;
  name: string | null;
  description: string | null;
  strength: string | null;
  product_form: string | null;
  pack_size: string | null;
  unit_of_measure: string | null;
  manufacturer_sku: string | null;
  category: string | null;
  moq: number | null;
  lead_time_days: number | null;
  notes: string | null;
  current_true_cost: number | null; // only present for admins
  status: "active" | "discontinued";
};

export type ClassifiedRow = NormalizedRow & {
  classification: RowClassification;
  changedFields: string[];
  costChanged: boolean;
};

const DATA_FIELDS: (keyof NormalizedRow & keyof ExistingProduct)[] = [
  "name",
  "description",
  "strength",
  "product_form",
  "pack_size",
  "unit_of_measure",
  "manufacturer_sku",
  "category",
  "moq",
  "lead_time_days",
  "notes",
];

function providedDiffers(
  provided: unknown,
  existing: unknown,
): boolean {
  if (provided === null || provided === undefined) return false; // not provided → no change
  return String(provided) !== String(existing ?? "");
}

// Classify every row against the existing catalog (keyed by lowercased SKU) and
// against earlier rows in the same file (duplicate detection).
export function classifyRows(
  rows: NormalizedRow[],
  existingBySku: Map<string, ExistingProduct>,
): ClassifiedRow[] {
  const seen = new Set<string>();

  return rows.map((row) => {
    if (row.isBlank) {
      return { ...row, classification: "blank", changedFields: [], costChanged: false };
    }
    if (row.errors.length > 0 || !row.sku || !row.name) {
      return { ...row, classification: "invalid", changedFields: [], costChanged: false };
    }

    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      return {
        ...row,
        classification: "duplicate_in_file",
        changedFields: [],
        costChanged: false,
        errors: [...row.errors, `Duplicate SKU in file: ${row.sku}`],
      };
    }
    seen.add(key);

    const existing = existingBySku.get(key);
    if (!existing) {
      return { ...row, classification: "new", changedFields: [], costChanged: false };
    }

    const changedFields: string[] = [];
    for (const f of DATA_FIELDS) {
      if (providedDiffers(row[f], existing[f])) changedFields.push(f);
    }
    // Status change (active flag) counts as a data change when it differs.
    const existingActive = existing.status === "active";
    if (row.active !== existingActive) changedFields.push("active");

    // Cost change only meaningful when a cost was provided AND we can compare
    // (admins have current_true_cost; if null we treat any provided cost as a change).
    let costChanged = false;
    if (row.true_cost !== null) {
      if (existing.current_true_cost === null) costChanged = true;
      else costChanged = Number(row.true_cost) !== Number(existing.current_true_cost);
    }

    const dataChanged = changedFields.length > 0;
    let classification: RowClassification = "no_change";
    if (dataChanged && costChanged) classification = "product_and_cost_update";
    else if (costChanged) classification = "cost_update";
    else if (dataChanged) classification = "product_update";

    return { ...row, classification, changedFields, costChanged };
  });
}

export function summarize(rows: ClassifiedRow[]) {
  const counts: Record<RowClassification, number> = {
    new: 0, no_change: 0, product_update: 0, cost_update: 0,
    product_and_cost_update: 0, invalid: 0, duplicate_in_file: 0, blank: 0,
  };
  for (const r of rows) counts[r.classification]++;
  const valid = rows.filter(
    (r) => !["invalid", "duplicate_in_file", "blank"].includes(r.classification),
  ).length;
  return { counts, valid, total: rows.length };
}
