// ============================================================================
// Aurum Supply House — official document branding constants.
// ----------------------------------------------------------------------------
// Client-safe (no server-only imports): shared by the document components, the
// preview pages, and the PDF routes so the customer-facing identity is defined
// in exactly one place.
//
// Company identity is fixed by policy: name + city/state/country ONLY. No street
// address, phone, email, website, tax id, or bank details are ever displayed on
// a customer document. Optional body sections (payment instructions, terms,
// footer) still render from Settings, but only when they hold real saved values.
// ============================================================================

export const COMPANY_NAME = "Aurum Supply House";
export const COMPANY_LOCATION = "Sarasota, Florida, USA";

// Served from /public in the browser preview (same-origin, print-safe). The PDF
// route inlines the same file as a data: URI instead (see lib/documents/pdf.ts).
export const LOGO_PUBLIC_PATH = "/brand/aurum-logo.png";

// Intrinsic pixel size of the shipped wordmark; aspect is preserved when the
// document renders it at a fixed height with width:auto.
export const LOGO_WIDTH = 2579;
export const LOGO_HEIGHT = 745;
export const LOGO_ASPECT = LOGO_WIDTH / LOGO_HEIGHT; // ≈ 3.462

// Deterministic, filesystem-safe document filenames, e.g.
//   Aurum-Invoice-AUR-1001.pdf   Aurum-Quote-QTE-1001.pdf
//   Aurum-Purchase-Order-PO-1001.pdf   Aurum-Packing-Slip-PS-1001.pdf
// Any character outside [A-Za-z0-9._-] is collapsed to a single dash; leading/
// trailing dashes are trimmed. A blank/symbol-only number degrades to the doc kind.
export function sanitizeFilenamePart(raw: string): string {
  return (raw ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function documentPdfFilename(
  kind: "Invoice" | "Quote" | "Purchase-Order" | "Packing-Slip",
  number: string,
): string {
  const num = sanitizeFilenamePart(number);
  return num ? `Aurum-${kind}-${num}.pdf` : `Aurum-${kind}.pdf`;
}
