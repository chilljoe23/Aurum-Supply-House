"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { createClient, updateClient } from "@/app/(app)/clients/actions";
import {
  PAYMENT_TERMS_OPTIONS, CLIENT_STATUS_OPTIONS, EMPTY_ADDRESS,
} from "@/lib/clients/schemas";
import type { ClientDetail, RepOption } from "@/lib/clients/queries";

type AddressForm = { line1: string; line2: string; city: string; region: string; postal_code: string; country: string };

const toAddressForm = (a?: Partial<AddressForm> | null): AddressForm => ({ ...EMPTY_ADDRESS, ...(a ?? {}) });
const addressEqual = (a: AddressForm, b: AddressForm) =>
  (Object.keys(EMPTY_ADDRESS) as (keyof AddressForm)[]).every((k) => (a[k] ?? "") === (b[k] ?? ""));

export function ClientFormDialog({
  open, onOpenChange, mode, client, reps, models, canAssignRep,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  client?: ClientDetail;
  reps: RepOption[];
  models: { id: string; name: string; code: string | null; currency: string }[];
  canAssignRep: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [dupPrompt, setDupPrompt] = React.useState(false);

  const initial = React.useMemo(() => ({
    company_name: client?.company_name ?? "",
    primary_contact_name: client?.primary_contact_name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    payment_terms: client?.payment_terms ?? "net_30",
    status: client?.status ?? "active",
    notes: client?.notes ?? "",
    assigned_rep_id: client?.assigned_rep_id ?? "",
    default_pricing_sheet_id: client?.default_pricing_sheet_id ?? "",
    billing_address: toAddressForm(client?.billing_address as AddressForm),
    shipping_address: toAddressForm(client?.shipping_address as AddressForm),
  }), [client]);

  const [form, setForm] = React.useState(initial);
  const [sameAsBilling, setSameAsBilling] = React.useState(
    mode === "edit"
      ? addressEqual(toAddressForm(client?.billing_address as AddressForm), toAddressForm(client?.shipping_address as AddressForm))
      : true,
  );

  // Reset the form whenever the dialog opens (fresh create, or latest edit data).
  React.useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
      setFieldErrors({});
      setDupPrompt(false);
      setSameAsBilling(
        mode === "edit"
          ? addressEqual(toAddressForm(client?.billing_address as AddressForm), toAddressForm(client?.shipping_address as AddressForm))
          : true,
      );
    }
  }, [open, initial, mode, client]);

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setBilling = (k: keyof AddressForm, v: string) =>
    setForm((f) => ({ ...f, billing_address: { ...f.billing_address, [k]: v } }));
  const setShipping = (k: keyof AddressForm, v: string) =>
    setForm((f) => ({ ...f, shipping_address: { ...f.shipping_address, [k]: v } }));

  async function submit(force: boolean) {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      ...form,
      shipping_address: sameAsBilling ? form.billing_address : form.shipping_address,
      // Reps cannot assign; omit so the server applies self-assignment.
      assigned_rep_id: canAssignRep ? form.assigned_rep_id || undefined : undefined,
      default_pricing_sheet_id: form.default_pricing_sheet_id || undefined,
    };
    const res =
      mode === "create"
        ? await createClient(payload, force)
        : await updateClient(client!.id, payload);
    setSaving(false);
    if (!res.ok) {
      if (res.fieldErrors?._duplicateOf) {
        setDupPrompt(true);
        setError(res.error);
        return;
      }
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      return;
    }
    setDupPrompt(false);
    onOpenChange(false);
    router.refresh();
  }

  const repOptions = reps.map((r) => ({ value: r.id, label: r.full_name || r.email, hint: r.role.replace("_", " ") }));
  const modelOptions = models.map((m) => ({ value: m.id, label: m.name, hint: m.code ?? m.currency }));
  const fe = (k: string) => fieldErrors[k]?.[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add client" : "Edit client"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Companies you sell to. Names are checked for near-duplicates."
              : "Update client details. Historical invoices are never affected."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-5">
          {/* Company & contact */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="company">Company name *</Label>
              <Input id="company" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} required />
              {fe("company_name") && <p className="text-xs text-destructive">{fe("company_name")}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="contact">Primary contact</Label>
                <Input id="contact" value={form.primary_contact_name} onChange={(e) => set("primary_contact_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                {fe("email") && <p className="text-xs text-destructive">{fe("email")}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="terms">Payment terms</Label>
                <select id="terms" value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {PAYMENT_TERMS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Assignment */}
          <div className="grid grid-cols-2 gap-4">
            {canAssignRep && (
              <div className="space-y-1.5">
                <Label>Assigned representative</Label>
                <SearchableSelect options={repOptions} value={form.assigned_rep_id} onChange={(v) => set("assigned_rep_id", v)} placeholder="Unassigned" />
                {fe("assigned_rep_id") && <p className="text-xs text-destructive">{fe("assigned_rep_id")}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Pricing model</Label>
              <SearchableSelect options={modelOptions} value={form.default_pricing_sheet_id} onChange={(v) => set("default_pricing_sheet_id", v)} placeholder="Default model" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select id="status" value={form.status} onChange={(e) => set("status", e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                {CLIENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Billing address */}
          <AddressFields legend="Billing address" prefix="bill" value={form.billing_address} onChange={setBilling} />

          {/* Shipping address */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Shipping address</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} className="h-3.5 w-3.5 rounded border-input" />
                Same as billing
              </label>
            </div>
            {sameAsBilling ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Shipping address mirrors the billing address.
              </p>
            ) : (
              <AddressFields legend={null} prefix="ship" value={form.shipping_address} onChange={setShipping} />
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {dupPrompt ? (
              <Button type="button" variant="destructive" disabled={saving} onClick={() => submit(true)}>Create anyway</Button>
            ) : (
              <Button type="submit" disabled={saving || !form.company_name.trim()}>
                {saving ? "Saving…" : mode === "create" ? "Create client" : "Save changes"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddressFields({
  legend, prefix, value, onChange,
}: {
  legend: string | null;
  prefix: string;
  value: AddressForm;
  onChange: (k: keyof AddressForm, v: string) => void;
}) {
  return (
    <div className="space-y-3">
      {legend && <span className="text-sm font-medium">{legend}</span>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`${prefix}-line1`} className="text-xs text-muted-foreground">Address line 1</Label>
          <Input id={`${prefix}-line1`} value={value.line1} onChange={(e) => onChange("line1", e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`${prefix}-line2`} className="text-xs text-muted-foreground">Address line 2</Label>
          <Input id={`${prefix}-line2`} value={value.line2} onChange={(e) => onChange("line2", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-city`} className="text-xs text-muted-foreground">City</Label>
          <Input id={`${prefix}-city`} value={value.city} onChange={(e) => onChange("city", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-region`} className="text-xs text-muted-foreground">State / region</Label>
          <Input id={`${prefix}-region`} value={value.region} onChange={(e) => onChange("region", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-postal`} className="text-xs text-muted-foreground">Postal code</Label>
          <Input id={`${prefix}-postal`} value={value.postal_code} onChange={(e) => onChange("postal_code", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-country`} className="text-xs text-muted-foreground">Country</Label>
          <Input id={`${prefix}-country`} value={value.country} onChange={(e) => onChange("country", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
