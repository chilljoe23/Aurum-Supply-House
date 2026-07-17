import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getPurchaseOrderViewModel } from "@/lib/purchase-orders/queries";
import { PurchaseOrderDocument } from "@/components/purchasing/purchase-order-document";
import { documentPdfFilename } from "@/lib/documents/branding";
import { getLogoDataUri, renderDocumentToPdf, ChromiumNotFoundError } from "@/lib/documents/pdf";

// True PDF download for the vendor-facing purchase order.
//
// Security: mirrors the preview page's gate. Purchasing is Owner/Admin-only, so
// we re-check the session AND the role here (defense in depth); a Sales Rep gets
// 403, and getPurchaseOrderViewModel reads through the admin-only RLS views with
// the caller's cookies, so any other id resolves to 404. No service-role key is
// used. The document receives the PO view model, which structurally omits selling
// price, profit, margin, commission and internal expenses — the only price it
// carries is unit COST, which is appropriate on an authorized vendor document.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner" && user.role !== "admin") return new Response("Forbidden", { status: 403 });

  const model = await getPurchaseOrderViewModel(id);
  if (!model) return new Response("Not found", { status: 404 });

  try {
    const pdf = await renderDocumentToPdf(
      createElement(PurchaseOrderDocument, { model, logoSrc: getLogoDataUri() }),
      `Purchase Order ${model.poNumber} — Aurum Supply House`,
    );
    const filename = documentPdfFilename("Purchase-Order", model.poNumber);
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
