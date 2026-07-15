"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Factory, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ManufacturerFormDialog } from "@/components/catalog/manufacturer-form-dialog";
import type { Manufacturer } from "@/lib/catalog/queries";

type ManufacturerWithStats = Manufacturer & { products_supplied: number; last_cost_update: string | null };

const fmtDate = (s: string | null) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString() : "—");

export function ManufacturersManager({ manufacturers }: { manufacturers: ManufacturerWithStats[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" asChild><Link href="/catalog/manufacturers/import"><Upload className="h-4 w-4" /> Import cost file</Link></Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add manufacturer</Button>
      </div>

      {manufacturers.length === 0 ? (
        <EmptyState icon={Factory} title="No manufacturers yet" description="Add your suppliers, or let the import wizard create them from your spreadsheet." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead>Last cost update</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manufacturers.map((m) => (
                <TableRow key={m.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/catalog/manufacturers/${m.id}`} className="hover:underline">{m.name}</Link>
                    {m.legal_name && <div className="text-xs text-muted-foreground">{m.legal_name}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.contact_name ?? m.email ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.products_supplied}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(m.last_cost_update)}</TableCell>
                  <TableCell className="text-muted-foreground">{m.default_currency}</TableCell>
                  <TableCell><Badge variant={m.status === "active" ? "success" : "outline"}>{m.status === "active" ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ManufacturerFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
