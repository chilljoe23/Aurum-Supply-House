"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PAYMENT_TERMS_OPTIONS } from "@/lib/clients/schemas";
import { updateCompanySettings } from "@/app/(app)/settings/actions";
import type { CompanySettings } from "@/lib/settings/queries";

export function CompanySettingsForm({ settings, readOnly }: { settings: CompanySettings; readOnly: boolean }) {
  const router = useRouter();
  const a = settings.address ?? {};
  const [form, setForm] = React.useState({
    company_name: settings.company_name,
    contact_email: settings.contact_email ?? "",
    contact_phone: settings.contact_phone ?? "",
    address_line1: a.line1 ?? "",
    address_line2: a.line2 ?? "",
    address_city: a.city ?? "",
    address_region: a.region ?? "",
    address_postal_code: a.postal_code ?? "",
    address_country: a.country ?? "",
    invoice_number_prefix: settings.invoice_number_prefix,
    default_payment_terms: settings.default_payment_terms,
    default_tax_rate_pct: String(round4(settings.default_tax_rate * 100)),
    payment_instructions: settings.payment_instructions ?? "",
    remittance_details: settings.remittance_details ?? "",
    invoice_terms: settings.invoice_terms ?? "",
    invoice_footer: settings.invoice_footer ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await updateCompanySettings(form);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Company profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldFull label="Company name">
            <Input value={form.company_name} onChange={set("company_name")} disabled={readOnly} />
          </FieldFull>
          <Field label="Contact email">
            <Input type="email" value={form.contact_email} onChange={set("contact_email")} disabled={readOnly} />
          </Field>
          <Field label="Contact phone">
            <Input value={form.contact_phone} onChange={set("contact_phone")} disabled={readOnly} />
          </Field>
          <Field label="Address line 1">
            <Input value={form.address_line1} onChange={set("address_line1")} disabled={readOnly} />
          </Field>
          <Field label="Address line 2">
            <Input value={form.address_line2} onChange={set("address_line2")} disabled={readOnly} />
          </Field>
          <Field label="City">
            <Input value={form.address_city} onChange={set("address_city")} disabled={readOnly} />
          </Field>
          <Field label="State / region">
            <Input value={form.address_region} onChange={set("address_region")} disabled={readOnly} />
          </Field>
          <Field label="Postal code">
            <Input value={form.address_postal_code} onChange={set("address_postal_code")} disabled={readOnly} />
          </Field>
          <Field label="Country">
            <Input value={form.address_country} onChange={set("address_country")} disabled={readOnly} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoicing defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Invoice number prefix" hint="e.g. AUR → AUR-1001">
            <Input value={form.invoice_number_prefix} onChange={set("invoice_number_prefix")} disabled={readOnly} />
          </Field>
          <Field label="Default payment terms">
            <select value={form.default_payment_terms} onChange={set("default_payment_terms")} disabled={readOnly} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60">
              {PAYMENT_TERMS_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Default tax rate %">
            <Input type="number" min={0} step="any" value={form.default_tax_rate_pct} onChange={set("default_tax_rate_pct")} disabled={readOnly} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice payment instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Printed on every invoice. Keep secrets out — use a bank&apos;s public remittance details, not passwords or full account numbers you would not share.</p>
          <FieldFull label="Payment instructions">
            <Textarea rows={3} value={form.payment_instructions} onChange={set("payment_instructions")} disabled={readOnly} placeholder="e.g. Remit by ACH or wire within terms. Contact billing@… for details." />
          </FieldFull>
          <FieldFull label="Remittance details">
            <Textarea rows={2} value={form.remittance_details} onChange={set("remittance_details")} disabled={readOnly} placeholder="Bank name, routing/account (as you choose to disclose), or check payee & address." />
          </FieldFull>
          <FieldFull label="Default invoice notes / terms">
            <Textarea rows={2} value={form.invoice_terms} onChange={set("invoice_terms")} disabled={readOnly} placeholder="Standard terms shown when an order has no specific notes." />
          </FieldFull>
          <FieldFull label="Invoice footer">
            <Input value={form.invoice_footer} onChange={set("invoice_footer")} disabled={readOnly} placeholder="Thank-you line or contact." />
          </FieldFull>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      )}
      {readOnly && <p className="text-sm text-muted-foreground">Only the Owner can change company settings.</p>}
    </div>
  );
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {hint && <span className="ml-1 font-normal text-muted-foreground">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}
function FieldFull({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
