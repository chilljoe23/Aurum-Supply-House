"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Power, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { setClientStatus } from "@/app/(app)/clients/actions";
import type { ClientDetail, RepOption } from "@/lib/clients/queries";

const TERM_LABELS: Record<string, string> = {
  due_on_receipt: "Due on receipt", net_15: "Net 15", net_30: "Net 30",
  net_45: "Net 45", net_60: "Net 60", custom: "Custom",
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "success" : status === "prospect" ? "warning" : "outline";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge variant={variant}>{label}</Badge>;
}

export function ClientsManager({
  clients, reps, models, canAssignRep,
}: {
  clients: ClientDetail[];
  reps: RepOption[];
  models: { id: string; name: string; code: string | null; currency: string }[];
  canAssignRep: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ClientDetail | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const [status, setStatus] = React.useState<string>("all");
  const [rep, setRep] = React.useState<string>("all");
  const [model, setModel] = React.useState<string>("all");

  // Rep options present in the current (RLS-scoped) data set.
  const repFilterOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of clients) if (c.assigned_rep_id) seen.set(c.assigned_rep_id, c.assigned_rep_name ?? "—");
    return Array.from(seen.entries());
  }, [clients]);

  const modelFilterOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of clients) if (c.default_pricing_sheet_id) seen.set(c.default_pricing_sheet_id, c.pricing_model_name ?? "—");
    return Array.from(seen.entries());
  }, [clients]);

  const rows = React.useMemo(() => clients.filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (rep !== "all") {
      if (rep === "none" ? c.assigned_rep_id != null : c.assigned_rep_id !== rep) return false;
    }
    if (model !== "all") {
      if (model === "none" ? c.default_pricing_sheet_id != null : c.default_pricing_sheet_id !== model) return false;
    }
    return true;
  }), [clients, status, rep, model]);

  async function toggleStatus(c: ClientDetail) {
    setBusyId(c.id);
    await setClientStatus(c.id, c.status === "inactive" ? "active" : "inactive");
    setBusyId(null);
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<ClientDetail>[]>(() => [
    {
      accessorKey: "company_name",
      header: "Company",
      cell: ({ row }) => (
        <Link href={`/clients/${row.original.id}`} className="font-medium hover:underline">
          {row.original.company_name}
        </Link>
      ),
    },
    {
      accessorKey: "primary_contact_name",
      header: "Contact",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.primary_contact_name ?? "—"}</span>,
    },
    {
      id: "reach",
      accessorFn: (r) => `${r.email ?? ""} ${r.phone ?? ""}`,
      header: "Email / phone",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-sm">
          <div>{row.original.email ?? <span className="text-muted-foreground">—</span>}</div>
          {row.original.phone && <div className="text-xs text-muted-foreground">{row.original.phone}</div>}
        </div>
      ),
    },
    {
      accessorKey: "assigned_rep_name",
      header: "Representative",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.assigned_rep_name ?? "— unassigned —"}</span>,
    },
    {
      accessorKey: "pricing_model_name",
      header: "Pricing model",
      cell: ({ row }) => row.original.pricing_model_name ?? <span className="text-muted-foreground">— none —</span>,
    },
    {
      accessorKey: "payment_terms",
      header: "Terms",
      cell: ({ row }) => <span className="text-muted-foreground">{TERM_LABELS[row.original.payment_terms] ?? row.original.payment_terms}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditing(row.original)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={row.original.status === "inactive" ? "Reactivate" : "Deactivate"}
            disabled={busyId === row.original.id}
            onClick={() => toggleStatus(row.original)}
          >
            <Power className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busyId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[
            ["all", "All statuses"], ["active", "Active"], ["prospect", "Prospect"], ["inactive", "Inactive"],
          ]} />
          <FilterSelect label="Representative" value={rep} onChange={setRep} options={[
            ["all", "All reps"], ["none", "Unassigned"], ...repFilterOptions,
          ]} />
          <FilterSelect label="Pricing model" value={model} onChange={setModel} options={[
            ["all", "All models"], ["none", "No model"], ...modelFilterOptions,
          ]} />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New client
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add the companies you sell to. Each client carries an assigned representative and pricing model."
          action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New client</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Search company, contact, email…"
          emptyMessage="No clients match these filters."
        />
      )}

      <ClientFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        reps={reps}
        models={models}
        canAssignRep={canAssignRep}
      />
      <ClientFormDialog
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        mode="edit"
        client={editing ?? undefined}
        reps={reps}
        models={models}
        canAssignRep={canAssignRep}
      />
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-muted-foreground"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
