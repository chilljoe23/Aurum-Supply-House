"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, ArrowRight, ArrowLeft, AlertTriangle, Loader2, CircleCheck, Check, FileSpreadsheet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/patterns/searchable-select";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/catalog/csv";
import { createClient } from "@/lib/supabase/client";
import { readWorkbook, extractSheet, previewRows, fileTypeOf, type SheetData } from "@/lib/catalog/parse";
import { MFR_COST_FIELDS, type MfrCostFieldKey } from "@/lib/manufacturer-costs/fields";
import { autoMapMfrCost, unmappedRequiredMfrCost, type MfrCostMapping } from "@/lib/manufacturer-costs/mapping";
import { normalizeMfrCostRows } from "@/lib/manufacturer-costs/normalize";
import { classifyMfrCostRows, summarizeMfrCost, isApplicableMfr, type ClassifiedMfrCostRow } from "@/lib/manufacturer-costs/classify";
import { createManufacturer } from "@/app/(app)/catalog/actions";
import { createManufacturerCostBatch, commitManufacturerCostImport, getManufacturerCostKeys } from "@/app/(app)/catalog/manufacturers/actions";
import type * as XLSX from "xlsx";

export type WizardManufacturer = { id: string; name: string; status: string; default_currency: string };

const STEPS = ["Manufacturer", "Upload", "Worksheet", "Preview", "Map", "Validate", "Review", "Confirm", "Done"];
const LABEL: Record<string, string> = {
  new_manufacturer_product: "New product", new_cost: "New cost", cost_update: "Cost update",
  product_data_update: "Data update", tier_added: "Tier added", tier_updated: "Tier updated",
  no_change: "No change", invalid: "Invalid", duplicate_in_file: "Duplicate", unknown_sku: "Unknown SKU",
  future_dated: "Future-dated", expired: "Expired", blank: "Blank",
};
const VAR: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  new_manufacturer_product: "success", new_cost: "success", cost_update: "warning",
  product_data_update: "warning", tier_added: "success", tier_updated: "warning",
  no_change: "outline", invalid: "destructive", duplicate_in_file: "destructive", unknown_sku: "destructive",
  future_dated: "warning", expired: "warning", blank: "outline",
};

