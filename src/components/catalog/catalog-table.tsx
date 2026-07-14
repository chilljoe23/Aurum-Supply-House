"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Upload, Download, Search, ArrowUpDown, Boxes } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect, type Option } from "@/components/patterns/searchable-select";
import { EmptyState } from "@/components/patterns/empty-state";
import { ProductFormDialog } from "@/components/catalog/product-form-dialog";
import { formatCurrency, cn } from "@/lib/utils";
import { toCsv, downloadCsv } from "@/lib/catalog/csv";
import type { CatalogProduct, Manufacturer } from "@/lib/catalog/queries";

type SortKey =
  | "sku" | "name" | "strength" | "pack_size" | "manufacturer_name"
  | "true_cost" | "moq" | "lead_time_days" | "status" | "updated_at";

const PAGE_SIZE = 25;

export function CatalogTable({
  products,
  manufacturers,
  canManage,
  canSeeCost,
}: {
  products: CatalogProduct[];
  manufacturers: Manufacturer[];
  canManage: boolean;
  canSeeCost: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [mfr, setMfr] = React.useState<string>("");
  const [status, setStatus] = React.useState<"active" | "inactive" | "all">("active");
  const [category, setCategory] = React.useState<string>("");
  const [strength, setStrength] = React.useState("");
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [page, setPage] = React.useState(0);
  const [addOpen, setAddOpen] = React.useState(false);

  const categories = React.useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[],
    [products],
  );

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => {
      if (status === "active" && p.status !== "active") return false;
      if (status === "inactive" && p.status !== "discontinued") return false;
      if (mfr && p.manufacturer_id !== mfr) return false;
      if (category && p.category !== category) return false;
      if (strength && !(p.strength ?? "").toLowerCase().includes(strength.toLowerCase())) return false;
      if (term) {
        const hay = `${p.sku} ${p.name} ${p.manufacturer_name ?? ""} ${p.category ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [products, q, mfr, status, category, strength]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return arr;
  }, [filtered, sort]);

  React.useEffect(() => setPage(0), [q, mfr, status, category, strength]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const mfrOptions: Option[] = [
    { value: "", label: "All manufacturers" },
    ...manufacturers.map((m) => ({ value: m.id, label: m.name })),
  ];
  const catOptions: Option[] = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  function exportCsv() {
    const cols = [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Product Name" },
      { key: "strength", label: "Strength" },
      { key: "pack_size", label: "Pack Size" },
      { key: "manufacturer_name", label: "Manufacturer" },
      { key: "category", label: "Category" },
      ...(canSeeCost ? [{ key: "true_cost", label: "True Cost" }] : []),
      { key: "moq", label: "MOQ" },
      { key: "lead_time_days", label: "Lead Time (days)" },
      { key: "status", label: "Status" },
    ];
    downloadCsv(`aurum-catalog-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(cols, sorted));
  }

  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {children}
        <ArrowUpDown className={cn("h-3 w-3", sort.key === k ? "opacity-90" : "opacity-40")} />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name, manufacturer…" className="pl-9" />
          </div>
          <div className="w-44"><SearchableSelect options={mfrOptions} value={mfr} onChange={setMfr} placeholder="Manufacturer" /></div>
          {categories.length > 0 && (
            <div className="w-40"><SearchableSelect options={catOptions} value={category} onChange={setCategory} placeholder="Category" /></div>
          )}
          <Input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="Strength" className="w-28" />
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["active", "inactive", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                  status === s ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/catalog/import"><Upload className="h-4 w-4" /> Import Excel</Link>
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Product
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {sorted.length.toLocaleString()} {sorted.length === 1 ? "product" : "products"}
        {sorted.length !== products.length && ` (filtered from ${products.length.toLocaleString()})`}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={products.length === 0 ? "Your catalog is empty" : "No matching products"}
          description={products.length === 0
            ? "Import a manufacturer spreadsheet or add a product to get started."
            : "Try adjusting your search or filters."}
          action={canManage && products.length === 0 ? (
            <Button asChild><Link href="/catalog/import"><Upload className="h-4 w-4" /> Import Excel</Link></Button>
          ) : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead k="sku">SKU</SortHead>
                <SortHead k="name">Product</SortHead>
                <SortHead k="strength">Strength</SortHead>
                <SortHead k="pack_size">Pack</SortHead>
                <SortHead k="manufacturer_name">Manufacturer</SortHead>
                {canSeeCost && <SortHead k="true_cost" className="text-right">True Cost</SortHead>}
                <SortHead k="moq" className="text-right">MOQ</SortHead>
                <SortHead k="lead_time_days" className="text-right">Lead</SortHead>
                <SortHead k="status">Status</SortHead>
                <SortHead k="updated_at">Updated</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((p) => (
                <TableRow key={p.id} className="cursor-pointer">
                  <TableCell className="font-mono text-xs">
                    <Link href={`/catalog/${p.id}`} className="hover:underline">{p.sku}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/catalog/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    {p.category && <div className="text-xs text-muted-foreground">{p.category}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.strength ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.pack_size ?? "—"}</TableCell>
                  <TableCell>{p.manufacturer_name ?? "—"}</TableCell>
                  {canSeeCost && (
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(p.true_cost, p.currency)}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums text-muted-foreground">{p.moq ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {p.lead_time_days != null ? `${p.lead_time_days}d` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === "active" ? "success" : "outline"}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {canManage && (
        <ProductFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          manufacturers={manufacturers}
          mode="create"
        />
      )}
    </div>
  );
}
