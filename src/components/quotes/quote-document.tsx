import type { QuoteViewModel } from "@/lib/quotes/quote-view-model";

// ============================================================================
// The Aurum quote document. Pure presentation of the normalized quote view model
// — the SAME component renders the on-screen preview and the printable/PDF output,
// so the two cannot drift. It shares the approved Invoice/PO visual language:
// white page, cream/ivory accents, deep-navy typography, muted-sage labels, US
// Letter, grayscale-safe, long-name/long-description safe. The <thead> repeats on
// each printed page (browser default) so multi-page quotes keep column headings.
//
// This component receives ONLY customer-facing data. Cost, profit, margin,
// commission, internal expenses, price-resolution diagnostics and internal notes
// are not fields on QuoteViewModel and therefore cannot appear here.
// ============================================================================

const NAVY = "#112B46";
const SAGE = "#758B6A";
const INK = "#2B2B2B";
const MUTED = "#6B6B63";
const BORDER = "#E4E0D6";
const IVORY = "#FFFCF8";

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}
function qty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        border: `1px solid ${tone}`,
        color: tone,
        borderRadius: 999,
        padding: "3px 12px",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function AddressBlock({ heading, name, lines }: { heading: string; name?: string | null; lines: string[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600, marginBottom: 6 }}>
        {heading}
      </div>
      {name && <div style={{ fontWeight: 600, color: INK, wordBreak: "break-word" }}>{name}</div>}
      {lines.length ? (
        lines.map((l, i) => <div key={i} style={{ color: MUTED, fontSize: 13, wordBreak: "break-word" }}>{l}</div>)
      ) : (
        <div style={{ color: MUTED, fontSize: 13 }}>—</div>
      )}
    </div>
  );
}

