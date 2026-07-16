import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getQuoteViewModel } from "@/lib/quotes/queries";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { documentPdfFilename } from "@/lib/documents/branding";
import { getLogoDataUri, renderDocumentToPdf, ChromiumNotFoundError } from "@/lib/documents/pdf";

// True PDF download for the customer-facing quote.
//
// Security: mirrors the preview route. Middleware blocks unauthenticated
// requests; we re-check the session here (defense in depth), and
// getQuoteViewModel reads through the RLS-scoped v_quotes view with the caller's
// cookies — a rep can only render quotes in their permitted book, and any other
// id resolves to 404. No service-role key is used. The document receives the
// customer-safe view model, which structurally omits cost/margin/commission/
// price-source/override/internal-note fields.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const model = await getQuoteViewModel(id);
  if (!model) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentToPdf(
      createElement(QuoteDocument, { model, logoSrc: getLogoDataUri() }),
      `Quote ${model.quoteNumber} — Aurum Supply House`,
    );
    const filename = documentPdfFilename("Quote", model.quoteNumber);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ChromiumNotFoundError) {
      return new Response("PDF renderer unavailable", { status: 503 });
    }
    throw e;
  }
}
