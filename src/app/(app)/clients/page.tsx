import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ClientsManager } from "@/components/clients/clients-manager";
import { getClientsList, getActiveReps } from "@/lib/clients/queries";
import { getPricingModels } from "@/lib/pricing/queries";
import { getCurrentUser } from "@/lib/auth";
import { SALES_REPS_ENABLED } from "@/lib/launch";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [user, clients, reps, models] = await Promise.all([
    getCurrentUser(),
    getClientsList(),
    // Owner-only launch: skip loading the rep roster entirely while reps are hidden.
    SALES_REPS_ENABLED ? getActiveReps() : Promise.resolve([]),
    getPricingModels(),
  ]);
  const canAssignRep =
    (user?.role === "owner" || user?.role === "admin") && SALES_REPS_ENABLED;

  return (
    <>
      <PageHeader
        title="Clients"
        description={
          SALES_REPS_ENABLED
            ? "Companies you sell to — each with an assigned representative, pricing model, and payment terms."
            : "Companies you sell to — each with a pricing model and payment terms."
        }
      />
      <ClientsManager
        clients={clients}
        reps={canAssignRep ? reps : []}
        models={models.map((m) => ({ id: m.id, name: m.name, code: m.code, currency: m.currency }))}
        canAssignRep={canAssignRep}
        showReps={SALES_REPS_ENABLED}
      />
    </>
  );
}
