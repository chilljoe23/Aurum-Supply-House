import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getPackingSlipViewModel } from "@/lib/orders/queries";
import { PackingSlipDocument } from "@/components/orders/packing-slip-document";
import { DocumentDownload } from "@/components/documents/document-download";
import { documentPdfFilename } from "@/lib/documents/branding";

export const metadata: Metadata = { title: "Packing slip" };
export const dynamic = "force-dynamic";

export default async function PackingSlipPreviewPage({
  params,
}: {
  params: Promise<{ id: string; shipmentId: string }>;
}) {
  const { id, shipmentId } = await params;

  // Owner/Admin only surface (shipment documents). Book scope is additionally
  // enforced at the DB by the row-scoped view model below.
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) notFound();

  const model = await getPackingSlipViewModel(id, shipmentId);
  if (!model) notFound();

  return (
    <div className="space-y-5">
      {/* Print rules: US-Letter, isolate the document from the app shell so only
          the packing slip prints (regardless of sidebar/topbar). Grayscale-friendly. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: letter; margin: 0.5in; }
              body { visibility: hidden !important; background: #fff !important; }
              [data-print-root], [data-print-root] * { visibility: visible !important; }
              [data-print-root] { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; }
            }
          `,
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/orders/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to order
        </Link>
        <DocumentDownload
          pdfHref={`/orders/${id}/shipments/${shipmentId}/packing-slip/pdf`}
          filename={documentPdfFilename("Packing-Slip", model.packingSlipNumber)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
        <div className="shadow-sm">
          <PackingSlipDocument model={model} />
        </div>
      </div>
    </div>
  );
}
