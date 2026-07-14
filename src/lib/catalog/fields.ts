// Canonical Aurum catalog fields + the spreadsheet header synonyms that map to
// them. Shared by the import wizard's auto-mapper and the mapping UI.

export type CatalogFieldKey =
  | "sku"
  | "name"
  | "description"
  | "strength"
  | "product_form"
  | "pack_size"
  | "unit_of_measure"
  | "manufacturer"
  | "manufacturer_sku"
  | "category"
  | "true_cost"
  | "moq"
  | "lead_time_days"
  | "notes"
  | "active";

export type CatalogFieldType = "string" | "number" | "integer" | "boolean";

export type CatalogField = {
  key: CatalogFieldKey;
  label: string;
  type: CatalogFieldType;
  aliases: string[];
  alwaysRequired?: boolean; // required regardless of import kind (sku, name)
  costField?: boolean; // required only for manufacturer-cost imports
};

export const CATALOG_FIELDS: CatalogField[] = [
  { key: "sku", label: "SKU", type: "string", alwaysRequired: true,
    aliases: ["sku", "item", "item #", "item number", "product code", "code", "part #", "part number"] },
  { key: "name", label: "Product Name", type: "string", alwaysRequired: true,
    aliases: ["product name", "name", "product", "item name", "description short", "title"] },
  { key: "description", label: "Description", type: "string",
    aliases: ["description", "long description", "details", "product description"] },
  { key: "strength", label: "Strength", type: "string",
    aliases: ["strength", "dosage", "dose", "mg", "concentration"] },
  { key: "product_form", label: "Product Form", type: "string",
    aliases: ["product form", "form", "dosage form", "formulation", "type"] },
  { key: "pack_size", label: "Pack Size", type: "string",
    aliases: ["pack size", "pack", "size", "count", "qty per pack", "packaging"] },
  { key: "unit_of_measure", label: "Unit of Measure", type: "string",
    aliases: ["unit of measure", "uom", "unit", "units", "measure"] },
  { key: "manufacturer", label: "Manufacturer", type: "string",
    aliases: ["manufacturer", "mfr", "mfg", "vendor", "supplier", "brand", "maker"] },
  { key: "manufacturer_sku", label: "Manufacturer SKU", type: "string",
    aliases: ["manufacturer sku", "mfr sku", "vendor sku", "supplier sku", "mfr part", "vendor code"] },
  { key: "category", label: "Category", type: "string",
    aliases: ["category", "class", "group", "product category", "segment"] },
  { key: "true_cost", label: "True Cost", type: "number", costField: true,
    aliases: ["true cost", "cost", "unit cost", "landed cost", "net cost", "buy price", "cost price", "wholesale cost"] },
  { key: "moq", label: "MOQ", type: "integer",
    aliases: ["moq", "min order", "minimum order", "minimum order qty", "min qty", "minimum order quantity"] },
  { key: "lead_time_days", label: "Lead Time (days)", type: "integer",
    aliases: ["lead time", "lead time days", "lead time (days)", "lt", "lead", "lead days"] },
  { key: "notes", label: "Notes", type: "string",
    aliases: ["notes", "comment", "comments", "remarks", "memo"] },
  { key: "active", label: "Active Status", type: "boolean",
    aliases: ["active", "status", "active status", "is active", "enabled", "state"] },
];

export const REQUIRED_ALWAYS: CatalogFieldKey[] = CATALOG_FIELDS.filter(
  (f) => f.alwaysRequired,
).map((f) => f.key);

export function fieldByKey(key: CatalogFieldKey): CatalogField {
  const f = CATALOG_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`Unknown catalog field: ${key}`);
  return f;
}
