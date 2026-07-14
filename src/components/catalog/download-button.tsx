"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSignedDownload } from "@/app/(app)/catalog/actions";

export function DownloadButton({
  path,
  label,
  variant = "outline",
}: {
  path: string;
  label: string;
  variant?: "outline" | "ghost";
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await getSignedDownload(path);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.open(res.data!.url, "_blank", "noopener");
  }

  return (
    <span className="inline-flex flex-col">
      <Button variant={variant} size="sm" onClick={go} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {label}
      </Button>
      {error && <span className="mt-1 text-xs text-destructive">{error}</span>}
    </span>
  );
}
