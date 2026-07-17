import type { PackingSlipViewModel } from "@/lib/orders/packing-slip-view-model";
import { LOGO_PUBLIC_PATH } from "@/lib/documents/branding";

// ============================================================================
// The Aurum packing slip. Pure presentation of the customer-safe packing-slip
// view model — the SAME component renders the on-screen preview and the
// printable/PDF output, so the two cannot drift. Mirrors the invoice document's
// committed palette and print rules (repeating table header, rows never split
// across a page, kept-together footer) so it paginates cleanly across one or
// many pages and stays legible in grayscale.
//
// It receives ONLY quantities and lot traceability. Unit price, line price,
// totals, true cost, gross profit, margin, commission, internal expenses,
// manufacturer cost source, internal notes, and pricing-resolution source are
// not fields on PackingSlipViewModel and therefore cannot appear here.
// ============================================================================

const NAVY = "#112B46";
const SAGE = "#758B6A";
const INK = "#2B2B2B";
const MUTED = "#6B6B63";
const BORDER = "#E4E0D6";

function qty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function fmtDate(d: string | null): string {
  return d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
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

export function PackingSlipDocument({ model, logoSrc = LOGO_PUBLIC_PATH }: { model: PackingSlipViewModel; logoSrc?: string }) {
  const hasShipInfo = !!(model.carrier || model.service || model.trackingNumber || model.customerReference);

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

      {/* Header — brand + packing-slip meta */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand asset; also rendered by the headless-Chromium PDF route where next/image is unavailable */}
          <img src={logoSrc} alt={model.company.name} style={{ height: 44, width: "auto", display: "block" }} />
          <div style={{ marginTop: 8, color: INK, fontSize: 13, fontWeight: 600 }}>{model.company.name}</div>
          <div style={{ color: MUTED, fontSize: 12 }}>{model.company.location}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: NAVY, letterSpacing: "0.02em" }}>PACKING SLIP</div>
          <div style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 15, color: INK, marginTop: 2 }}>
            {model.packingSlipNumber}
          </div>
        </div>
      </div>

      <div style={{ height: 2, background: NAVY, margin: "20px 0 0" }} />

      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, padding: "16px 0", borderBottom: `1px solid ${BORDER}` }}>
        <Meta label="Shipment date" value={fmtDate(model.shipmentDate)} />
        <Meta label="Order no." value={model.orderNumber} mono />
        {model.customerReference && <Meta label="Your reference" value={model.customerReference} />}
      </div>

      {/* Addresses */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, padding: "20px 0" }}>
        <AddressBlock heading="Ship to" name={model.shipTo.name} lines={model.shipTo.lines} />
        <AddressBlock heading="Bill to" name={model.billTo.name} lines={model.billTo.lines} />
      </div>

      {/* Shipment information */}
      {hasShipInfo && (
        <div
          data-keep-together
          style={{
            display: "flex", flexWrap: "wrap", gap: 28, padding: "14px 16px", marginBottom: 4,
            background: "#F7F8F5", border: `1px solid ${BORDER}`, borderRadius: 8,
            breakInside: "avoid", pageBreakInside: "avoid",
          }}
        >
          {model.carrier && <Meta label="Carrier" value={model.carrier} />}
          {model.service && <Meta label="Service" value={model.service} />}
          {model.trackingNumber && (
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600 }}>Tracking</div>
              <div style={{ color: INK, marginTop: 2, fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12 }}>
                {model.trackingNumber}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Line items — quantities and lot traceability only */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        {/* thead repeats on every printed/PDF page so continuation pages keep column headings */}
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
            <Th style={{ width: "14%" }}>SKU</Th>
            <Th>Description</Th>
            <Th align="right" style={{ width: "9%" }}>Ordered</Th>
            <Th align="right" style={{ width: "10%" }}>Shipped now</Th>
            <Th align="right" style={{ width: "11%" }}>Prev. shipped</Th>
            <Th align="right" style={{ width: "10%" }}>Remaining</Th>
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, breakInside: "avoid", pageBreakInside: "avoid" }}>
              <Td style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 12 }}>{l.sku}</Td>
              <Td>
                {l.description}
                {(l.lotNumber || l.expirationDate || l.retestDate) && (
                  <div style={{ marginTop: 2, fontSize: 11, color: MUTED }}>
                    {l.lotNumber ? `Lot ${l.lotNumber}` : ""}
                    {l.lotNumber && (l.expirationDate || l.retestDate) ? " · " : ""}
                    {l.expirationDate ? `Exp ${fmtDate(l.expirationDate)}` : l.retestDate ? `Retest ${fmtDate(l.retestDate)}` : ""}
                  </div>
                )}
              </Td>
              <Td align="right">{qty(l.quantityOrdered)}</Td>
              <Td align="right" style={{ fontWeight: 600 }}>{qty(l.quantityThisShipment)}</Td>
              <Td align="right">{qty(l.previouslyShipped)}</Td>
              <Td align="right">{qty(l.remainingAfter)}</Td>
            </tr>
          ))}
          {model.lines.length === 0 && (
            <tr>
              <Td colSpan={6} style={{ color: MUTED, textAlign: "center", padding: "24px 0" }}>No items in this shipment.</Td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Footer */}
      <div data-keep-together style={{ marginTop: 32, paddingTop: 14, borderTop: `1px solid ${BORDER}`, textAlign: "center", color: MUTED, fontSize: 12, breakInside: "avoid", pageBreakInside: "avoid" }}>
        {model.footer}
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: SAGE, fontWeight: 600 }}>{label}</div>
      <div style={{ color: INK, marginTop: 2, fontFamily: mono ? "var(--font-geist-mono), ui-monospace, monospace" : undefined, fontSize: mono ? 12 : undefined }}>
        {value}
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
