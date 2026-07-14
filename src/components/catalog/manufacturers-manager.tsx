"use client";

import * as React from "react";
import { Plus, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ManufacturerFormDialog } from "@/components/catalog/manufacturer-form-dialog";
import type { Manufacturer } from "@/lib/catalog/queries";

export function ManufacturersManager({ manufacturers }: { manufacturers: Manufacturer[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
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
                <TableHead>Email</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manufacturers.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}{m.legal_name && <div className="text-xs text-muted-foreground">{m.legal_name}</div>}</TableCell>
                  <TableCell className="text-muted-foreground">{m.contact_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{m.payment_terms ?? "—"}</TableCell>
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
