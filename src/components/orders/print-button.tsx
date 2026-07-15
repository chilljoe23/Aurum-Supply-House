"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Download PDF" = the browser's print-to-PDF on a US-Letter document. The same
// InvoiceDocument (from the shared view model) is what prints, so the on-screen
// preview and the PDF are guaranteed identical.
export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      {label}
    </Button>
  );
}
