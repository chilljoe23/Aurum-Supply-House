"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, CalendarX } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssignModelDialog } from "@/components/clients/assign-model-dialog";
import { OverrideDialog } from "@/components/clients/override-dialog";
import { endDateOverride } from "@/app/(app)/clients/actions";
import { formatCurrency } from "@/lib/utils";

type Override = { id: string; sku: string; name: string; selling_price: number; currency: string; min_quantity: number; max_quantity: number | null; reason: string | null };
type Assignment = { id: string; effective_date: string; created_at: string; notes: string | null; pricing_sheets: { name: string } | { name: string }[] | null };

function aName(a: Assignment): string {
  const ps = a.pricing_sheets;
  if (!ps) return "— none —";
  return Array.isArray(ps) ? ps[0]?.name ?? "—" : ps.name;
}

export function ClientPricingPanel({ clientId, modelName, modelId, models, products, overrides, assignments, canManage }: {
  clientId: string; modelName: string | null; modelId: string | null;
  models: { id: string; name: string; code: string | null; currency: string }[];
  products: { id: string; sku: string; name: string }[];
  overrides: Override[]; assignments: Assignment[]; canManage: boolean;
}) {
  const router = useRouter();
  const [assign, setAssign] = React.useState(false);
  const [override, setOverride] = React.useState(false);

  async function endOverride(id: string) { await endDateOverride(id, clientId); router.refresh(); }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Assigned pricing model</CardTitle>
          {canManage && <Button variant="outline" size="sm" onClick={() => setAssign(true)}><Pencil className="h-4 w-4" /> Change</Button>}
        </CardHeader>
        <CardContent>
          {modelName ? <p className="text-lg font-medium">{modelName}</p> : <p className="text-sm text-muted-foreground">No pricing model assigned — orders will fall back to the default model.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Client-specific overrides</CardTitle>
          {canManage && <Button size="sm" onClick={() => setOverride(true)}><Plus className="h-4 w-4" /> Add override</Button>}
        </CardHeader>
        <CardContent>
          {overrides.length === 0 ? <p className="text-sm text-muted-foreground">No overrides. This client uses their assigned model for all SKUs.</p> : (
            <div className="space-y-0">
              {overrides.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
                  <div>
                    <span className="font-mono text-xs">{o.sku}</span> <span className="text-sm">{o.name}</span>
                    <div className="text-xs text-muted-foreground">Qty {o.min_quantity}{o.max_quantity ? `–${o.max_quantity}` : "+"}{o.reason ? ` · ${o.reason}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{formatCurrency(o.selling_price, o.currency)}</span>
                    {canManage && <Button variant="ghost" size="icon" title="End-date override" onClick={() => endOverride(o.id)}><CalendarX className="h-4 w-4" /></Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Assignment history</CardTitle></CardHeader>
        <CardContent>
          {assignments.length === 0 ? <p className="text-sm text-muted-foreground">No assignment changes recorded.</p> : (
            <ul className="space-y-2 text-sm">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>{aName(a)}{a.notes ? <span className="text-muted-foreground"> · {a.notes}</span> : ""}</span>
                  <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && <AssignModelDialog open={assign} onOpenChange={setAssign} clientId={clientId} models={models} current={modelId} />}
      {canManage && <OverrideDialog open={override} onOpenChange={setOverride} clientId={clientId} products={products} />}
    </div>
  );
}
