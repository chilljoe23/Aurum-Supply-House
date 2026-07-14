"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload, FileSpreadsheet, Check, AlertTriangle, ArrowRight, ArrowLeft,
  X, Loader2, CircleCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/catalog/csv";
import { createClient } from "@/lib/supabase/client";
import {
  readWorkbook, extractSheet, previewRows, fileTypeOf, type SheetData,
} from "@/lib/catalog/parse";
import { CATALOG_FIELDS, type CatalogFieldKey } from "@/lib/catalog/fields";
import { autoMapColumns, unmappedRequired, type ColumnMapping } from "@/lib/catalog/mapping";
import { normalizeRows } from "@/lib/catalog/normalize";
import { classifyRows, summarize, type ExistingProduct, type ClassifiedRow } from "@/lib/catalog/classify";
import { createImportBatch, commitImport } from "@/app/(app)/catalog/actions";
import type * as XLSX from "xlsx";

const STEPS = ["Upload", "Worksheet", "Preview", "Map", "Validate", "Review", "Confirm", "Results"];

const CLASS_LABEL: Record<string, string> = {
  new: "New", no_change: "No change", product_update: "Product update",
  cost_update: "Cost update", product_and_cost_update: "Product + cost",
  invalid: "Invalid", duplicate_in_file: "Duplicate in file", blank: "Blank",
};
const CLASS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline" | "default"> = {
  new: "success", cost_update: "warning", product_update: "warning",
  product_and_cost_update: "warning", no_change: "outline",
  invalid: "destructive", duplicate_in_file: "destructive", blank: "outline",
};

