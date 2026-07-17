// Unit tests for the pure reporting math. Run with: npm test
// (Node's built-in `node:test` runner + TypeScript type-stripping — no deps.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toMoney,
  roundMoney,
  sumMoney,
  maskedSum,
  isMasked,
  periodKey,
  aggregateOverTime,
  groupAggregate,
  conversionRate,
  inDateRange,
  monthStartIso,
} from "../../src/lib/insights/calculations.ts";

test("toMoney parses Postgres numeric strings (the string-concat trap)", () => {
  assert.equal(toMoney("1234.56"), 1234.56);
  assert.equal(toMoney(1234.56), 1234.56);
  assert.equal(toMoney(null), 0);
  assert.equal(toMoney(undefined), 0);
  assert.equal(toMoney("not-a-number"), 0);
  // Currency-safe: adding two numeric strings must not concatenate.
  assert.equal(toMoney("100.00") + toMoney("50.00"), 150);
});

test("roundMoney avoids binary-float drift on the cent", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(2.675), 2.68);
});

test("sumMoney sums a numeric-string column without concatenation", () => {
  const rows = [{ total: "10.10" }, { total: "20.20" }, { total: "0.70" }];
  assert.equal(sumMoney(rows, "total"), 31);
});

test("maskedSum returns null when ANY row is masked (never a partial 0)", () => {
  const admin = [{ gp: "10" }, { gp: "20" }];
  assert.equal(maskedSum(admin, "gp"), 30);
  const repMixed = [{ gp: "10" }, { gp: null }];
  assert.equal(maskedSum(repMixed, "gp"), null); // masked → unknown, not 10
  const repAll = [{ gp: null }, { gp: undefined }];
  assert.equal(maskedSum(repAll, "gp"), null);
  assert.equal(maskedSum([], "gp"), 0); // empty set is a true zero
});

test("isMasked detects rep (masked) datasets", () => {
  assert.equal(isMasked([{ x: 1 }, { x: 2 }], "x"), false);
  assert.equal(isMasked([{ x: 1 }, { x: null }], "x"), true);
});

test("periodKey buckets by day / week(Mon) / month in UTC", () => {
  assert.equal(periodKey("2026-07-16", "day"), "2026-07-16");
  assert.equal(periodKey("2026-07-16", "month"), "2026-07");
  // 2026-07-16 is a Thursday → ISO week starts Monday 2026-07-13
  assert.equal(periodKey("2026-07-16", "week"), "2026-07-13");
  assert.equal(periodKey(null, "day"), null);
  assert.equal(periodKey("garbage", "month"), null);
});

test("aggregateOverTime sums revenue and keeps profit null for rep (masked) buckets", () => {
  const rows = [
    { issue_date: "2026-07-01", total: "100", gross_profit: "40", net_profit: "30" },
    { issue_date: "2026-07-20", total: "50", gross_profit: "10", net_profit: "5" },
    { issue_date: "2026-06-15", total: "200", gross_profit: "80", net_profit: "60" },
  ];
  const admin = aggregateOverTime(rows, "month");
  assert.deepEqual(admin.map((b) => b.period), ["2026-06", "2026-07"]); // sorted asc
  assert.equal(admin[1].revenue, 150);
  assert.equal(admin[1].grossProfit, 50);
  assert.equal(admin[1].netProfit, 35);

  const repRows = rows.map((r) => ({ ...r, gross_profit: null, net_profit: null }));
  const rep = aggregateOverTime(repRows, "month");
  assert.equal(rep[1].revenue, 150); // revenue still visible to reps
  assert.equal(rep[1].grossProfit, null); // profit masked → null, never 0
  assert.equal(rep[1].netProfit, null);
});

test("groupAggregate groups by key, sorts by revenue desc, masks profit", () => {
  const rows = [
    { client_id: "a", company_name: "Acme", total: "100", gross_profit: "40", net_profit: "30" },
    { client_id: "b", company_name: "Beta", total: "300", gross_profit: "120", net_profit: "90" },
    { client_id: "a", company_name: "Acme", total: "50", gross_profit: "20", net_profit: "15" },
  ];
  const g = groupAggregate(
    rows,
    (r) => r.client_id,
    (r) => r.company_name,
  );
  assert.equal(g[0].label, "Beta"); // highest revenue first
  assert.equal(g[0].revenue, 300);
  const acme = g.find((x) => x.key === "a")!;
  assert.equal(acme.revenue, 150);
  assert.equal(acme.orders, 2);
  assert.equal(acme.grossProfit, 60);
});

test("conversionRate = converted ÷ post-draft, null-safe", () => {
  assert.equal(conversionRate({ converted: 3, postDraftTotal: 12 }), 0.25);
  assert.equal(conversionRate({ converted: 0, postDraftTotal: 0 }), 0); // no divide-by-zero
  assert.equal(conversionRate({ converted: 5, postDraftTotal: 5 }), 1);
});

test("inDateRange is inclusive and open-ended when a bound is null", () => {
  assert.equal(inDateRange("2026-07-16", "2026-07-01", "2026-07-31"), true);
  assert.equal(inDateRange("2026-07-16", "2026-08-01", null), false);
  assert.equal(inDateRange("2026-07-16", null, "2026-07-15"), false);
  assert.equal(inDateRange("2026-07-16", null, null), true);
  assert.equal(inDateRange(null, null, null), false);
});

test("monthStartIso returns the UTC first-of-month", () => {
  assert.equal(monthStartIso(new Date("2026-07-16T12:34:56Z")), "2026-07-01");
  assert.equal(monthStartIso(new Date("2026-01-31T23:59:59Z")), "2026-01-01");
});
