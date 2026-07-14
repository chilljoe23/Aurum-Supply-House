import { normalizeHeader } from "@/lib/catalog/mapping";
import { PRICING_FIELDS, PRICING_REQUIRED, type PricingFieldKey } from "./fields";

export type PricingMapping = Record<string, PricingFieldKey | null>;

// Auto-map spreadsheet headers to pricing fields (exact then alias then contains).
// Structured so a future wide-format adapter (1–99 Price, 100–499 Price, …) can
// pre-expand columns into normalized rows before this mapper runs.
export function autoMapPricing(headers: string[]): PricingMapping {
  const mapping: PricingMapping = {};
  const claimed = new Set<PricingFieldKey>();
  for (const raw of headers) {
    const norm = normalizeHeader(raw);
    let match: PricingFieldKey | null = null;
    for (const f of PRICING_FIELDS) {
      if (claimed.has(f.key)) continue;
      const aliases = [f.label, f.key, ...f.aliases].map(normalizeHeader);
      if (aliases.includes(norm)) { match = f.key; break; }
    }
    if (!match) {
      for (const f of PRICING_FIELDS) {
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

export function unmappedRequiredPricing(mapping: PricingMapping): PricingFieldKey[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean) as PricingFieldKey[]);
  return PRICING_REQUIRED.filter((k) => !mapped.has(k));
}
