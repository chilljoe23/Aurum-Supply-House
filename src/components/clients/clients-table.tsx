"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";

type Row = {
  id: string; company_name: string; status: string; payment_terms: string | null;
  default_pricing_sheet_id: string | null; pricing_sheets: { name: string } | { name: string }[] | null;
};

function modelName(r: Row): string | null {
  const ps = r.pricing_sheets;
  if (!ps) return null;
  return Array.isArray(ps) ? ps[0]?.name ?? null : ps.name;
}

export function ClientsTable({ clients }: { clients: Row[] }) {
  const [q, setQ] = React.useState("");
  const rows = clients.filter((c) => !q || c.company_name.toLowerCase().includes(q.toLowerCase()));

  if (clients.length === 0) {
    return <EmptyState icon={Users} title="No clients yet" description="Full client management arrives in M3. Pricing assignment and overrides are available on each client here." />;
  }
  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-9" />
      </div>
      <div className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "client" : "clients"}</div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Company</TableHead><TableHead>Pricing model</TableHead><TableHead>Terms</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell><Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.company_name}</Link></TableCell>
                <TableCell>{modelName(c) ?? <span className="text-muted-foreground">— none —</span>}</TableCell>
                <TableCell className="text-muted-foreground">{c.payment_terms ?? "—"}</TableCell>
                <TableCell><Badge variant={c.status === "active" ? "success" : "outline"}>{c.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
