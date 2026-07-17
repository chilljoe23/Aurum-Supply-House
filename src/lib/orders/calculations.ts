// ============================================================================
// Aurum Supply House — order money math (client + server safe, deterministic)
// ----------------------------------------------------------------------------
// The DATABASE is the source of truth for every persisted figure (app.recalc_invoice
// in migration 0190). This module mirrors that math for LIVE UI preview only, and
// is written to match it exactly:
//   • half-up rounding identical to app.money_round
//   • integer ten-thousandths arithmetic so binary floating-point never drifts a cent
//   • the same order of operations (net_sales → tax → total → gross/net profit)
// Persisted money always comes back from the DB as numeric(14,4); we never trust a
// JS-computed figure for storage — only for what the user sees while building.
// ============================================================================

const SCALE = 10_000; // 4 decimal places, matching numeric(14,4)

/** Half-up rounding to `dp` places, matching Postgres app.money_round. */
export function moneyRound(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.trunc(Math.abs(value) * f + 0.5)) / f;
}

/** Multiply two decimals via integers, then round to `dp` — no float drift. */
function mul(a: number, b: number, dp = 4): number {
  const units = Math.round(a * SCALE) * b; // a is money-scale, b a plain quantity/rate
  return moneyRound(units / SCALE, dp);
}

export type CalcLine = {
  quantity: number;
  unit_price: number;
  unit_true_cost: number;
};

export type OrderTotals = {
  subtotal: number;
  discount: number; // clamped to subtotal
  net_sales: number;
  shipping: number;
  fees: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  total_true_cost: number;
  gross_profit: number;
  gross_margin: number;
  total_expenses: number;
  total_commission: number;
  net_profit: number;
  amount_paid: number;
  balance_due: number;
};

export type CalcInput = {
  lines: CalcLine[];
  shipping?: number;
  fees?: number;
  tax_rate?: number; // fraction, e.g. 0.07
  discount?: number;
  expenses?: number[]; // internal order expenses
  commission?: number;
  amount_paid?: number;
};

export function computeLineSubtotal(quantity: number, unitPrice: number): number {
  return mul(unitPrice, quantity, 4);
}

/** Full economic rollup — mirrors app.recalc_invoice(). */
export function computeTotals(input: CalcInput): OrderTotals {
  const shipping = moneyRound(input.shipping ?? 0, 4);
  const fees = moneyRound(input.fees ?? 0, 4);
  const taxRate = input.tax_rate ?? 0;
  const expenses = (input.expenses ?? []).reduce((s, e) => s + moneyRound(e, 4), 0);
  const commission = moneyRound(input.commission ?? 0, 4);
  const amountPaid = moneyRound(input.amount_paid ?? 0, 4);

  let subtotal = 0;
  let trueCost = 0;
  for (const l of input.lines) {
    subtotal += mul(l.unit_price, l.quantity, 4);
    trueCost += mul(l.unit_true_cost, l.quantity, 4);
  }
  subtotal = moneyRound(subtotal, 4);
  trueCost = moneyRound(trueCost, 4);

  const discount = Math.min(moneyRound(input.discount ?? 0, 4), subtotal);
  const netSales = moneyRound(subtotal - discount, 4);
  const taxAmount = moneyRound(netSales * taxRate, 2);
  const total = moneyRound(netSales + shipping + fees + taxAmount, 4);
  const grossProfit = moneyRound(netSales - trueCost, 4);
  const grossMargin = netSales > 0 ? Math.round((grossProfit / netSales) * 1_000_000) / 1_000_000 : 0;
  const netProfit = moneyRound(grossProfit - commission - expenses, 4);

  return {
    subtotal,
    discount,
    net_sales: netSales,
    shipping,
    fees,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total,
    total_true_cost: trueCost,
    gross_profit: grossProfit,
    gross_margin: grossMargin,
    total_expenses: expenses,
    total_commission: commission,
    net_profit: netProfit,
    amount_paid: amountPaid,
    balance_due: moneyRound(total - amountPaid, 4),
  };
}
