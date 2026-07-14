import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ClientsTable } from "@/components/clients/clients-table";
import { getClientsWithPricing } from "@/lib/pricing/queries";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await getClientsWithPricing();
  return (
    <>
      <PageHeader title="Clients" description="Companies you sell to, with their assigned pricing model. Full client management arrives in M3." />
      <ClientsTable clients={clients as never} />
    </>
  );
}
