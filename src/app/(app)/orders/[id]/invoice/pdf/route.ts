import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getInvoiceViewModel } from "@/lib/orders/queries";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { documentPdfFilename } from "@/lib/documents/branding";
import { getLogoDataUri, renderDocumentToPdf, ChromiumNotFoundError } from "@/lib/documents/pdf";

// True PDF download for the customer-facing invoice.
//
// Security: this route enforces the SAME rules as the preview. Middleware
// already blocks unauthenticated requests; we re-check the session here
// (defense in depth), and getInvoiceViewModel reads through the RLS-scoped
// v_orders view with the caller's cookies — so a rep can only render invoices in
// their permitted book, and any other id resolves to 404. No service-role key is
// used. The model passed to the document is the customer-safe view model, which
// structurally omits cost/profit/margin/commission/internal fields.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const model = await getInvoiceViewModel(id);
  if (!model) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentToPdf(
      createElement(InvoiceDocument, { model, logoSrc: getLogoDataUri() }),
      `Invoice ${model.invoiceNumber} — Aurum Supply House`,
    );
    const filename = documentPdfFilename("Invoice", model.invoiceNumber);
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
