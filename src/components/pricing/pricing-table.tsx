"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Upload, Download, Search, Tags, Star } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { ModelFormDialog } from "@/components/pricing/model-form-dialog";
import { cn } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import type { PricingModel } from "@/lib/pricing/queries";

export function PricingTable({ models, canManage }: { models: PricingModel[]; canManage: boolean }) {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "inactive" | "all">("active");
  const [addOpen, setAddOpen] = React.useState(false);

  const filtered = models.filter((m) => {
    if (status === "active" && m.status !== "active") return false;
    if (status === "inactive" && m.status !== "archived") return false;
    if (q && !`${m.name} ${m.code ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function exportCsv() {
    downloadCsv("aurum-pricing-models.csv", toCsv(
      [{ key: "name", label: "Name" }, { key: "code", label: "Code" }, { key: "currency", label: "Currency" },
       { key: "products_priced", label: "Products Priced" }, { key: "clients_assigned", label: "Clients" },
       { key: "is_default", label: "Default" }, { key: "status", label: "Status" }],
      filtered as unknown as Record<string, unknown>[]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" className="pl-9" />
          </div>
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["active", "inactive", "all"] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={cn("rounded px-2.5 py-1 text-xs capitalize transition-colors", status === s ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>{s}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
          {canManage && (<>
            <Button variant="outline" size="sm" asChild><Link href="/pricing/import"><Upload className="h-4 w-4" /> Import Sheet</Link></Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Create Model</Button>
          </>)}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} {filtered.length === 1 ? "model" : "models"}</div>

      {filtered.length === 0 ? (
        <EmptyState icon={Tags} title={models.length === 0 ? "No pricing models yet" : "No matching models"}
          description={models.length === 0 ? "Create a model or import a pricing sheet to start pricing your catalog." : "Adjust your search or filter."}
          action={canManage && models.length === 0 ? <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Create Model</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>Model</TableHead><TableHead>Currency</TableHead>
              <TableHead className="text-right">Products</TableHead><TableHead className="text-right">Clients</TableHead>
              <TableHead>Status</TableHead><TableHead>Updated</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/pricing/${m.id}`} className="font-medium hover:underline">{m.name}</Link>
                    {m.is_default && <Badge variant="warning" className="ml-2"><Star className="mr-1 h-3 w-3" />Default</Badge>}
                    {m.code && <div className="text-xs text-muted-foreground">{m.code}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.currency}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.products_priced}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.clients_assigned}</TableCell>
                  <TableCell><Badge variant={m.status === "active" ? "success" : "outline"}>{m.status === "active" ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(m.updated_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && <ModelFormDialog open={addOpen} onOpenChange={setAddOpen} mode="create" />}
    </div>
  );
}
