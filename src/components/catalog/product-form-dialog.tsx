"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { createProduct, updateProduct } from "@/app/(app)/catalog/actions";
import type { CatalogProduct, Manufacturer } from "@/lib/catalog/queries";

type Mode = "create" | "edit";

export function ProductFormDialog({
  open,
  onOpenChange,
  manufacturers,
  mode,
  product,
  canSeeCost = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  manufacturers: Manufacturer[];
  mode: Mode;
  product?: CatalogProduct;
  canSeeCost?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const originalCost = product?.true_cost ?? null;
  const [form, setForm] = React.useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    strength: product?.strength ?? "",
    product_form: product?.product_form ?? "",
    pack_size: product?.pack_size ?? "",
    unit_of_measure: product?.unit_of_measure ?? "",
    manufacturer_id: product?.manufacturer_id ?? "",
    manufacturer_sku: product?.manufacturer_sku ?? "",
    category: product?.category ?? "",
    currency: product?.currency ?? "USD",
    true_cost: originalCost != null ? String(originalCost) : "",
    moq: product?.moq != null ? String(product.moq) : "",
    lead_time_days: product?.lead_time_days != null ? String(product.lead_time_days) : "",
    notes: product?.notes ?? "",
    active: product ? product.status === "active" : true,
    cost_change_reason: "",
  });

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const costChanged =
    mode === "edit" &&
    canSeeCost &&
    form.true_cost.trim() !== "" &&
    Number(form.true_cost) !== Number(originalCost ?? NaN);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      ...form,
      manufacturer_id: form.manufacturer_id || null,
      true_cost: form.true_cost.trim() === "" ? null : Number(form.true_cost),
      moq: form.moq.trim() === "" ? null : Number(form.moq),
      lead_time_days: form.lead_time_days.trim() === "" ? null : Number(form.lead_time_days),
    };

    const res =
      mode === "create"
        ? await createProduct(payload)
        : await updateProduct(product!.id, payload);

    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  const mfrOptions = [
    { value: "", label: "— None —" },
    ...manufacturers.map((m) => ({ value: m.id, label: m.name })),
  ];

  // Stable component identity (keyed on fieldErrors) so typing never remounts
  // inputs / loses focus. Only changes when validation errors change.
  const Field = React.useMemo(
    () =>
      function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
        return (
          <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {fieldErrors[id]?.map((m) => (
              <p key={m} className="text-xs text-destructive">{m}</p>
            ))}
          </div>
        );
      },
    [fieldErrors],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add product" : "Edit product"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a catalog product. Fields stay flexible for supplies, equipment, and more."
              : "Update product details. Changing true cost records a cost-history entry."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="sku" label="SKU *">
              <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} required disabled={mode === "edit"} />
            </Field>
            <Field id="name" label="Product Name *">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </Field>
          </div>

          <Field id="description" label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </Field>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field id="strength" label="Strength">
              <Input value={form.strength} onChange={(e) => set("strength", e.target.value)} />
            </Field>
            <Field id="product_form" label="Product Form">
              <Input value={form.product_form} onChange={(e) => set("product_form", e.target.value)} />
            </Field>
            <Field id="pack_size" label="Pack Size">
              <Input value={form.pack_size} onChange={(e) => set("pack_size", e.target.value)} />
            </Field>
            <Field id="unit_of_measure" label="Unit of Measure">
              <Input value={form.unit_of_measure} onChange={(e) => set("unit_of_measure", e.target.value)} />
            </Field>
            <Field id="category" label="Category">
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field id="manufacturer_sku" label="Manufacturer SKU">
              <Input value={form.manufacturer_sku} onChange={(e) => set("manufacturer_sku", e.target.value)} />
            </Field>
          </div>

          <Field id="manufacturer_id" label="Manufacturer">
            <SearchableSelect
              options={mfrOptions}
              value={form.manufacturer_id}
              onChange={(v) => set("manufacturer_id", v)}
              placeholder="Select manufacturer"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {canSeeCost && (
              <Field id="true_cost" label="True Cost">
                <Input type="number" step="0.0001" min="0" value={form.true_cost} onChange={(e) => set("true_cost", e.target.value)} />
              </Field>
            )}
            <Field id="moq" label="MOQ">
              <Input type="number" min="0" value={form.moq} onChange={(e) => set("moq", e.target.value)} />
            </Field>
            <Field id="lead_time_days" label="Lead Time (days)">
              <Input type="number" min="0" value={form.lead_time_days} onChange={(e) => set("lead_time_days", e.target.value)} />
            </Field>
          </div>

          {costChanged && (
            <Field id="cost_change_reason" label="Reason for cost change *">
              <Input
                value={form.cost_change_reason}
                onChange={(e) => set("cost_change_reason", e.target.value)}
                placeholder="e.g. Renegotiated supplier pricing"
                required
              />
            </Field>
          )}

          <Field id="notes" label="Notes">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
            />
            Active
          </label>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
