// CSV export safety. The Insights CSV must (a) escape correctly and (b) only
// ever contain the columns the caller passes — the manager omits profit columns
// for Sales Reps, so a rep export can never leak gross/net profit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../../src/lib/catalog/csv.ts";

test("toCsv escapes commas, quotes and newlines (RFC-4180)", () => {
  const csv = toCsv(
    [
      { key: "name", label: "Name" },
      { key: "note", label: "Note" },
    ],
    [{ name: "Acme, Inc.", note: 'He said "hi"\nthen left' }],
  );
  const [header, row] = csv.split("\n").length === 2 ? csv.split("\n") : [csv.split("\n")[0], csv.slice(csv.indexOf("\n") + 1)];
  assert.equal(header, "Name,Note");
  assert.match(row, /^"Acme, Inc\.","He said ""hi""/);
});

test("rep CSV column set excludes profit columns", () => {
  // Simulate how the manager builds columns: profit columns only when admin.
  const canSeeInternal = false;
  const cols = [
    { key: "client", label: "Client" },
    { key: "revenue", label: "Revenue" },
    ...(canSeeInternal ? [{ key: "grossProfit", label: "Gross profit" }] : []),
  ];
  const csv = toCsv(cols, [{ client: "Acme", revenue: 1000, grossProfit: 400 }]);
  const header = csv.split("\n")[0];
  assert.equal(header, "Client,Revenue");
  assert.doesNotMatch(csv, /profit/i); // gross profit value never emitted for a rep
});

test("admin CSV includes profit columns when requested", () => {
  const canSeeInternal = true;
  const cols = [
    { key: "client", label: "Client" },
    { key: "revenue", label: "Revenue" },
    ...(canSeeInternal ? [{ key: "grossProfit", label: "Gross profit" }] : []),
  ];
  const csv = toCsv(cols, [{ client: "Acme", revenue: 1000, grossProfit: 400 }]);
  assert.match(csv.split("\n")[0], /Gross profit/);
  assert.match(csv, /400/);
});

test("null / undefined cells render as empty, not 'null'", () => {
  const csv = toCsv(
    [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
    [{ a: null, b: undefined }],
  );
  assert.equal(csv.split("\n")[1], ",");
});
