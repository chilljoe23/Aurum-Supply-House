"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { setClientStatus } from "@/app/(app)/clients/actions";
import type { ClientDetail, RepOption } from "@/lib/clients/queries";

// Edit + status controls for the client detail header. Rendered only for users
// who may manage this client (owner/admin, or the assigned rep — RLS enforces).
export function ClientActions({
  client, reps, models, canAssignRep,
}: {
  client: ClientDetail;
  reps: RepOption[];
  models: { id: string; name: string; code: string | null; currency: string }[];
  canAssignRep: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function toStatus(status: string) {
    setBusy(true);
    await setClientStatus(client.id, status);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {client.status === "prospect" && (
        <Button variant="outline" size="sm" onClick={() => toStatus("active")} disabled={busy}>
          <UserRoundCheck className="h-4 w-4" /> Convert to active
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => toStatus(client.status === "inactive" ? "active" : "inactive")} disabled={busy}>
        <Power className="h-4 w-4" />
        {client.status === "inactive" ? "Reactivate" : "Deactivate"}
      </Button>
      <Button size="sm" onClick={() => setEdit(true)}>
        <Pencil className="h-4 w-4" /> Edit client
      </Button>

      <ClientFormDialog
        open={edit}
        onOpenChange={setEdit}
        mode="edit"
        client={client}
        reps={reps}
        models={models}
        canAssignRep={canAssignRep}
      />
    </div>
  );
}
