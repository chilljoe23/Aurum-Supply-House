import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ReactElement } from "react";

// ============================================================================
// Server-only document → PDF pipeline.
// ----------------------------------------------------------------------------
// The SAME React document component that renders the on-screen preview is
// rendered to static HTML here and printed to a real PDF by a headless Chromium
// (via puppeteer-core). Preview and PDF therefore cannot drift: one component,
// one customer-safe view model, one set of values.
//
// This module is server-only. It never runs in the browser and imports nothing
// privileged — no Supabase, no service-role key. The route that calls it is
// responsible for authentication and RLS-scoped data loading; this file only
// turns already-authorized, already-sanitized HTML into bytes.
// ============================================================================

// ---- Cached assets (read once per server process) --------------------------

let logoDataUriCache: string | null = null;
export function getLogoDataUri(): string {
  if (logoDataUriCache) return logoDataUriCache;
  const p = join(process.cwd(), "public", "brand", "aurum-logo.png");
  const b64 = readFileSync(p).toString("base64");
  logoDataUriCache = `data:image/png;base64,${b64}`;
  return logoDataUriCache;
}

let fontCssCache: string | null = null;
// Embed the app's Geist typefaces as @font-face data URIs so the PDF matches the
// on-screen preview exactly, with zero network/font dependency at print time.
function getFontFaceCss(): string {
  if (fontCssCache != null) return fontCssCache;
  const faces: string[] = [];
  const fonts: Array<{ file: string; family: string }> = [
    { file: join("geist-sans", "Geist-Variable.woff2"), family: "Geist Sans" },
    { file: join("geist-mono", "GeistMono-Variable.woff2"), family: "Geist Mono" },
  ];
  for (const f of fonts) {
    const p = join(process.cwd(), "node_modules", "geist", "dist", "fonts", f.file);
    if (!existsSync(p)) continue;
    const b64 = readFileSync(p).toString("base64");
    faces.push(
      `@font-face{font-family:'${f.family}';font-style:normal;font-weight:100 900;` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`,
    );
  }
  fontCssCache = faces.join("\n");
  return fontCssCache;
}

// ---- HTML wrapper -----------------------------------------------------------

// Print/pagination CSS applied to the document body. Mirrors the browser-print
// rules used on the preview pages so a saved PDF and a Ctrl-P print look the
// same. Pagination guards (rows never split, headers repeat, totals/footer stay
// together) also live as inline styles on the components; these are the belt to
// that suspenders and cover any browser that ignores inline break hints.
const PRINT_CSS = `
  *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html,body{ margin:0; padding:0; background:#fff; }
  body{ font-family:'Geist Sans', ui-sans-serif, system-ui, -apple-system, sans-serif; }
  :root{ --font-geist-sans:'Geist Sans'; --font-geist-mono:'Geist Mono'; }
  [data-print-root]{ padding:0 !important; }
  thead{ display:table-header-group; }
  tr{ break-inside:avoid; page-break-inside:avoid; }
  [data-keep-together]{ break-inside:avoid; page-break-inside:avoid; }
`;

// Bind the CSS variables the components reference to the embedded families and
// wrap the rendered document markup in a complete, self-contained HTML page.
export function wrapDocumentHtml(bodyHtml: string, title: string): string {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"/>" +
    `<title>${escapeHtml(title)}</title>` +
    "<style>" +
    getFontFaceCss() +
    PRINT_CSS +
    "</style></head><body>" +
    bodyHtml +
    "</body></html>"
  );
}

// react-dom/server is imported dynamically (never on the static route graph) so
// the App Router build does not treat these routes as server components.
export async function renderDocumentToHtml(element: ReactElement, title: string): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return wrapDocumentHtml(renderToStaticMarkup(element), title);
}

// One call from the routes: customer-safe element → self-contained HTML → PDF.
export async function renderDocumentToPdf(element: ReactElement, title: string): Promise<Uint8Array> {
  const html = await renderDocumentToHtml(element, title);
  return htmlToPdf(html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// ---- Chromium resolution ----------------------------------------------------

// Resolve a Chrome/Chromium executable without bundling one. Order:
//   1. PUPPETEER_EXECUTABLE_PATH / CHROME_PATH (explicit, for deployment)
//   2. common Linux locations (servers/containers)
//   3. common macOS locations (local dev)
// Returns null when none is found; the route then reports a clear error and the
// UI's print-to-PDF fallback still works.
function resolveChromeExecutable(): string | null {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export class ChromiumNotFoundError extends Error {
  constructor() {
    super("No Chrome/Chromium executable found for PDF generation.");
    this.name = "ChromiumNotFoundError";
  }
}

// ---- HTML → PDF -------------------------------------------------------------

// Convert a complete HTML document to a US-Letter PDF. Margins match the
// preview's @page rule (0.5in). printBackground keeps the subtle cream accents;
// preferCSSPageSize honors @page if the document sets it.
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) throw new ChromiumNotFoundError();

  // Lazy import so puppeteer-core is only loaded on the PDF path, never bundled
  // into any client or page render.
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    // Everything (logo + fonts) is inlined as data: URIs, so "load" is enough;
    // then wait for the embedded fonts so text metrics are final before layout.
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
