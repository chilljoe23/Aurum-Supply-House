import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ClientsManager } from "@/components/clients/clients-manager";
import { getClientsList, getActiveReps } from "@/lib/clients/queries";
import { getPricingModels } from "@/lib/pricing/queries";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [user, clients, reps, models] = await Promise.all([
    getCurrentUser(),
    getClientsList(),
    getActiveReps(),
    getPricingModels(),
  ]);
  const canAssignRep = user?.role === "owner" || user?.role === "admin";

  return (
    <>
      <PageHeader
        title="Clients"
        description="Companies you sell to — each with an assigned representative, pricing model, and payment terms."
      />
      <ClientsManager
        clients={clients}
        reps={canAssignRep ? reps : []}
        models={models.map((m) => ({ id: m.id, name: m.name, code: m.code, currency: m.currency }))}
        canAssignRep={!!canAssignRep}
      />
    </>
  );
}
