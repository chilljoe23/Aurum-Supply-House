import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getPackingSlipViewModel } from "@/lib/orders/queries";
import { PackingSlipDocument } from "@/components/orders/packing-slip-document";
import { documentPdfFilename } from "@/lib/documents/branding";
import { getLogoDataUri, renderDocumentToPdf, ChromiumNotFoundError } from "@/lib/documents/pdf";

// True PDF download for the customer-facing packing slip.
//
// Security: mirrors the invoice/quote/PO PDF routes. Middleware blocks
// unauthenticated requests; we re-check the session here (defense in depth) and
// require Owner/Admin (shipment documents are an Owner/Admin surface).
// getPackingSlipViewModel reads through the RLS-scoped fulfillment views with the
// caller's cookies, so an out-of-book order/shipment id resolves to 404. No
// service-role key is used. The model is the customer-safe packing-slip view
// model, which structurally omits every price/cost/profit/commission field.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; shipmentId: string }> }) {
  const { id, shipmentId } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner" && user.role !== "admin") return new Response("Forbidden", { status: 403 });

  const model = await getPackingSlipViewModel(id, shipmentId);
  if (!model) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentToPdf(
      createElement(PackingSlipDocument, { model, logoSrc: getLogoDataUri() }),
      `Packing Slip ${model.packingSlipNumber} — Aurum Supply House`,
    );
    const filename = documentPdfFilename("Packing-Slip", model.packingSlipNumber);
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
