import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DownloadButton } from "@/components/catalog/download-button";
import { getCurrentUser } from "@/lib/auth";
import { getImportBatches, getImportRows } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Import Detail" };
export const dynamic = "force-dynamic";

export default async function ImportDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog");

  const batches = await getImportBatches();
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) notFound();

  const rows = await getImportRows(batchId);

  const stats = [
    { label: "Rows processed", value: batch.row_count },
    { label: "Created", value: batch.products_created },
    { label: "Updated", value: batch.products_updated },
    { label: "Cost updates", value: batch.costs_updated },
    { label: "Skipped", value: batch.rows_skipped },
  ];

  return (
    <div className="space-y-6">
      <Link href="/catalog/imports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Import history
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{batch.filename}</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(batch.created_at).toLocaleString()} · {batch.file_type?.toUpperCase()}
            {batch.worksheet ? ` · ${batch.worksheet}` : ""} · <Badge variant="outline">{batch.status}</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DownloadButton path={batch.storage_path} label="Original file" />
          {batch.error_report_path && <DownloadButton path={batch.error_report_path} label="Error report" variant="ghost" />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Row-level results</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Row</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Messages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const row = r as { row_number: number; sku: string | null; classification: string; status: string; messages: unknown };
                const msgs = Array.isArray(row.messages) ? (row.messages as string[]) : [];
                return (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{row.row_number}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{row.classification}</Badge></TableCell>
                    <TableCell className="text-sm">{row.status}</TableCell>
                    <TableCell className="text-xs text-destructive">{msgs.join("; ")}</TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No row detail recorded.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
