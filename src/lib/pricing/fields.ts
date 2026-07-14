// Pricing import field set + header synonyms. Reuses the M1 parser/mapper.

export type PricingFieldKey =
  | "sku"
  | "product_name"
  | "strength"
  | "pack_size"
  | "selling_price"
  | "currency"
  | "min_quantity"
  | "max_quantity"
  | "effective_date"
  | "expiration_date"
  | "active"
  | "notes";

export type PricingField = {
  key: PricingFieldKey;
  label: string;
  type: "string" | "number" | "integer" | "date" | "boolean";
  aliases: string[];
  alwaysRequired?: boolean;
};

export const PRICING_FIELDS: PricingField[] = [
  { key: "sku", label: "SKU", type: "string", alwaysRequired: true,
    aliases: ["sku", "item", "item #", "product code", "code", "part #"] },
  { key: "selling_price", label: "Selling Price", type: "number", alwaysRequired: true,
    aliases: ["selling price", "price", "sell price", "unit price", "list price", "sale price"] },
  { key: "product_name", label: "Product Name", type: "string",
    aliases: ["product name", "name", "product", "description", "item name"] },
  { key: "strength", label: "Strength", type: "string", aliases: ["strength", "dosage", "mg"] },
  { key: "pack_size", label: "Pack Size", type: "string", aliases: ["pack size", "pack", "size", "count"] },
  { key: "currency", label: "Currency", type: "string", aliases: ["currency", "cur", "ccy"] },
  { key: "min_quantity", label: "Minimum Quantity", type: "integer",
    aliases: ["minimum quantity", "min quantity", "min qty", "from qty", "qty from", "tier min", "min"] },
  { key: "max_quantity", label: "Maximum Quantity", type: "integer",
    aliases: ["maximum quantity", "max quantity", "max qty", "to qty", "qty to", "tier max", "max"] },
  { key: "effective_date", label: "Effective Date", type: "date",
    aliases: ["effective date", "effective", "start date", "valid from", "from date"] },
  { key: "expiration_date", label: "Expiration Date", type: "date",
    aliases: ["expiration date", "expiry", "expires", "end date", "valid to", "to date"] },
  { key: "active", label: "Active Status", type: "boolean",
    aliases: ["active", "status", "active status", "enabled"] },
  { key: "notes", label: "Notes", type: "string", aliases: ["notes", "comment", "remarks"] },
];

export const PRICING_REQUIRED: PricingFieldKey[] = ["sku", "selling_price"];
