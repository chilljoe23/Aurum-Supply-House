import type { CommissionType } from "@/lib/commissions/schemas";

// Pure, fixed-precision mirror of app.compute_commission (migration 0220) for
// live UI preview ONLY. The database is the source of truth; this exists so the
// builder can show the amount before saving. Rounding is half-up to 2 decimals,
// matching app.money_round.

export function moneyRound(v: number, scale = 2): number {
  if (!Number.isFinite(v)) return 0;
  const f = Math.pow(10, scale);
  return Math.trunc(v * f + 0.5 * Math.sign(v)) / f;
}

export function computeCommissionAmount(
  type: CommissionType,
  rate: number,
  units: number | undefined,
  invoiceSubtotal: number,
  invoiceGrossProfit: number | null,
): number {
  const r = Number(rate) || 0;
  switch (type) {
    case "percent_of_sale":
      return moneyRound((Number(invoiceSubtotal) || 0) * r, 2);
    case "percent_of_gross_profit":
      return moneyRound((Number(invoiceGrossProfit) || 0) * r, 2);
    case "flat":
      return moneyRound(r, 2);
    case "per_unit":
      return moneyRound((Number(units) || 0) * r, 2);
    default:
      return 0;
  }
}

// Describe the basis + formula for the audit-friendly explanation shown in the UI.
export function commissionBasisLabel(type: CommissionType): string {
  switch (type) {
    case "percent_of_sale":
      return "Invoice subtotal";
    case "percent_of_gross_profit":
      return "Invoice gross profit";
    case "flat":
      return "Fixed amount";
    case "per_unit":
      return "Units × rate";
  }
}

// Format a stored rate for display: percent types show as e.g. "5%", dollar types
// as a currency-like number handled by the caller.
export function formatRate(type: CommissionType, rate: number, currency = "USD"): string {
  if (type === "percent_of_sale" || type === "percent_of_gross_profit") {
    return `${(Number(rate) * 100).toFixed(2).replace(/\.00$/, "")}%`;
  }
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    Number(rate) || 0,
  );
  return type === "per_unit" ? `${money}/unit` : money;
}
