import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getInvoiceViewModel } from "@/lib/orders/queries";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { PrintButton } from "@/components/orders/print-button";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function InvoicePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = await getInvoiceViewModel(id);
  if (!model) notFound();

  return (
    <div className="space-y-5">
      {/* Print rules: US-Letter, isolate the document from the app shell so only
          the invoice prints (regardless of sidebar/topbar). Grayscale-friendly. */}
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
        <PrintButton />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 print:border-0 print:bg-transparent print:p-0">
        <div className="shadow-sm">
          <InvoiceDocument model={model} />
        </div>
      </div>
    </div>
  );
}
