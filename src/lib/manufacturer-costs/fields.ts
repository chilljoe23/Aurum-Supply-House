// Manufacturer cost-file field set + header synonyms. Reuses the M1 parser and
// the M2 pricing mapper shape. SKU + Unit Cost are the only required columns;
// products are matched by SKU ONLY (never by name).

export type MfrCostFieldKey =
  | "sku"
  | "unit_cost"
  | "manufacturer_sku"
  | "product_name"
  | "manufacturer_description"
  | "currency"
  | "moq"
  | "order_multiple"
  | "lead_time_days"
  | "min_quantity"
  | "max_quantity"
  | "effective_date"
  | "expiration_date"
  | "active"
  | "notes";

export type MfrCostField = {
  key: MfrCostFieldKey;
  label: string;
  type: "string" | "number" | "integer" | "date" | "boolean";
  aliases: string[];
  alwaysRequired?: boolean;
};

export const MFR_COST_FIELDS: MfrCostField[] = [
  { key: "sku", label: "SKU", type: "string", alwaysRequired: true,
    aliases: ["sku", "item", "item #", "product code", "code", "part #", "aurum sku"] },
  { key: "unit_cost", label: "Unit Cost", type: "number", alwaysRequired: true,
    aliases: ["unit cost", "cost", "price", "unit price", "manufacturer cost", "mfr cost", "our cost", "buy price", "wholesale", "list cost"] },
  { key: "manufacturer_sku", label: "Manufacturer SKU", type: "string",
    aliases: ["manufacturer sku", "mfr sku", "vendor sku", "supplier sku", "mfg sku", "manufacturer part", "vendor part #", "catalog #"] },
  { key: "product_name", label: "Product Name", type: "string",
    aliases: ["product name", "name", "product", "item name"] },
  { key: "manufacturer_description", label: "Manufacturer Description", type: "string",
    aliases: ["manufacturer description", "mfr description", "supplier description", "vendor description", "description", "desc"] },
  { key: "currency", label: "Currency", type: "string", aliases: ["currency", "cur", "ccy"] },
  { key: "moq", label: "MOQ", type: "integer",
    aliases: ["moq", "minimum order quantity", "min order qty", "min order", "minimum order"] },
  { key: "order_multiple", label: "Order Multiple", type: "integer",
    aliases: ["order multiple", "case quantity", "case qty", "case pack", "multiple", "pack multiple", "increment"] },
  { key: "lead_time_days", label: "Lead Time", type: "integer",
    aliases: ["lead time", "lead time days", "lead", "lead days", "leadtime"] },
  { key: "min_quantity", label: "Minimum Quantity", type: "integer",
    aliases: ["minimum quantity", "min quantity", "min qty", "from qty", "qty from", "tier min", "min", "qty min"] },
  { key: "max_quantity", label: "Maximum Quantity", type: "integer",
    aliases: ["maximum quantity", "max quantity", "max qty", "to qty", "qty to", "tier max", "max", "qty max"] },
  { key: "effective_date", label: "Effective Date", type: "date",
    aliases: ["effective date", "effective", "start date", "valid from", "from date"] },
  { key: "expiration_date", label: "Expiration Date", type: "date",
    aliases: ["expiration date", "expiry", "expires", "end date", "valid to", "to date"] },
  { key: "active", label: "Active Status", type: "boolean",
    aliases: ["active", "status", "active status", "enabled"] },
  { key: "notes", label: "Notes", type: "string", aliases: ["notes", "comment", "remarks"] },
];

export const MFR_COST_REQUIRED: MfrCostFieldKey[] = ["sku", "unit_cost"];
