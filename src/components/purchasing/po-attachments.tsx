"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Upload, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ATTACHMENT_CATEGORY_OPTIONS } from "@/lib/purchase-orders/schemas";
import { uploadPoAttachment, getPoAttachmentUrl } from "@/app/(app)/purchasing/actions";

type Attachment = {
  id: string;
  type: string;
  filename: string;
  storage_path: string;
  file_type: string | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
};

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  ATTACHMENT_CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PoAttachments({ poId, attachments }: { poId: string; attachments: Attachment[] }) {
  const router = useRouter();
  const [category, setCategory] = React.useState("manufacturer_invoice");
  const [note, setNote] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload() {
    if (!file) { setErr("Choose a file first."); return; }
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("po_id", poId);
    fd.set("type", category);
    fd.set("note", note);
    fd.set("file", file);
    const res = await uploadPoAttachment(fd);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setFile(null);
    setNote("");
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function open(path: string, id: string) {
    setOpening(id);
    const res = await getPoAttachmentUrl(path);
    setOpening(null);
    if (res.ok && res.data) window.open(res.data.url, "_blank", "noopener,noreferrer");
    else setErr(res.ok ? "Could not open file." : res.error);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            {ATTACHMENT_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">File</Label>
          <Input ref={inputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button onClick={upload} disabled={busy || !file}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
        </Button>
        <div className="space-y-1.5 sm:col-span-4">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {attachments.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No attachments yet.</li>}
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{a.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {CATEGORY_LABEL[a.type] ?? a.type}
                  {a.size_bytes ? ` · ${fmtSize(a.size_bytes)}` : ""}
                  {a.note ? ` · ${a.note}` : ""}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => open(a.storage_path, a.id)} disabled={opening === a.id}>
              {opening === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} View
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
