import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, Factory, Tags, ShoppingCart, ReceiptText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ProductDetailActions } from "@/components/catalog/product-detail-actions";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatCurrency } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import {
  getCatalogProduct, getManufacturers, getCostHistory,
  getPricingCoverage, getImportHistoryForSku,
} from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, product, manufacturers] = await Promise.all([
    getCurrentUser(),
    getCatalogProduct(id),
    getManufacturers(),
  ]);
  if (!product) notFound();
  const canManage = user?.role === "owner" || user?.role === "admin";
  const canSeeCost = product.can_see_cost;

  const [history, coverage, imports] = await Promise.all([
    canSeeCost ? getCostHistory(product.id) : Promise.resolve([]),
    getPricingCoverage(product.id),
    canManage ? getImportHistoryForSku(product.sku) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
            <Badge variant={product.status === "active" ? "success" : "outline"}>
              {product.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="font-mono text-sm text-muted-foreground">{product.sku}</p>
        </div>
        {canManage && (
          <ProductDetailActions product={product} manufacturers={manufacturers} canSeeCost={canSeeCost} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Product information</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Detail label="Strength" value={product.strength} />
                <Detail label="Product Form" value={product.product_form} />
                <Detail label="Pack Size" value={product.pack_size} />
                <Detail label="Unit of Measure" value={product.unit_of_measure} />
                <Detail label="Category" value={product.category} />
                <Detail label="MOQ" value={product.moq} />
                <Detail label="Lead Time" value={product.lead_time_days != null ? `${product.lead_time_days} days` : "—"} />
                <Detail label="Manufacturer SKU" value={product.manufacturer_sku} />
                <Detail label="Currency" value={product.currency} />
              </dl>
              {product.description && (
                <>
                  <Separator className="my-5" />
                  <Detail label="Description" value={product.description} />
                </>
              )}
              {product.notes && (
                <>
                  <Separator className="my-5" />
                  <Detail label="Notes" value={product.notes} />
                </>
              )}
            </CardContent>
          </Card>

          {canSeeCost && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Cost history</CardTitle>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cost recorded yet.</p>
                ) : (
                  <div className="space-y-0">
                    {history.map((h, i) => (
                      <div key={h.id} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="font-medium tabular-nums">{formatCurrency(h.true_cost, h.currency)}</span>
                          {i === 0 && h.effective_to === null && <Badge variant="success">Current</Badge>}
                          {h.previous_cost != null && (
                            <span className="text-xs text-muted-foreground">was {formatCurrency(h.previous_cost, h.currency)}</span>
                          )}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div className="capitalize">{h.source}{h.reason ? ` · ${h.reason}` : ""}</div>
                          <div>{new Date(h.effective_date).toLocaleDateString()}{h.effective_to ? ` – ${new Date(h.effective_to).toLocaleDateString()}` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {canSeeCost && (
            <Card>
              <CardHeader><CardTitle>Current true cost</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-tight">{formatCurrency(product.true_cost, product.currency)}</div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Factory className="h-4 w-4" /> Manufacturer</CardTitle></CardHeader>
            <CardContent>
              {product.manufacturer_name ? (
                <p className="text-sm">{product.manufacturer_name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Tags className="h-4 w-4" /> Pricing coverage</CardTitle></CardHeader>
            <CardContent>
              {coverage.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not in any pricing sheet yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {coverage.map((c, i) => {
                    const sheet = (c as { pricing_sheets?: { name?: string } }).pricing_sheets;
                    return <li key={i} className="flex justify-between"><span>{sheet?.name ?? "Sheet"}</span></li>;
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {canManage && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Import history</CardTitle></CardHeader>
              <CardContent>
                {imports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No imports have touched this SKU.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {imports.map((im, i) => {
                      const batch = (im as { catalog_import_batches?: { filename?: string } }).catalog_import_batches;
                      return (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span className="truncate text-muted-foreground">{batch?.filename ?? "Import"}</span>
                          <Badge variant="outline">{String((im as { classification?: string }).classification ?? "")}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Usage</CardTitle></CardHeader>
            <CardContent>
              <EmptyState
                icon={ReceiptText}
                title="No activity yet"
                description="Purchase orders and orders that include this product will appear here (M4 / M6)."
                className="border-0 bg-transparent py-6"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