export function QuoteDocument({ model }: { model: QuoteViewModel }) {
  const c = model.currency;
  const showTax = model.taxAmount > 0 || model.taxRate > 0;
  const showDiscount = model.discount > 0;
  const showShipping = model.shipping > 0;
  const showFees = model.fees > 0;
  const statusTone = model.isVoid || model.status === "declined" ? "#B76A5B"
    : model.status === "accepted" || model.status === "converted" ? SAGE
    : model.isExpired ? "#B08A3C"
    : NAVY;
  const watermark = model.isVoid ? "VOID" : model.isExpired ? "EXPIRED" : null;

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
        position: "relative",
      }}
    >
      {watermark && (
        <div
          aria-hidden
          style={{
            position: "absolute", top: "38%", left: 0, right: 0, textAlign: "center",
            fontSize: 110, fontWeight: 800, color: "rgba(183,106,91,0.10)", letterSpacing: "0.1em",
            transform: "rotate(-18deg)", pointerEvents: "none",
          }}
        >
          {watermark}
        </div>
      )}

      {/* Header — brand + quote meta */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{ width: 34, height: 34, borderRadius: 8, background: NAVY, color: IVORY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 }}
            >
              A
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, letterSpacing: "-0.01em", wordBreak: "break-word" }}>{model.company.name}</div>
          </div>
          <div style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>
            {model.company.lines.map((l, i) => <div key={i}>{l}</div>)}
            {model.company.email && <div>{model.company.email}</div>}
            {model.company.phone && <div>{model.company.phone}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: NAVY, letterSpacing: "0.02em" }}>QUOTE</div>
          <div style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 15, color: INK, marginTop: 2 }}>
            {model.quoteNumber}
          </div>
          <div style={{ marginTop: 10 }}>
            <StatusChip label={model.isExpired && model.status === "sent" ? "Expired" : model.statusLabel} tone={statusTone} />
          </div>
        </div>
      </div>

      <div style={{ height: 2, background: NAVY, margin: "20px 0 0" }} />

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, padding: "16px 0", borderBottom: `1px solid ${BORDER}` }}>
        <Meta label="Quote date" value={fmtDate(model.quoteDate)} />
        <Meta label="Valid until" value={fmtDate(model.expirationDate)} />
        <Meta label="Terms" value={model.paymentTermsLabel} />
        <Meta label="Currency" value={c} />
        {model.customerReference && <Meta label="Your reference" value={model.customerReference} />}
      </div>

      {/* Addresses */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, padding: "20px 0" }}>
        <AddressBlock heading="Bill to" name={model.billTo.name} lines={model.billTo.lines} />
        <AddressBlock heading="Ship to" name={model.shipTo.name} lines={model.shipTo.lines} />
      </div>

      {/* Line items */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
            <Th style={{ width: "16%" }}>SKU</Th>
            <Th>Description</Th>
            <Th align="right" style={{ width: "10%" }}>Qty</Th>
            <Th align="right" style={{ width: "16%" }}>Unit price</Th>
            <Th align="right" style={{ width: "16%" }}>Line total</Th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <Td style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12, wordBreak: "break-word" }}>{l.sku}</Td>
              <Td style={{ wordBreak: "break-word" }}>{l.description}</Td>
              <Td align="right">{qty(l.quantity)}</Td>
              <Td align="right">{money(l.unitPrice, c)}</Td>
              <Td align="right">{money(l.lineTotal, c)}</Td>
            </tr>
          ))}
          {model.lines.length === 0 && (
            <tr>
              <Td colSpan={5} style={{ color: MUTED, textAlign: "center", padding: "24px 0" }}>No line items.</Td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ width: "58%", maxWidth: 340 }}>
          <TotalRow label="Subtotal" value={money(model.subtotal, c)} />
          {showDiscount && <TotalRow label="Discount" value={`(${money(model.discount, c)})`} />}
          {showShipping && <TotalRow label="Shipping" value={money(model.shipping, c)} />}
          {showFees && <TotalRow label="Fees" value={money(model.fees, c)} />}
          {showTax && <TotalRow label={`Tax (${(model.taxRate * 100).toFixed(model.taxRate * 100 % 1 === 0 ? 0 : 3)}%)`} value={money(model.taxAmount, c)} />}
          <div style={{ height: 1, background: NAVY, margin: "8px 0" }} />
          <div
            style={{
              display: "flex", justifyContent: "space-between", marginTop: 8, padding: "10px 12px",
              background: "#F3F6F1", borderRadius: 8, border: `1px solid #DCE6D5`,
            }}
          >
            <span style={{ fontWeight: 700, color: NAVY }}>Quote total</span>
            <span style={{ fontWeight: 700, color: NAVY }}>{money(model.total, c)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {model.notes && (
        <div style={{ marginTop: 28 }}>
          <Panel heading="Notes & terms">
            <div style={{ whiteSpace: "pre-wrap" }}>{model.notes}</div>
          </Panel>
        </div>
      )}

      {/* Customer acceptance area */}
      {model.showAcceptance && (
        <div style={{ marginTop: 28, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "16px 18px", background: "#FBFAF6" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600, marginBottom: 12 }}>
            Acceptance
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 18 }}>
            To accept this quote, sign below and return it{model.expirationDate ? ` on or before ${fmtDate(model.expirationDate)}` : ""}.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 28 }}>
            <SignLine label="Authorized signature" />
            <SignLine label="Date" />
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 32, paddingTop: 14, borderTop: `1px solid ${BORDER}`, textAlign: "center", color: MUTED, fontSize: 12 }}>
        {model.footer || `This is a quotation, not an invoice. Prices are valid until the date shown. Thank you — ${model.company.name}.`}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600 }}>{label}</div>
      <div style={{ color: INK, marginTop: 2, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function SignLine({ label }: { label: string }) {
  return (
    <div>
      <div style={{ borderBottom: `1px solid ${NAVY}`, height: 28 }} />
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{label}</div>
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
function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px", fontWeight: strong ? 700 : 400, color: strong ? NAVY : INK }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
function Panel({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600, marginBottom: 6 }}>{heading}</div>
      <div style={{ fontSize: 12.5, color: INK }}>{children}</div>
    </div>
  );
}
