import * as XLSX from "xlsx";
import type { RawRow } from "./normalize";

export type SheetData = {
  headers: string[];
  rows: RawRow[]; // one object per data row, keyed by header; blank rows kept
};

export type WorkbookInfo = {
  sheetNames: string[];
  workbook: XLSX.WorkBook;
};

export function fileTypeOf(filename: string): "xlsx" | "xls" | "csv" | "unknown" {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "csv") return "csv";
  return "unknown";
}

export async function readWorkbook(file: File): Promise<WorkbookInfo> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array", cellDates: true });
  return { sheetNames: workbook.SheetNames, workbook };
}

const isEmpty = (v: unknown) => String(v ?? "").trim() === "";

// Convert a worksheet to headers + row objects. The first non-empty row is the
// header; every subsequent row (including fully-blank ones) is returned so the
// pipeline can report — never silently drop — blank rows.
export function extractSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetData {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [] };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });

  let hi = 0;
  while (hi < aoa.length && (aoa[hi] ?? []).every(isEmpty)) hi++;
  const headers = (aoa[hi] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);

  const rows: RawRow[] = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const arr = aoa[i] ?? [];
    const obj: RawRow = {};
    headers.forEach((h, idx) => {
      obj[h] = arr[idx];
    });
    rows.push(obj);
  }
  return { headers, rows };
}

// First N data rows for the preview step.
export function previewRows(sheet: SheetData, n = 8): RawRow[] {
  return sheet.rows.slice(0, n);
}
