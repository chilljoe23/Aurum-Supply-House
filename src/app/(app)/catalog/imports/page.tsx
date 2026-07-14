import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { getImportBatches } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Import History" };
export const dynamic = "force-dynamic";

const statusVariant: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  committed: "success", failed: "destructive", previewed: "outline", pending: "outline",
};

export default async function ImportsPage() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "admin")) redirect("/catalog");

  const batches = await getImportBatches();

  return (
    <div className="space-y-6">
      <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>
      <PageHeader title="Import history" description="Every catalog import, with counts, status, and original files." />

      {batches.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No imports yet" description="Catalog imports will be listed here with full row-level results." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Costs</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/catalog/imports/${b.id}`} className="font-medium hover:underline">{b.filename}</Link>
                    <div className="text-xs text-muted-foreground">{b.file_type?.toUpperCase()}{b.worksheet ? ` · ${b.worksheet}` : ""}{b.mode ? ` · ${b.mode}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.row_count}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{b.products_created}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.products_updated}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.costs_updated}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{b.rows_skipped}</TableCell>
                  <TableCell><Badge variant={statusVariant[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
