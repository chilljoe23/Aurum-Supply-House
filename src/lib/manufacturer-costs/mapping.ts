import { normalizeHeader } from "@/lib/catalog/mapping";
import { MFR_COST_FIELDS, MFR_COST_REQUIRED, type MfrCostFieldKey } from "./fields";

export type MfrCostMapping = Record<string, MfrCostFieldKey | null>;

// Auto-map spreadsheet headers to manufacturer-cost fields (exact → alias → contains).
// Same greedy first-claim strategy the M1/M2 mappers use.
export function autoMapMfrCost(headers: string[]): MfrCostMapping {
  const mapping: MfrCostMapping = {};
  const claimed = new Set<MfrCostFieldKey>();
  for (const raw of headers) {
    const norm = normalizeHeader(raw);
    let match: MfrCostFieldKey | null = null;
    for (const f of MFR_COST_FIELDS) {
      if (claimed.has(f.key)) continue;
      const aliases = [f.label, f.key, ...f.aliases].map(normalizeHeader);
      if (aliases.includes(norm)) { match = f.key; break; }
    }
    if (!match) {
      for (const f of MFR_COST_FIELDS) {
        if (claimed.has(f.key)) continue;
        const aliases = [f.key, ...f.aliases].map(normalizeHeader);
        if (aliases.some((a) => a.length >= 3 && norm.includes(a))) { match = f.key; break; }
      }
    }
    mapping[raw] = match;
    if (match) claimed.add(match);
  }
  return mapping;
}

export function unmappedRequiredMfrCost(mapping: MfrCostMapping): MfrCostFieldKey[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean) as MfrCostFieldKey[]);
  return MFR_COST_REQUIRED.filter((k) => !mapped.has(k));
}
