import type { PurchaseOrderViewModel } from "@/lib/purchase-orders/purchase-order-document";

// ============================================================================
// The Aurum PURCHASE ORDER document. Shares the approved invoice's visual system
// (deep navy #112B46, muted sage #758B6A, warm ivory/cream, warm-gray borders,
// Geist) so it reads as part of the family. The SAME component renders the
// on-screen preview and the printable/PDF output, so the two cannot drift.
// Colors are committed hex (not theme tokens): it reads the same light/dark and
// prints cleanly on grayscale.
//
// It receives ONLY PO-appropriate data. Customer selling prices, customer pricing
// models, gross profit / margin, net profit, commissions, and unrelated customer
// information are NOT fields on PurchaseOrderViewModel and cannot appear here.
// The only price shown is unit COST — what Aurum pays the manufacturer.
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

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  deposit_paid: "Deposit paid",
  production: "Production",
  testing: "Testing",
  ready_to_ship: "Ready to ship",
  shipped: "Shipped",
  received: "Received",
  closed: "Closed",
  void: "Void",
};

function StatusChip({ status }: { status: string }) {
  const isVoid = status === "void";
  const label = STATUS_LABELS[status] ?? status;
  const color = isVoid ? "#B76A5B" : status === "received" || status === "closed" ? SAGE : NAVY;
  return (
    <span
      style={{
        display: "inline-block", border: `1px solid ${color}`, color, borderRadius: 999,
        padding: "3px 12px", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
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
      {name && <div style={{ fontWeight: 600, color: INK }}>{name}</div>}
      {lines.length ? (
        lines.map((l, i) => <div key={i} style={{ color: MUTED, fontSize: 13 }}>{l}</div>)
      ) : (
        <div style={{ color: MUTED, fontSize: 13 }}>—</div>
      )}
    </div>
  );
}

export function PurchaseOrderDocument({ model }: { model: PurchaseOrderViewModel }) {
  const c = model.currency;
  const showShipping = model.shipping > 0;
  const showFees = model.fees > 0;
  const showTax = model.tax > 0;
  const showPayments = model.amountPaid > 0;

  return (
    <div
      data-print-root
      style={{
        background: "#FFFFFF", color: INK, maxWidth: "8.5in", margin: "0 auto",
        padding: "0.7in 0.75in", boxSizing: "border-box",
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
        fontSize: 13, lineHeight: 1.5, position: "relative",
      }}
    >
      {model.isVoid && (
        <div
          aria-hidden
          style={{
            position: "absolute", top: "38%", left: 0, right: 0, textAlign: "center",
            fontSize: 120, fontWeight: 800, color: "rgba(183,106,91,0.12)", letterSpacing: "0.1em",
            transform: "rotate(-18deg)", pointerEvents: "none",
          }}
        >
          VOID
        </div>
      )}

      {/* Header — brand + PO meta */}
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
            {model.company.lines.map((l, i) => <div key={i}>{l}</div>)}
            {model.company.email && <div>{model.company.email}</div>}
            {model.company.phone && <div>{model.company.phone}</div>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: NAVY, letterSpacing: "0.02em" }}>PURCHASE ORDER</div>
          <div style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 15, color: INK, marginTop: 2 }}>
            {model.poNumber}
          </div>
          <div style={{ marginTop: 10 }}>
            <StatusChip status={model.status} />
          </div>
        </div>
      </div>

      <div style={{ height: 2, background: NAVY, margin: "20px 0 0" }} />

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, padding: "16px 0", borderBottom: `1px solid ${BORDER}` }}>
        <Meta label="PO date" value={fmtDate(model.poDate)} />
        <Meta label="Expected" value={fmtDate(model.expectedDate)} />
        <Meta label="Payment terms" value={model.paymentTerms || "—"} />
        <Meta label="Currency" value={c} />
      </div>

      {/* Addresses — vendor (manufacturer) + ship-to (Aurum) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, padding: "20px 0" }}>
        <AddressBlock heading="Vendor" name={model.vendor.name} lines={model.vendor.lines} />
        <AddressBlock heading="Ship to" name={model.shipTo.name} lines={model.shipTo.lines} />
      </div>

      {/* Line items */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
            <Th style={{ width: "14%" }}>SKU</Th>
            <Th style={{ width: "14%" }}>Mfr SKU</Th>
            <Th>Description</Th>
            <Th align="right" style={{ width: "9%" }}>Qty</Th>
            <Th align="right" style={{ width: "15%" }}>Unit cost</Th>
            <Th align="right" style={{ width: "15%" }}>Line total</Th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <Td style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12 }}>{l.sku}</Td>
              <Td style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12 }}>{l.manufacturerSku || "—"}</Td>
              <Td>{l.description}</Td>
              <Td align="right">{qty(l.quantity)}</Td>
              <Td align="right">{money(l.unitCost, c)}</Td>
              <Td align="right">{money(l.lineTotal, c)}</Td>
            </tr>
          ))}
          {model.lines.length === 0 && (
            <tr>
              <Td colSpan={6} style={{ color: MUTED, textAlign: "center", padding: "24px 0" }}>No line items.</Td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ width: "58%", maxWidth: 340 }}>
          <TotalRow label="Subtotal" value={money(model.subtotal, c)} />
          {showShipping && <TotalRow label="Shipping" value={money(model.shipping, c)} />}
          {showFees && <TotalRow label="Fees" value={money(model.fees, c)} />}
          {showTax && <TotalRow label="Tax" value={money(model.tax, c)} />}
          <div style={{ height: 1, background: NAVY, margin: "8px 0" }} />
          <TotalRow label="Total" value={money(model.total, c)} strong />
          {showPayments && <TotalRow label="Amount paid" value={`(${money(model.amountPaid, c)})`} />}
          {showPayments && (
            <div
              style={{
                display: "flex", justifyContent: "space-between", marginTop: 8, padding: "10px 12px",
                background: model.isVoid ? "#FBF3F1" : "#F3F6F1", borderRadius: 8,
                border: `1px solid ${model.isVoid ? "#E6CFC8" : "#DCE6D5"}`,
              }}
            >
              <span style={{ fontWeight: 700, color: NAVY }}>Balance due</span>
              <span style={{ fontWeight: 700, color: NAVY }}>{money(model.balanceDue, c)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes / manufacturing instructions + signature */}
      <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        <Panel heading="Notes & manufacturing instructions">
          <div style={{ whiteSpace: "pre-wrap" }}>{model.notes || "—"}</div>
        </Panel>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600, marginBottom: 6 }}>
            Authorized by
          </div>
          <div style={{ marginTop: 34, borderTop: `1px solid ${INK}`, paddingTop: 6, color: MUTED, fontSize: 12 }}>
            Signature &amp; date
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, paddingTop: 14, borderTop: `1px solid ${BORDER}`, textAlign: "center", color: MUTED, fontSize: 12 }}>
        {model.footer || `Purchase order issued by ${model.company.name}.`}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600 }}>{label}</div>
      <div style={{ color: INK, marginTop: 2 }}>{value}</div>
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