export function ManufacturerCostImportWizard({
  manufacturers: initialManufacturers, knownSkus, today, preselectedManufacturerId,
}: {
  manufacturers: WizardManufacturer[]; knownSkus: string[]; today: string; preselectedManufacturerId?: string;
}) {
  const router = useRouter();
  const [manufacturers, setManufacturers] = React.useState(initialManufacturers);
  const [step, setStep] = React.useState(preselectedManufacturerId ? 1 : 0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [manufacturerId, setManufacturerId] = React.useState(preselectedManufacturerId ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [workbook, setWorkbook] = React.useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = React.useState<string[]>([]);
  const [worksheet, setWorksheet] = React.useState("");
  const [sheet, setSheet] = React.useState<SheetData | null>(null);
  const [mapping, setMapping] = React.useState<MfrCostMapping>({});
  const [classified, setClassified] = React.useState<ClassifiedMfrCostRow[]>([]);
  const [mode, setMode] = React.useState<"atomic" | "valid_only">("atomic");
  const [result, setResult] = React.useState<Record<string, number> | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const known = React.useMemo(() => new Set(knownSkus.map((s) => s.toLowerCase())), [knownSkus]);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const currency = manufacturers.find((m) => m.id === manufacturerId)?.default_currency ?? "USD";

  async function onFile(f: File) {
    setError(null);
    if (fileTypeOf(f.name) === "unknown") { setError("Upload an .xlsx, .xls, or .csv file."); return; }
    setFile(f);
    try {
      const { sheetNames, workbook } = await readWorkbook(f);
      setWorkbook(workbook); setSheetNames(sheetNames);
      const first = sheetNames[0] ?? ""; setWorksheet(first);
      if (sheetNames.length > 1) setStep(2);
      else { loadSheet(workbook, first); setStep(3); }
    } catch { setError("Could not read that file."); }
  }
  function loadSheet(wb: XLSX.WorkBook, name: string) {
    const data = extractSheet(wb, name); setSheet(data); setMapping(autoMapMfrCost(data.headers));
  }
  async function runValidation() {
    if (!sheet) return;
    setBusy(true);
    const keys = await getManufacturerCostKeys(manufacturerId);
    const rels = new Map(keys.relationships.map((r) => [r.sku.toLowerCase(), r]));
    const tiers = new Map(keys.tiers.map((t) => [`${t.sku.toLowerCase()}|${t.min_quantity}`, t.unit_cost]));
    const norm = normalizeMfrCostRows(sheet.rows, mapping);
    setClassified(classifyMfrCostRows(norm, rels, tiers, known, today));
    setBusy(false); setStep(5);
  }

  const summary = React.useMemo(() => (classified.length ? summarizeMfrCost(classified) : null), [classified]);
  const invalidCount = summary ? summary.counts.invalid + summary.counts.duplicate_in_file + summary.counts.unknown_sku : 0;
  React.useEffect(() => { if (invalidCount > 0 && mode === "atomic") setMode("valid_only"); }, [invalidCount, mode]);

  async function runImport() {
    if (!file || !sheet) return;
    setBusy(true); setError(null);
    try {
      const supabase = createClient();
      const path = `mfr-costs/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("imports").upload(path, file);
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      const batch = await createManufacturerCostBatch({ manufacturerId, filename: file.name, storage_path: path, file_type: fileTypeOf(file.name), worksheet });
      if (!batch.ok) throw new Error(batch.error);
      const rows = classified.filter((r) => r.classification !== "blank").map((r) => ({
        row_number: r.rowNumber, sku: r.sku, unit_cost: r.unit_cost, currency: r.currency,
        min_quantity: r.min_quantity, max_quantity: r.max_quantity, manufacturer_sku: r.manufacturer_sku,
        manufacturer_description: r.manufacturer_description, moq: r.moq, order_multiple: r.order_multiple,
        lead_time_days: r.lead_time_days, effective_date: r.effective_date, expiration_date: r.expiration_date,
        active: r.active, notes: r.notes,
        valid: isApplicableMfr(r.classification), classification: r.classification, errors: r.errors,
      }));
      const res = await commitManufacturerCostImport({ batchId: batch.data!.id, manufacturerId, mode, rows });
      if (!res.ok) throw new Error(res.error);
      setResult(res.data!.summary); setStep(8); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
    finally { setBusy(false); }
  }

  function downloadErrors() {
    const bad = classified.filter((r) => !isApplicableMfr(r.classification) && r.classification !== "blank");
    downloadCsv("manufacturer-cost-import-errors.csv", toCsv(
      [{ key: "rowNumber", label: "Row" }, { key: "sku", label: "SKU" }, { key: "classification", label: "Class" }, { key: "errors", label: "Errors" }],
      bad.map((r) => ({ ...r, errors: r.errors.join("; ") }))));
  }

  const missingRequired = unmappedRequiredMfrCost(mapping);
  const mfrOptions = manufacturers.filter((m) => m.status === "active").map((m) => ({ value: m.id, label: m.name, hint: m.default_currency }));

  return (
    <div className="space-y-6">
      <Stepper step={step} />
      {error && <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      {step === 0 && (
        <Card className="space-y-4 p-6">
          <div>
            <h3 className="text-sm font-semibold">Which manufacturer?</h3>
            <p className="text-sm text-muted-foreground">Costs import against the manufacturer you select. Create it first if it doesn’t exist.</p>
          </div>
          <div className="flex max-w-lg items-center gap-2">
            <SearchableSelect options={mfrOptions} value={manufacturerId} onChange={setManufacturerId} placeholder="Select a manufacturer" className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New</Button>
          </div>
          <CreateManufacturerDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(m) => { setManufacturers((prev) => [...prev, m]); setManufacturerId(m.id); }} />
        </Card>
      )}

      {step === 1 && (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary"><Upload className="h-5 w-5" /></div>
          <h3 className="text-sm font-semibold">Upload a manufacturer cost file</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Drag &amp; drop an .xlsx, .xls, or .csv, or choose one. Columns: SKU + Unit Cost (required); Manufacturer SKU, MOQ, tiers &amp; dates optional.</p>
          <Button className="mt-5" onClick={() => fileInput.current?.click()}>Choose file</Button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>
      )}

      {step === 2 && (
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-semibold">Select a worksheet</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {sheetNames.map((n) => (
              <button key={n} onClick={() => { setWorksheet(n); if (workbook) loadSheet(workbook, n); setStep(3); }}
                className={cn("flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-left text-sm hover:border-muted-foreground/40", worksheet === n && "border-primary/40 bg-secondary")}>
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> {n}
              </button>
            ))}
          </div>
        </Card>
      )}

      {step === 3 && sheet && (
        <Card className="p-0">
          <div className="border-b border-border px-5 py-3 text-sm"><span className="font-medium">Preview</span><span className="ml-2 text-muted-foreground">{sheet.rows.length} rows · {sheet.headers.length} columns</span></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">{sheet.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{previewRows(sheet, 8).map((row, i) => (<TableRow key={i}>{sheet.headers.map((h) => <TableCell key={h} className="whitespace-nowrap text-muted-foreground">{String(row[h] ?? "")}</TableCell>)}</TableRow>))}</TableBody>
            </Table>
          </div>
        </Card>
      )}

      {step === 4 && sheet && (
        <Card className="p-6">
          <h3 className="mb-1 text-sm font-semibold">Map columns</h3>
          <p className="mb-4 text-sm text-muted-foreground">SKU and Unit Cost are required. Products are matched by SKU only.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {sheet.headers.map((h) => (
              <div key={h} className="flex items-center gap-3">
                <div className="w-1/2 truncate text-sm" title={h}>{h}</div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <select value={mapping[h] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: (e.target.value || null) as MfrCostFieldKey | null }))} className="h-9 w-1/2 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">— Ignore —</option>
                  {MFR_COST_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && <p className="mt-4 flex items-center gap-2 text-sm text-warning-foreground"><AlertTriangle className="h-4 w-4" />Still needed: {missingRequired.map((k) => MFR_COST_FIELDS.find((f) => f.key === k)?.label).join(", ")}</p>}
        </Card>
      )}

      {(step === 5 || step === 6) && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="New products" value={summary.counts.new_manufacturer_product} tone="success" />
            <Stat label="New costs" value={summary.counts.new_cost} tone="success" />
            <Stat label="Cost updates" value={summary.counts.cost_update + summary.counts.tier_updated} tone="warning" />
            <Stat label="No change" value={summary.counts.no_change + summary.counts.product_data_update} tone="muted" />
            <Stat label="Will skip" value={invalidCount} tone={invalidCount ? "destructive" : "muted"} />
          </div>
          <RowsTable rows={classified.filter((r) => r.classification !== "blank")} currency={currency} />
          {invalidCount > 0 && <Button variant="outline" size="sm" onClick={downloadErrors}>Download error report</Button>}
        </div>
      )}

      {step === 7 && summary && (
        <Card className="space-y-4 p-6">
          <h3 className="text-sm font-semibold">Confirm import</h3>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3", mode === "atomic" ? "border-primary/40 bg-secondary" : "border-border", invalidCount > 0 && "cursor-not-allowed opacity-50")}>
            <input type="radio" disabled={invalidCount > 0} checked={mode === "atomic"} onChange={() => setMode("atomic")} className="mt-0.5" />
            <span><span className="font-medium">Atomic — all or nothing</span><span className="block text-muted-foreground">Every row must be valid.{invalidCount > 0 && " (Unavailable: invalid rows present.)"}</span></span>
          </label>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3", mode === "valid_only" ? "border-primary/40 bg-secondary" : "border-border")}>
            <input type="radio" checked={mode === "valid_only"} onChange={() => setMode("valid_only")} className="mt-0.5" />
            <span><span className="font-medium">Import valid rows only</span><span className="block text-muted-foreground">Applies {summary.valid} valid rows; {invalidCount} skipped with an error report.</span></span>
          </label>
          <p className="text-xs text-muted-foreground">Manufacturer costs are effective-dated and never change your catalog’s true cost. Promote a cost from the manufacturer page when you want it to affect sales profitability.</p>
          <Button onClick={runImport} disabled={busy || summary.valid === 0}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <>Import {summary.valid} rows</>}</Button>
        </Card>
      )}

      {step === 8 && result && (
        <Card className="space-y-5 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success"><CircleCheck className="h-6 w-6" /></div>
          <div><h3 className="text-lg font-semibold">Manufacturer cost import complete</h3><p className="text-sm text-muted-foreground">Effective-dated; catalog true cost and historical invoices untouched.</p></div>
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Products" value={result.relationships} tone="success" />
            <Stat label="New costs" value={result.costs_created} tone="success" />
            <Stat label="Updated" value={result.costs_updated} tone="warning" />
            <Stat label="Tiers" value={result.tiers} tone="success" />
            <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "destructive" : "muted"} />
          </div>
          <div className="flex justify-center gap-2">
            <Button asChild><Link href={`/catalog/manufacturers/${manufacturerId}`}>View manufacturer</Link></Button>
          </div>
        </Card>
      )}

      {step < 8 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push("/catalog/manufacturers") : setStep((s) => Math.max(0, s - 1)))}><ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}</Button>
          {step !== 7 && (
            <Button
              disabled={(step === 0 && !manufacturerId) || (step === 4 && missingRequired.length > 0) || busy}
              onClick={() => {
                if (step === 0) setStep(1);
                else if (step === 3) setStep(4);
                else if (step === 4) runValidation();
                else if (step === 5) setStep(6);
                else if (step === 6) setStep(7);
                else setStep((s) => s + 1);
              }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {step === 4 ? "Validate" : step === 5 ? "Review" : "Continue"} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateManufacturerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (m: WizardManufacturer) => void }) {
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [force, setForce] = React.useState(false);

  async function submit() {
    setSaving(true); setError(null);
    const res = await createManufacturer({ name, default_currency: currency, active: true }, force);
    setSaving(false);
    if (!res.ok) {
      if (res.fieldErrors?._duplicateOf) { setForce(true); setError(`${res.error} Click Create again to confirm.`); return; }
      setError(res.error); return;
    }
    onCreated({ id: res.data!.id, name, status: "active", default_currency: currency });
    setName(""); setCurrency("USD"); setForce(false); onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New manufacturer</DialogTitle>
          <DialogDescription>Create a supplier to import costs against. You can add full details later.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div><Label htmlFor="mfr-name">Name</Label><Input id="mfr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Pharma" /></div>
          <div><Label htmlFor="mfr-cur">Default currency</Label><Input id="mfr-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-28" /></div>
          <div className="flex justify-end"><Button onClick={submit} disabled={saving || !name.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1", i < step && "text-success", i === step && "bg-secondary font-medium text-foreground", i > step && "text-muted-foreground")}>
            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[10px]", i < step ? "bg-success text-success-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted")}>{i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>
            {label}
          </div>
          {i < STEPS.length - 1 && <span className="text-muted-foreground/40">·</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "destructive" | "muted" }) {
  const color = { success: "text-success", warning: "text-warning-foreground", destructive: "text-destructive", muted: "text-foreground" }[tone];
  return <div className="rounded-lg border border-border bg-card p-4"><div className={cn("text-2xl font-semibold tabular-nums", color)}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></div>;
}
function RowsTable({ rows, currency }: { rows: ClassifiedMfrCostRow[]; currency: string }) {
  const shown = rows.slice(0, 200);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="max-h-[420px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card"><TableRow className="hover:bg-transparent">
            <TableHead>Row</TableHead><TableHead>SKU</TableHead><TableHead>Tier</TableHead><TableHead>Class</TableHead>
            <TableHead className="text-right">Old</TableHead><TableHead className="text-right">New</TableHead><TableHead className="text-right">Δ%</TableHead><TableHead>Issues</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.rowNumber}>
                <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                <TableCell className="font-mono text-xs">{r.sku ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.min_quantity}{r.max_quantity ? `–${r.max_quantity}` : "+"}</TableCell>
                <TableCell><Badge variant={VAR[r.classification]}>{LABEL[r.classification]}</Badge></TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{r.oldCost != null ? formatCurrency(r.oldCost, currency) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.newCost != null ? formatCurrency(r.newCost, currency) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : "—"}</TableCell>
                <TableCell className="text-xs text-destructive">{r.errors.join("; ") || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > shown.length && <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Showing first {shown.length} of {rows.length}.</div>}
    </div>
  );
}
