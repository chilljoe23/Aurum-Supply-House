import { CATALOG_FIELDS, type CatalogFieldKey } from "./fields";

// A mapping from a spreadsheet column (by header text) to an Aurum field key.
export type ColumnMapping = Record<string, CatalogFieldKey | null>;

export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Auto-map headers to fields using exact-normalized then alias matching.
// Each Aurum field is claimed by at most one column (first best match wins).
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<CatalogFieldKey>();

  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    norm: normalizeHeader(h),
  }));

  for (const { raw, norm } of normalizedHeaders) {
    let match: CatalogFieldKey | null = null;
    for (const field of CATALOG_FIELDS) {
      if (claimed.has(field.key)) continue;
      const aliases = [field.label, field.key, ...field.aliases].map(
        normalizeHeader,
      );
      if (aliases.includes(norm)) {
        match = field.key;
        break;
      }
    }
    // Loose contains-match as a fallback (e.g. "unit cost (usd)").
    if (!match) {
      for (const field of CATALOG_FIELDS) {
        if (claimed.has(field.key)) continue;
        const aliases = [field.key, ...field.aliases].map(normalizeHeader);
        if (aliases.some((a) => a.length >= 3 && norm.includes(a))) {
          match = field.key;
          break;
        }
      }
    }
    mapping[raw] = match;
    if (match) claimed.add(match);
  }
  return mapping;
}

// Which required fields are not yet mapped, given the import kind.
export function unmappedRequired(
  mapping: ColumnMapping,
  requireCost: boolean,
): CatalogFieldKey[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean) as CatalogFieldKey[]);
  const required: CatalogFieldKey[] = ["sku", "name"];
  if (requireCost) required.push("true_cost");
  return required.filter((k) => !mapped.has(k));
}
