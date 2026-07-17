// Pure, dependency-free reporting math. No Supabase, no React — every function
// here is deterministic and unit-tested (see src/lib/insights/calculations.test.ts).
//
// Two invariants drive the whole reporting layer:
//   1. Currency-safe. Postgres `numeric` arrives as a string; naive `+` would
//      concatenate. Always funnel money through `toMoney` and sum with `sumMoney`.
//   2. Masking-aware. For Sales Reps the masked views return NULL for
//      gross/net profit. A sum over a partially-masked set must be NULL (unknown),
//      never a misleading 0 — that is what `maskedSum` guarantees.

export type Granularity = "day" | "week" | "month";

/** Parse a numeric/`numeric`-string/nullish value into a finite number (0 on garbage). */
export function toMoney(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round to cents without binary-float drift (half-up on the cent). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum a money column across rows, currency-safe. */
export function sumMoney<T>(rows: readonly T[], key: keyof T): number {
  return roundMoney(rows.reduce((s, r) => s + toMoney(r[key]), 0));
}

/**
 * Sum a possibly-masked money column. If ANY row has a null/undefined value for
 * the column (i.e. the caller is a rep and the field is masked), the metric is
 * unknown and we return null rather than a partial, misleading total.
 */
export function maskedSum<T>(rows: readonly T[], key: keyof T): number | null {
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) return null;
  }
  return sumMoney(rows, key);
}

/** True when the dataset's profit column is masked (rep view). */
export function isMasked<T>(rows: readonly T[], key: keyof T): boolean {
  return rows.some((r) => r[key] === null || r[key] === undefined);
}

/** ISO `YYYY-MM-DD` for a date-ish input, or null. Uses UTC to avoid TZ drift. */
function isoDate(input: unknown): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Bucket key for a date at the requested granularity (UTC, deterministic). */
export function periodKey(input: unknown, granularity: Granularity): string | null {
  const iso = isoDate(input);
  if (!iso) return null;
  if (granularity === "day") return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  if (granularity === "month") return iso.slice(0, 7); // YYYY-MM
  // week: ISO-week Monday as the bucket start
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export type TimeBucket = {
  period: string;
  orders: number;
  revenue: number;
  grossProfit: number | null;
  netProfit: number | null;
};

type OrderRowLike = {
  issue_date?: unknown;
  created_at?: unknown;
  total?: unknown;
  gross_profit?: unknown;
  net_profit?: unknown;
};

/**
 * Revenue / gross / net profit bucketed over time. Profit is null for any bucket
 * that contains a masked row (rep view), never a partial sum. Buckets are sorted
 * ascending by period. `dateKey` selects which timestamp drives the bucket.
 */
export function aggregateOverTime(
  rows: readonly OrderRowLike[],
  granularity: Granularity,
): TimeBucket[] {
  const map = new Map<string, OrderRowLike[]>();
  for (const r of rows) {
    const key = periodKey(r.issue_date ?? r.created_at, granularity);
    if (!key) continue;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, group]) => ({
      period,
      orders: group.length,
      revenue: sumMoney(group, "total"),
      grossProfit: maskedSum(group, "gross_profit"),
      netProfit: maskedSum(group, "net_profit"),
    }));
}

/**
 * Generic group-and-aggregate. Returns one row per distinct key with count,
 * revenue, and masking-aware gross/net profit. `label` resolves a display label
 * from the first row in each group. Sorted by revenue descending.
 */
export function groupAggregate<T extends OrderRowLike>(
  rows: readonly T[],
  keyOf: (r: T) => string | null,
  labelOf: (r: T) => string,
): Array<{ key: string; label: string; orders: number; revenue: number; grossProfit: number | null; netProfit: number | null }> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([key, group]) => ({
      key,
      label: labelOf(group[0]),
      orders: group.length,
      revenue: sumMoney(group, "total"),
      grossProfit: maskedSum(group, "gross_profit"),
      netProfit: maskedSum(group, "net_profit"),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Quote conversion: converted ÷ every quote that ever left draft. Null-safe. */
export function conversionRate(counts: {
  converted: number;
  postDraftTotal: number;
}): number {
  if (counts.postDraftTotal <= 0) return 0;
  return counts.converted / counts.postDraftTotal;
}

/** Inclusive date-range predicate on an ISO date column; open-ended when a bound is null. */
export function inDateRange(dateISO: unknown, from: string | null, to: string | null): boolean {
  const iso = isoDate(dateISO);
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/** First day of the current month as `YYYY-MM-DD` (UTC). */
export function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
