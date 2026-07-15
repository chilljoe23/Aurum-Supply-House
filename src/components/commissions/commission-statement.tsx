// ============================================================================
// The Aurum COMMISSION STATEMENT document. Shares the invoice's visual language
// (deep navy / muted sage / warm ivory, Geist) so it feels part of the family,
// but is unmistakably an INTERNAL / recipient document — never a customer invoice.
//
// It contains ONLY recipient-safe fields. Client true cost, gross profit, margin,
// and company net profit are NOT props on StatementModel and cannot appear here.
// ============================================================================

const NAVY = "#112B46";
const SAGE = "#758B6A";
const INK = "#2B2B2B";
const MUTED = "#6B6B63";
const BORDER = "#E4E0D6";
const IVORY = "#FFFCF8";

export type StatementRow = {
  invoiceNumber: string;
  client: string;
  invoicePaidDate: string | null;
  calcType: string;
  rate: string;
  amount: number;
  status: string;
  commissionPaidDate: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
};

export type StatementModel = {
  company: { name: string; lines: string[]; email: string | null; phone: string | null };
  recipient: { name: string; type: string; company: string | null; email: string | null };
  periodLabel: string;
  generatedOn: string;
  currency: string;
  rows: StatementRow[];
  total: number;
  paidTotal: number;
};

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

export function CommissionStatement({ model }: { model: StatementModel }) {
  const c = model.currency;
  return (
    <div
      data-print-root
      style={{
        background: "#FFFFFF",
        color: INK,
        maxWidth: "8.5in",
        margin: "0 auto",
        padding: "0.7in 0.75in",
        boxSizing: "border-box",
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{ width: 34, height: 34, borderRadius: 8, background: NAVY, color: IVORY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}
            >
              A
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em" }}>{model.company.name}</div>
          </div>
          <div style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>
            {model.company.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            {model.company.email && <div>{model.company.email}</div>}
            {model.company.phone && <div>{model.company.phone}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: SAGE, letterSpacing: "0.02em" }}>COMMISSION</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: SAGE, letterSpacing: "0.02em", marginTop: -4 }}>STATEMENT</div>
          <div style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>{model.periodLabel}</div>
          <div style={{ color: MUTED, fontSize: 11 }}>Generated {model.generatedOn}</div>
          <div style={{ marginTop: 8 }}>
            <span
              style={{
                display: "inline-block", border: `1px solid ${SAGE}`, color: SAGE, borderRadius: 999,
                padding: "3px 12px", fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
              }}
            >
              Internal · not a customer invoice
            </span>
          </div>
        </div>
      </div>

      <div style={{ height: 2, background: SAGE, margin: "20px 0 0" }} />

      {/* Recipient */}
      <div style={{ padding: "16px 0", borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600, marginBottom: 6 }}>
          Statement for
        </div>
        <div style={{ fontWeight: 600, color: INK, fontSize: 15 }}>{model.recipient.name}</div>
        <div style={{ color: MUTED, fontSize: 12 }}>
          {model.recipient.type === "external_partner" ? "External referral partner" : "Internal user"}
          {model.recipient.company ? ` · ${model.recipient.company}` : ""}
          {model.recipient.email ? ` · ${model.recipient.email}` : ""}
        </div>
      </div>

      {/* Rows */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
            <Th style={{ width: "13%" }}>Invoice</Th>
            <Th>Client</Th>
            <Th style={{ width: "12%" }}>Inv. paid</Th>
            <Th style={{ width: "15%" }}>Basis</Th>
            <Th align="right" style={{ width: "10%" }}>Rate</Th>
            <Th align="right" style={{ width: "13%" }}>Amount</Th>
            <Th style={{ width: "12%" }}>Status</Th>
            <Th style={{ width: "12%" }}>Paid</Th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <Td style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12 }}>{r.invoiceNumber}</Td>
              <Td>{r.client}</Td>
              <Td>{r.invoicePaidDate ?? "—"}</Td>
              <Td>{r.calcType}</Td>
              <Td align="right">{r.rate}</Td>
              <Td align="right">{money(r.amount, c)}</Td>
              <Td style={{ textTransform: "capitalize" }}>{r.status}</Td>
              <Td>
                {r.commissionPaidDate ?? "—"}
                {r.paymentMethod && <div style={{ fontSize: 10.5, color: MUTED }}>{r.paymentMethod}{r.paymentReference ? ` · ${r.paymentReference}` : ""}</div>}
              </Td>
            </tr>
          ))}
          {model.rows.length === 0 && (
            <tr>
              <Td colSpan={8} style={{ color: MUTED, textAlign: "center", padding: "24px 0" }}>No commissions in this period.</Td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Total */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ width: "58%", maxWidth: 340 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", color: INK }}>
            <span>Paid to date</span>
            <span>{money(model.paidTotal, c)}</span>
          </div>
          <div style={{ height: 1, background: NAVY, margin: "8px 0" }} />
          <div
            style={{
              display: "flex", justifyContent: "space-between", marginTop: 4, padding: "10px 12px",
              background: "#F3F6F1", borderRadius: 8, border: `1px solid #DCE6D5`,
            }}
          >
            <span style={{ fontWeight: 700, color: NAVY }}>Period total</span>
            <span style={{ fontWeight: 700, color: NAVY }}>{money(model.total, c)}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32, paddingTop: 14, borderTop: `1px solid ${BORDER}`, textAlign: "center", color: MUTED, fontSize: 12 }}>
        {model.company.name} · Internal commission statement · Figures reflect this recipient&apos;s commissions only.
      </div>
    </div>
  );
}

function Th({ children, align = "left", style }: { children?: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties }) {
  return (
    <th style={{ textAlign: align, padding: "8px 6px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: NAVY, fontWeight: 600, ...style }}>
      {children}
    </th>
  );
}
function Td({ children, align = "left", style, colSpan }: { children?: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties; colSpan?: number }) {
  return (
    <td colSpan={colSpan} style={{ textAlign: align, padding: "9px 6px", verticalAlign: "top", ...style }}>
      {children}
    </td>
  );
}
