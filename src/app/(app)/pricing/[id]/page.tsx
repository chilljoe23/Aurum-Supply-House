import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Star, Users, AlertTriangle, PackageX } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModelBandsTable } from "@/components/pricing/model-bands-table";
import { ModelDetailActions } from "@/components/pricing/model-detail-actions";
import { getCurrentUser } from "@/lib/auth";
import { getCatalogProducts } from "@/lib/catalog/queries";
import { getPricingModel, getModelBands, getModelClients, getUnpricedProducts } from "@/lib/pricing/queries";

export const metadata: Metadata = { title: "Pricing Model" };
export const dynamic = "force-dynamic";

export default async function PricingModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, model] = await Promise.all([getCurrentUser(), getPricingModel(id)]);
  if (!model) notFound();
  const canManage = user?.role === "owner" || user?.role === "admin";
  const canSeeCost = canManage;

  const [bands, clients, products] = await Promise.all([
    getModelBands(id, canSeeCost),
    getModelClients(id),
    getCatalogProducts(),
  ]);
  const productOptions = products.map((p) => ({ id: p.id, sku: p.sku, name: p.name }));
  const unpriced = canSeeCost ? await getUnpricedProducts(id, bands.map((b) => b.product_id)) : [];
  const belowCost = canSeeCost ? bands.filter((b) => b.below_cost) : [];
  const margins = canSeeCost ? bands.map((b) => b.margin_pct).filter((m): m is number => m != null) : [];
  const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null;

  return (
    <div className="space-y-6">
      <Link href="/pricing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Pricing</Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{model.name}</h1>
            {model.is_default && <Badge variant="warning"><Star className="mr-1 h-3 w-3" />Default</Badge>}
            <Badge variant={model.status === "active" ? "success" : "outline"}>{model.status === "active" ? "Active" : "Inactive"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{model.code ? `${model.code} · ` : ""}{model.currency}{model.description ? ` · ${model.description}` : ""}</p>
        </div>
        {canManage && <ModelDetailActions model={model} products={productOptions} />}
      </div>

      {canSeeCost && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4"><div className="text-2xl font-semibold tabular-nums">{bands.length}</div><div className="text-xs text-muted-foreground">Priced bands</div></Card>
          <Card className="p-4"><div className="text-2xl font-semibold tabular-nums">{avgMargin != null ? `${(avgMargin * 100).toFixed(1)}%` : "—"}</div><div className="text-xs text-muted-foreground">Avg gross margin</div></Card>
          <Card className="p-4"><div className="text-2xl font-semibold tabular-nums text-destructive">{belowCost.length}</div><div className="text-xs text-muted-foreground">Below cost</div></Card>
          <Card className="p-4"><div className="text-2xl font-semibold tabular-nums">{unpriced.length}</div><div className="text-xs text-muted-foreground">Products unpriced</div></Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Prices & quantity tiers</CardTitle></CardHeader>
            <CardContent>
              <ModelBandsTable bands={bands} products={productOptions} sheetId={model.id} currency={model.currency} canManage={!!canManage} canSeeCost={canSeeCost} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Assigned clients</CardTitle></CardHeader>
            <CardContent>
              {clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients assigned.</p> : (
                <ul className="space-y-1 text-sm">
                  {clients.map((c) => <li key={c.id}><Link href={`/clients/${c.id}`} className="hover:underline">{c.company_name}</Link></li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          {canSeeCost && belowCost.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> Below cost</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {belowCost.slice(0, 12).map((b) => <li key={b.item_id} className="flex justify-between"><span className="font-mono text-xs">{b.sku}</span><span className="text-muted-foreground">{b.min_quantity}{b.max_quantity ? `–${b.max_quantity}` : "+"}</span></li>)}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Below-cost pricing is allowed but flagged for review.</p>
              </CardContent>
            </Card>
          )}

          {canSeeCost && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><PackageX className="h-4 w-4" /> Missing prices</CardTitle></CardHeader>
              <CardContent>
                {unpriced.length === 0 ? <p className="text-sm text-muted-foreground">Every active product is priced.</p> : (
                  <ul className="space-y-1 text-sm">
                    {unpriced.slice(0, 12).map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={`/catalog/${p.id}`} className="truncate hover:underline">{p.name}</Link><span className="font-mono text-xs text-muted-foreground">{p.sku}</span></li>)}
                  </ul>
                )}
                {unpriced.length > 12 && <p className="mt-2 text-xs text-muted-foreground">+{unpriced.length - 12} more.</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
