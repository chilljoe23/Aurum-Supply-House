import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getPurchaseOrderViewModel } from "@/lib/purchase-orders/queries";
import { PurchaseOrderDocument } from "@/components/purchasing/purchase-order-document";
import { PrintButton } from "@/components/orders/print-button";
import { RestrictedNotice } from "@/components/purchasing/restricted-notice";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

export default async function PurchaseOrderDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user?.role !== "owner" && user?.role !== "admin") return <RestrictedNotice />;

  const model = await getPurchaseOrderViewModel(id);
  if (!model) notFound();

  return (
    <div className="space-y-5">
      {/* Print rules: US-Letter, isolate the document from the app shell so only
          the PO prints (regardless of sidebar/topbar). Grayscale-friendly. */}
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
        <Link href={`/purchasing/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to purchase order
        </Link>
        <PrintButton />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
        <div className="shadow-sm">
          <PurchaseOrderDocument model={model} />
        </div>
      </div>
    </div>
  );
}
