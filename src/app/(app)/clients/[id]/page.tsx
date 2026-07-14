import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientPricingPanel } from "@/components/clients/client-pricing-panel";
import { getCurrentUser } from "@/lib/auth";
import { getClient, getClientOverrides, getClientAssignments, getPricingModels } from "@/lib/pricing/queries";
import { getCatalogProducts } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Client" };
export const dynamic = "force-dynamic";

function modelName(v: unknown): string | null {
  const ps = (v as { pricing_sheets?: { name: string } | { name: string }[] } | null)?.pricing_sheets;
  if (!ps) return null;
  return Array.isArray(ps) ? ps[0]?.name ?? null : ps.name;
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, client] = await Promise.all([getCurrentUser(), getClient(id)]);
  if (!client) notFound();
  const canManage = user?.role === "owner" || user?.role === "admin";

  const [overrides, assignments, models, products] = await Promise.all([
    getClientOverrides(id),
    getClientAssignments(id),
    getPricingModels(),
    getCatalogProducts(),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Clients</Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{client.company_name}</h1>
        <Badge variant={client.status === "active" ? "success" : "outline"}>{client.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ClientPricingPanel
            clientId={client.id}
            modelName={modelName(client)}
            modelId={client.default_pricing_sheet_id ?? null}
            models={models.map((m) => ({ id: m.id, name: m.name, code: m.code, currency: m.currency }))}
            products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))}
            overrides={overrides as never}
            assignments={assignments as never}
            canManage={!!canManage}
          />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Contact: </span>{client.primary_contact_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Email: </span>{client.email ?? "—"}</div>
              <div><span className="text-muted-foreground">Phone: </span>{client.phone ?? "—"}</div>
              <div><span className="text-muted-foreground">Terms: </span>{client.payment_terms ?? "—"}</div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">Full client management (billing, contacts, timeline) arrives in M3. This page focuses on M2 pricing.</p>
        </div>
      </div>
    </div>
  );
}
