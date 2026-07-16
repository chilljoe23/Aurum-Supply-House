"use client";

import * as React from "react";
import { Printer, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Customer-facing document toolbar.
//
// Primary action = a TRUE PDF download: it fetches the server PDF route (which
// enforces the same auth + RLS as the preview and streams application/pdf with a
// deterministic attachment filename), then saves the bytes to disk. The exact
// same normalized view model and document component power both the preview and
// that PDF, so they can never drift.
//
// Print-to-PDF is kept as a secondary fallback for environments where the
// server-side renderer is unavailable.
export function DocumentDownload({
  pdfHref,
  filename,
  downloadLabel = "Download PDF",
}: {
  pdfHref: string;
  filename: string;
  downloadLabel?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(pdfHref, { headers: { Accept: "application/pdf" } });
      if (!res.ok) {
        throw new Error(
          res.status === 503
            ? "PDF service unavailable — use Print / Save as PDF."
            : `Could not generate PDF (${res.status}).`,
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => window.print()} title="Print or save via the browser">
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <Button onClick={download} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloadLabel}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
