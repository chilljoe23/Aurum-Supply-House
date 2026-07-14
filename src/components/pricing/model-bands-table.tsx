"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Pencil, CalendarX } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { PriceItemDialog, type ProductOption } from "@/components/pricing/price-item-dialog";
import { formatCurrency } from "@/lib/utils";
import { endDatePriceBand } from "@/app/(app)/pricing/actions";
import type { ModelBand } from "@/lib/pricing/queries";
import { Tags } from "lucide-react";

export function ModelBandsTable({ bands, products, sheetId, currency, canManage, canSeeCost }: {
  bands: ModelBand[]; products: ProductOption[]; sheetId: string; currency: string; canManage: boolean; canSeeCost: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [edit, setEdit] = React.useState<ModelBand | null>(null);

  const rows = bands.filter((b) => !q || `${b.sku} ${b.name}`.toLowerCase().includes(q.toLowerCase()));

  async function endDate(id: string) {
    await endDatePriceBand(id, sheetId);
    router.refresh();
  }

  if (bands.length === 0) {
    return <EmptyState icon={Tags} title="No prices yet" description="Add product prices or import a pricing sheet to populate this model." />;
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU or product…" className="pl-9" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Band</TableHead>
            <TableHead className="text-right">Price</TableHead>
            {canSeeCost && <><TableHead className="text-right">True Cost</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Margin %</TableHead></>}
            {canManage && <TableHead />}
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.item_id}>
                <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                <TableCell>{b.name}{b.strength && <span className="text-muted-foreground"> · {b.strength}</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.min_quantity}{b.max_quantity ? `–${b.max_quantity}` : "+"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatCurrency(b.selling_price, b.currency)}</TableCell>
                {canSeeCost && <>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(b.true_cost, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(b.margin_amount, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.margin_pct != null ? (
                      <Badge variant={b.below_cost ? "destructive" : (b.margin_pct < 0.1 ? "warning" : "success")}>
                        {(b.margin_pct * 100).toFixed(1)}%
                      </Badge>
                    ) : "—"}
                  </TableCell>
                </>}
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Update price" onClick={() => setEdit(b)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" title="End-date this price" onClick={() => endDate(b.item_id)}><CalendarX className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canManage && edit && (
        <PriceItemDialog
          open={!!edit} onOpenChange={(o) => !o && setEdit(null)}
          sheetId={sheetId} currency={currency} products={products}
          preset={{ product_id: edit.product_id, min_quantity: edit.min_quantity, max_quantity: edit.max_quantity, selling_price: edit.selling_price }}
        />
      )}
    </div>
  );
}