export function ImportWizard({ existing }: { existing: ExistingProduct[] }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [file, setFile] = React.useState<File | null>(null);
  const [workbook, setWorkbook] = React.useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = React.useState<string[]>([]);
  const [sheetName, setSheetName] = React.useState("");
  const [sheet, setSheet] = React.useState<SheetData | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [classified, setClassified] = React.useState<ClassifiedRow[]>([]);
  const [mode, setMode] = React.useState<"atomic" | "valid_only">("atomic");
  const [createMissingMfr, setCreateMissingMfr] = React.useState(true);
  const [result, setResult] = React.useState<{ summary: Record<string, number>; batchId: string } | null>(null);

  const existingMap = React.useMemo(() => {
    const m = new Map<string, ExistingProduct>();
    for (const p of existing) m.set(p.sku.toLowerCase(), p);
    return m;
  }, [existing]);

  // --- step 1: upload ---
  async function onFile(f: File) {
    setError(null);
    if (fileTypeOf(f.name) === "unknown") {
      setError("Please upload an .xlsx, .xls, or .csv file.");
      return;
    }
    setFile(f);
    try {
      const { sheetNames, workbook } = await readWorkbook(f);
      setWorkbook(workbook);
      setSheetNames(sheetNames);
      const first = sheetNames[0] ?? "";
      setSheetName(first);
      if (sheetNames.length > 1) {
        setStep(1);
      } else {
        loadSheet(workbook, first);
        setStep(2);
      }
    } catch {
      setError("Could not read that file. It may be corrupt or password-protected.");
    }
  }

  function loadSheet(wb: XLSX.WorkBook, name: string) {
    const data = extractSheet(wb, name);
    setSheet(data);
    setMapping(autoMapColumns(data.headers));
  }

  // --- step 4: validate + classify ---
  function runValidation() {
    if (!sheet) return;
    const norm = normalizeRows(sheet.rows, mapping, { requireCost: true });
    setClassified(classifyRows(norm, existingMap));
    setStep(4);
  }

  const summary = React.useMemo(
    () => (classified.length ? summarize(classified) : null),
    [classified],
  );
  const invalidCount = summary
    ? summary.counts.invalid + summary.counts.duplicate_in_file
    : 0;

  React.useEffect(() => {
    // If there are invalid rows, atomic mode isn't allowed.
    if (invalidCount > 0 && mode === "atomic") setMode("valid_only");
  }, [invalidCount, mode]);

  // --- step 7: confirm/commit ---
  async function runImport() {
    if (!file || !sheet) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `catalog/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("imports").upload(path, file, { upsert: false });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

      const batch = await createImportBatch({
        filename: file.name,
        storage_path: path,
        file_type: fileTypeOf(file.name),
        worksheet: sheetName,
      });
      if (!batch.ok) throw new Error(batch.error);

      const payloadRows = classified
        .filter((r) => r.classification !== "blank")
        .map((r) => ({
          row_number: r.rowNumber,
          sku: r.sku,
          name: r.name,
          description: r.description,
          strength: r.strength,
          product_form: r.product_form,
          pack_size: r.pack_size,
          unit_of_measure: r.unit_of_measure,
          manufacturer: r.manufacturer,
          manufacturer_sku: r.manufacturer_sku,
          category: r.category,
          true_cost: r.true_cost,
          currency: r.currency,
          moq: r.moq,
          lead_time_days: r.lead_time_days,
          notes: r.notes,
          active: r.active,
          valid: !["invalid", "duplicate_in_file"].includes(r.classification),
          classification: r.classification,
          errors: r.errors,
        }));

      const res = await commitImport({
        batchId: batch.data!.id,
        mode,
        rows: payloadRows,
        createMissingManufacturers: createMissingMfr,
      });
      if (!res.ok) throw new Error(res.error);

      setResult({ summary: res.data!.summary, batchId: batch.data!.id });
      setStep(7);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    const bad = classified.filter((r) =>
      ["invalid", "duplicate_in_file"].includes(r.classification),
    );
    downloadCsv(
      "import-errors.csv",
      toCsv(
        [
          { key: "rowNumber", label: "Row" },
          { key: "sku", label: "SKU" },
          { key: "name", label: "Product Name" },
          { key: "classification", label: "Classification" },
          { key: "errors", label: "Errors" },
        ],
        bad.map((r) => ({ ...r, errors: r.errors.join("; ") })),
      ),
    );
  }

  function reset() {
    setStep(0); setFile(null); setWorkbook(null); setSheet(null);
    setClassified([]); setResult(null); setError(null);
  }

  const missingRequired = unmappedRequired(mapping, true);

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* STEP 0: Upload */}
      {step === 0 && (
        <Dropzone onFile={onFile} />
      )}

      {/* STEP 1: Worksheet */}
      {step === 1 && (
        <Card className="p-6">
          <h3 className="mb-1 text-sm font-semibold">Select a worksheet</h3>
          <p className="mb-4 text-sm text-muted-foreground">This workbook has multiple sheets. Choose the one to import.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sheetNames.map((n) => (
              <button
                key={n}
                onClick={() => { setSheetName(n); if (workbook) loadSheet(workbook, n); setStep(2); }}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-left text-sm hover:border-muted-foreground/40",
                  sheetName === n && "border-primary/40 bg-secondary",
                )}
              >
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> {n}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* STEP 2: Preview */}
      {step === 2 && sheet && (
        <Card className="p-0">
          <div className="border-b border-border px-5 py-3 text-sm">
            <span className="font-medium">Preview</span>
            <span className="ml-2 text-muted-foreground">{sheet.rows.length} rows · {sheet.headers.length} columns · sheet “{sheetName}”</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {sheet.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows(sheet, 8).map((row, i) => (
                  <TableRow key={i}>
                    {sheet.headers.map((h) => (
                      <TableCell key={h} className="whitespace-nowrap text-muted-foreground">
                        {String(row[h] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* STEP 3: Map */}
      {step === 3 && sheet && (
        <Card className="p-6">
          <h3 className="mb-1 text-sm font-semibold">Map columns</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            We auto-matched what we could. Confirm each column, or set it to Ignore. SKU and Product Name are required.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {sheet.headers.map((h) => (
              <div key={h} className="flex items-center gap-3">
                <div className="w-1/2 truncate text-sm" title={h}>{h}</div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={mapping[h] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [h]: (e.target.value || null) as CatalogFieldKey | null }))
                  }
                  className="h-9 w-1/2 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— Ignore —</option>
                  {CATALOG_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <p className="mt-4 flex items-center gap-2 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4" />
              Still needed: {missingRequired.map((k) => CATALOG_FIELDS.find((f) => f.key === k)?.label).join(", ")}
            </p>
          )}
        </Card>
      )}

      {/* STEP 4: Validate summary */}
      {step === 4 && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Valid rows" value={summary.valid} tone="success" />
            <Stat label="Invalid" value={summary.counts.invalid} tone={summary.counts.invalid ? "destructive" : "muted"} />
            <Stat label="Duplicates in file" value={summary.counts.duplicate_in_file} tone={summary.counts.duplicate_in_file ? "destructive" : "muted"} />
            <Stat label="Blank rows" value={summary.counts.blank} tone="muted" />
          </div>
          <RowsTable rows={classified.filter((r) => r.classification !== "blank")} showErrors />
          {invalidCount > 0 && (
            <Button variant="outline" size="sm" onClick={downloadErrors}>
              <X className="h-4 w-4" /> Download error report
            </Button>
          )}
        </div>
      )}

      {/* STEP 5: Review classifications */}
      {step === 5 && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="New" value={summary.counts.new} tone="success" />
            <Stat label="Cost updates" value={summary.counts.cost_update + summary.counts.product_and_cost_update} tone="warning" />
            <Stat label="Product updates" value={summary.counts.product_update + summary.counts.product_and_cost_update} tone="warning" />
            <Stat label="No change" value={summary.counts.no_change} tone="muted" />
            <Stat label="Will skip" value={invalidCount} tone={invalidCount ? "destructive" : "muted"} />
          </div>
          <RowsTable rows={classified.filter((r) => r.classification !== "blank")} showChanges />
        </div>
      )}

      {/* STEP 6: Confirm */}
      {step === 6 && summary && (
        <Card className="space-y-4 p-6">
          <h3 className="text-sm font-semibold">Confirm import</h3>
          <div className="space-y-2 text-sm">
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3", mode === "atomic" ? "border-primary/40 bg-secondary" : "border-border", invalidCount > 0 && "cursor-not-allowed opacity-50")}>
              <input type="radio" name="mode" disabled={invalidCount > 0} checked={mode === "atomic"} onChange={() => setMode("atomic")} className="mt-0.5" />
              <span>
                <span className="font-medium">Atomic — all or nothing</span>
                <span className="block text-muted-foreground">Every row must be valid. If anything fails, nothing is imported.{invalidCount > 0 && " (Unavailable: invalid rows present.)"}</span>
              </span>
            </label>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3", mode === "valid_only" ? "border-primary/40 bg-secondary" : "border-border")}>
              <input type="radio" name="mode" checked={mode === "valid_only"} onChange={() => setMode("valid_only")} className="mt-0.5" />
              <span>
                <span className="font-medium">Import valid rows only</span>
                <span className="block text-muted-foreground">Applies the {summary.valid} valid rows; the {invalidCount} invalid rows are skipped and kept in an error report.</span>
              </span>
            </label>
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={createMissingMfr} onChange={(e) => setCreateMissingMfr(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              Create manufacturers that don’t yet exist
            </label>
          </div>
          <Button onClick={runImport} disabled={busy || summary.valid === 0}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <>Import {summary.valid} rows</>}
          </Button>
        </Card>
      )}

      {/* STEP 7: Results */}
      {step === 7 && result && (
        <Card className="space-y-5 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <CircleCheck className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Import complete</h3>
            <p className="text-sm text-muted-foreground">Historical invoices and purchase orders were untouched.</p>
          </div>
          <div className="mx-auto grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={result.summary.created} tone="success" />
            <Stat label="Updated" value={result.summary.updated} tone="warning" />
            <Stat label="Cost updates" value={result.summary.costs_updated} tone="warning" />
            <Stat label="Skipped" value={result.summary.skipped} tone={result.summary.skipped ? "destructive" : "muted"} />
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" asChild><Link href={`/catalog/imports`}>View import history</Link></Button>
            <Button variant="outline" onClick={reset}>Import another</Button>
            <Button asChild><Link href="/catalog">Go to catalog</Link></Button>
          </div>
        </Card>
      )}

      {/* Footer nav */}
      {step < 7 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push("/catalog") : setStep((s) => Math.max(0, s - 1)))}>
            <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
          </Button>
          <WizardNext
            step={step}
            canProceed={{
              2: !!sheet && sheet.headers.length > 0,
              3: missingRequired.length === 0,
            }}
            onNext={() => {
              if (step === 2) setStep(3);
              else if (step === 3) runValidation();
              else if (step === 5) setStep(6);
              else setStep((s) => s + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}

function WizardNext({ step, canProceed, onNext }: { step: number; canProceed: Record<number, boolean>; onNext: () => void }) {
  if (step === 6) return null; // commit handled by its own button
  const disabled = canProceed[step] === false;
  const label = step === 3 ? "Validate" : step === 4 ? "Review changes" : "Continue";
  return (
    <Button onClick={onNext} disabled={disabled}>
      {label} <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1",
            i < step && "text-success",
            i === step && "bg-secondary font-medium text-foreground",
            i > step && "text-muted-foreground",
          )}>
            <span className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
              i < step ? "bg-success text-success-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted",
            )}>
              {i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}
            </span>
            {label}
          </div>
          {i < STEPS.length - 1 && <span className="text-muted-foreground/40">·</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
        drag ? "border-primary/50 bg-secondary" : "border-border bg-card/40",
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Upload className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">Upload a spreadsheet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Drag & drop an .xlsx, .xls, or .csv file, or choose one. Your original file is stored securely for the record.</p>
      <Button className="mt-5" onClick={() => ref.current?.click()}>Choose file</Button>
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "destructive" | "muted" }) {
  const color = {
    success: "text-success", warning: "text-warning-foreground",
    destructive: "text-destructive", muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={cn("text-2xl font-semibold tabular-nums", color)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function RowsTable({ rows, showErrors, showChanges }: { rows: ClassifiedRow[]; showErrors?: boolean; showChanges?: boolean }) {
  const shown = rows.slice(0, 200);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="max-h-[420px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead>Row</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Class</TableHead>
              {showChanges && <TableHead>Changes</TableHead>}
              {showErrors && <TableHead>Issues</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.rowNumber}>
                <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                <TableCell className="font-mono text-xs">{r.sku ?? "—"}</TableCell>
                <TableCell className="max-w-[220px] truncate">{r.name ?? "—"}</TableCell>
                <TableCell><Badge variant={CLASS_VARIANT[r.classification]}>{CLASS_LABEL[r.classification]}</Badge></TableCell>
                {showChanges && (
                  <TableCell className="text-xs text-muted-foreground">
                    {r.classification === "cost_update" || r.classification === "product_and_cost_update"
                      ? [r.costChanged && "cost", ...r.changedFields].filter(Boolean).join(", ")
                      : r.changedFields.join(", ") || "—"}
                  </TableCell>
                )}
                {showErrors && (
                  <TableCell className="text-xs text-destructive">{r.errors.join("; ") || "—"}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > shown.length && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing first {shown.length} of {rows.length} rows.
        </div>
      )}
    </div>
  );
}
