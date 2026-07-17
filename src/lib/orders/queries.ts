import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createUntypedClient } from "@/lib/supabase/untyped";
import {
  buildInvoiceViewModel,
  type InvoiceViewModel,
  type InvoiceHeaderInput,
} from "@/lib/orders/invoice-view-model";
import {
  buildPackingSlipViewModel,
  type PackingSlipViewModel,
  type PackingSlipLineInput,
} from "@/lib/orders/packing-slip-view-model";

// All reads go through the masked, row-scoped views (v_orders / v_order_items),
// so internal economics are NULL for reps at the DB layer — not just hidden in
// the UI. Base invoices/invoice_items are admin-only (migration 0210).

export type OrderListRow = {
  id: string;
  invoice_number: string;
  status: string;
  client_id: string | null;
  company_name: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  pricing_sheet_id: string | null;
  pricing_sheet_name: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  issue_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  gross_profit: number | null;
  gross_margin: number | null;
  can_see_internal: boolean;
  // Derived fulfillment status, merged from v_order_fulfillment_summary. Optional
  // so the base list read stays a single query; the page enriches it.
  fulfillment_status?: string | null;
};

export async function getOrdersList(): Promise<OrderListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_orders")
    .select(
      "id,invoice_number,status,client_id,company_name,sales_rep_id,sales_rep_name,pricing_sheet_id,pricing_sheet_name,currency,total,amount_paid,balance_due,issue_date,due_date,created_at,updated_at,gross_profit,gross_margin,can_see_internal",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  return (data ?? []).map((r) => ({
    ...r,
    currency: r.currency ?? "USD",
    total: Number(r.total ?? 0),
    amount_paid: Number(r.amount_paid ?? 0),
    balance_due: Number(r.balance_due ?? 0),
    can_see_internal: !!r.can_see_internal,
  })) as OrderListRow[];
}

// ---- Detail -----------------------------------------------------------------

export type OrderHeader = {
  id: string;
  invoice_number: string;
  status: string;
  client_id: string | null;
  company_name: string | null;
  client_snapshot: Record<string, unknown> | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  pricing_sheet_id: string | null;
  pricing_sheet_name: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  shipping: number;
  fees: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  issue_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // internal (null for reps)
  total_true_cost: number | null;
  gross_profit: number | null;
  gross_margin: number | null;
  total_commission: number | null;
  total_expenses: number | null;
  net_profit: number | null;
  can_see_internal: boolean;
};

export type OrderItem = {
  id: string;
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  price_overridden: boolean;
  original_unit_price: number | null;
  price_source: string | null;
  price_source_sheet: string | null;
  manual_reason: string | null;
  lot_number: string | null;
  manufacturing_date: string | null;
  expiration_date: string | null;
  retest_date: string | null;
  unit_true_cost: number | null;
  line_true_cost: number | null;
  line_gross_profit: number | null;
};

export type OrderPayment = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  received_at: string;
  note: string | null;
  voided: boolean;
};

export type OrderExpense = {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  incurred_on: string;
};

export type OrderStatusEvent = { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string };

export type OrderActivity = { id: string; action: string; summary: string | null; created_at: string; actor_name: string | null };

export type OrderDetail = {
  header: OrderHeader;
  items: OrderItem[];
  payments: OrderPayment[];
  expenses: OrderExpense[];
  statusHistory: OrderStatusEvent[];
  activity: OrderActivity[];
};

export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data: header } = await supabase.from("v_orders").select("*").eq("id", id).maybeSingle();
  if (!header) return null;

  const [{ data: items }, { data: payments }, { data: expenses }, { data: history }, { data: activity }] =
    await Promise.all([
      supabase.from("v_order_items").select("*").eq("invoice_id", id).order("created_at"),
      supabase.from("payments").select("id,amount,method,reference,received_at,note,voided").eq("invoice_id", id).order("received_at"),
      supabase.from("order_expenses").select("id,type,amount,note,incurred_on").eq("invoice_id", id).order("incurred_on"),
      supabase.from("invoice_status_history").select("id,from_status,to_status,note,created_at").eq("invoice_id", id).order("created_at"),
      supabase.from("activity_log").select("id,action,summary,created_at,actor_id").eq("entity_type", "invoice").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
    ]);

  const actorIds = Array.from(new Set((activity ?? []).map((a) => a.actor_id).filter(Boolean))) as string[];
  const actorNames = await nameMap(supabase, actorIds);

  const h = header as Record<string, unknown>;
  return {
    header: {
      ...(h as unknown as OrderHeader),
      client_snapshot: (h.client_snapshot ?? null) as Record<string, unknown> | null,
      currency: (h.currency as string) ?? "USD",
      can_see_internal: !!h.can_see_internal,
    },
    items: (items ?? []) as unknown as OrderItem[],
    payments: (payments ?? []) as unknown as OrderPayment[],
    expenses: (expenses ?? []) as unknown as OrderExpense[],
    statusHistory: (history ?? []) as unknown as OrderStatusEvent[],
    activity: (activity ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary,
      created_at: a.created_at,
      actor_name: a.actor_id ? actorNames.get(a.actor_id) ?? null : null,
    })),
  };
}

// ---- Fulfillment reads (row-scoped views; no cost/profit columns) -----------

export type FulfillmentLine = {
  invoice_item_id: string;
  sku: string;
  product_name: string;
  strength: string | null;
  pack_size: string | null;
  quantity_ordered: number;
  quantity_shipped: number;
  quantity_remaining: number;
  operational_status: string;
  fulfillment_status: string;
  lot_number: string | null;
  expiration_date: string | null;
  latest_shipment_date: string | null;
  latest_tracking_number: string | null;
};

export type ShipmentItemRow = {
  id: string;
  invoice_item_id: string;
  sku: string;
  product_name: string;
  quantity_shipped: number;
  lot_number: string | null;
  expiration_date: string | null;
  retest_date: string | null;
};

export type ShipmentRow = {
  id: string;
  invoice_id: string;
  shipment_number: string;
  shipment_date: string | null;
  carrier: string | null;
  service: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  notes: string | null;
  status: string;
  voided_reason: string | null;
  created_by_name: string | null;
  created_at: string;
  item_count: number;
  total_quantity: number;
  items: ShipmentItemRow[];
};

export type OrderFulfillmentSummary = {
  invoice_id: string;
  fulfillment_status: string;
  line_count: number;
  total_ordered: number;
  total_shipped: number;
  shippable_remaining: number;
  shipment_count: number;
};

export type OrderFulfillment = {
  lines: FulfillmentLine[];
  shipments: ShipmentRow[];
  summary: OrderFulfillmentSummary | null;
};

export async function getOrderFulfillment(invoiceId: string): Promise<OrderFulfillment> {
  // New fulfillment views are not yet in the generated types (regenerated after
  // migrations apply) — read via the loosely-typed client, like the PO module.
  const supabase = await createUntypedClient();
  const [{ data: lines }, { data: shipments }, { data: shipmentItems }, { data: summary }] = await Promise.all([
    supabase.from("v_order_fulfillment_lines").select("*").eq("invoice_id", invoiceId).order("created_at"),
    supabase
      .from("v_order_shipments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false }),
    supabase.from("v_order_shipment_items").select("*").eq("invoice_id", invoiceId).order("created_at"),
    supabase.from("v_order_fulfillment_summary").select("*").eq("invoice_id", invoiceId).maybeSingle(),
  ]);

  const itemsByShipment = new Map<string, ShipmentItemRow[]>();
  for (const si of shipmentItems ?? []) {
    const arr = itemsByShipment.get(si.shipment_id as string) ?? [];
    arr.push({
      id: si.id as string,
      invoice_item_id: si.invoice_item_id as string,
      sku: si.sku as string,
      product_name: si.product_name as string,
      quantity_shipped: Number(si.quantity_shipped ?? 0),
      lot_number: (si.lot_number as string | null) ?? null,
      expiration_date: (si.expiration_date as string | null) ?? null,
      retest_date: (si.retest_date as string | null) ?? null,
    });
    itemsByShipment.set(si.shipment_id as string, arr);
  }

  return {
    lines: (lines ?? []).map((l) => ({
      invoice_item_id: l.invoice_item_id as string,
      sku: l.sku as string,
      product_name: l.product_name as string,
      strength: (l.strength as string | null) ?? null,
      pack_size: (l.pack_size as string | null) ?? null,
      quantity_ordered: Number(l.quantity_ordered ?? 0),
      quantity_shipped: Number(l.quantity_shipped ?? 0),
      quantity_remaining: Number(l.quantity_remaining ?? 0),
      operational_status: l.operational_status as string,
      fulfillment_status: l.fulfillment_status as string,
      lot_number: (l.lot_number as string | null) ?? null,
      expiration_date: (l.expiration_date as string | null) ?? null,
      latest_shipment_date: (l.latest_shipment_date as string | null) ?? null,
      latest_tracking_number: (l.latest_tracking_number as string | null) ?? null,
    })),
    shipments: (shipments ?? []).map((s) => ({
      id: s.id as string,
      invoice_id: s.invoice_id as string,
      shipment_number: s.shipment_number as string,
      shipment_date: (s.shipment_date as string | null) ?? null,
      carrier: (s.carrier as string | null) ?? null,
      service: (s.service as string | null) ?? null,
      tracking_number: (s.tracking_number as string | null) ?? null,
      tracking_url: (s.tracking_url as string | null) ?? null,
      notes: (s.notes as string | null) ?? null,
      status: s.status as string,
      voided_reason: (s.voided_reason as string | null) ?? null,
      created_by_name: (s.created_by_name as string | null) ?? null,
      created_at: s.created_at as string,
      item_count: Number(s.item_count ?? 0),
      total_quantity: Number(s.total_quantity ?? 0),
      items: itemsByShipment.get(s.id as string) ?? [],
    })),
    summary: summary
      ? {
          invoice_id: summary.invoice_id as string,
          fulfillment_status: summary.fulfillment_status as string,
          line_count: Number(summary.line_count ?? 0),
          total_ordered: Number(summary.total_ordered ?? 0),
          total_shipped: Number(summary.total_shipped ?? 0),
          shippable_remaining: Number(summary.shippable_remaining ?? 0),
          shipment_count: Number(summary.shipment_count ?? 0),
        }
      : null,
  };
}

// Fulfillment status per order for the Orders list — one round-trip, mapped by id.
export async function getOrderFulfillmentSummaryMap(): Promise<Map<string, string>> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_order_fulfillment_summary")
    .select("invoice_id,fulfillment_status")
    .limit(2000);
  return new Map((data ?? []).map((r: { invoice_id: string; fulfillment_status: string }) => [r.invoice_id, r.fulfillment_status]));
}

async function nameMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id,full_name").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

// ---- Builder inputs ---------------------------------------------------------

export type BuilderClient = {
  id: string;
  company_name: string;
  default_pricing_sheet_id: string | null;
  pricing_model_name: string | null;
  assigned_rep_id: string | null;
  payment_terms: string;
};

export type BuilderProduct = {
  id: string;
  sku: string;
  name: string;
  strength: string | null;
  pack_size: string | null;
  currency: string;
  true_cost: number | null; // null for reps (masked)
};

export type BuilderModel = { id: string; name: string; currency: string };

export type BuilderData = {
  clients: BuilderClient[];
  products: BuilderProduct[];
  models: BuilderModel[];
};

export async function getBuilderData(): Promise<BuilderData> {
  const supabase = await createClient();
  const [{ data: clients }, { data: products }, { data: models }] = await Promise.all([
    supabase
      .from("clients")
      .select("id,company_name,default_pricing_sheet_id,assigned_rep_id,payment_terms,status,pricing_sheets(name)")
      .eq("status", "active")
      .order("company_name"),
    supabase
      .from("catalog_products")
      .select("id,sku,name,strength,pack_size,currency,true_cost,status")
      .eq("status", "active")
      .order("name")
      .limit(5000),
    supabase.from("pricing_sheets").select("id,name,currency,status").eq("status", "active").order("name"),
  ]);

  const sheetName = (v: unknown): string | null => {
    const ps = (v as { pricing_sheets?: { name: string } | { name: string }[] | null } | null)?.pricing_sheets;
    if (!ps) return null;
    return Array.isArray(ps) ? ps[0]?.name ?? null : ps.name;
  };

  return {
    clients: (clients ?? []).map((c) => ({
      id: c.id,
      company_name: c.company_name,
      default_pricing_sheet_id: c.default_pricing_sheet_id,
      pricing_model_name: sheetName(c),
      assigned_rep_id: c.assigned_rep_id,
      payment_terms: c.payment_terms,
    })),
    products: (products ?? []).map((p) => ({
      id: p.id as string,
      sku: p.sku as string,
      name: p.name as string,
      strength: p.strength as string | null,
      pack_size: p.pack_size as string | null,
      currency: (p.currency as string) ?? "USD",
      true_cost: p.true_cost as number | null,
    })),
    models: (models ?? []).map((m) => ({ id: m.id, name: m.name, currency: m.currency })),
  };
}

// The saved draft, reshaped into the builder's editable form model.
export type EditableOrder = {
  id: string;
  status: string;
  client_id: string | null;
  selected_model_id: string | null;
  currency: string;
  shipping: number;
  fees: number;
  discount: number;
  tax_rate: number;
  notes: string | null;
  lines: {
    product_id: string | null;
    quantity: number;
    unit_price: number;
    price_overridden: boolean;
    manual_reason: string | null;
    price_source: string | null;
    lot_number: string | null;
    manufacturing_date: string | null;
    expiration_date: string | null;
    retest_date: string | null;
  }[];
};

export async function getEditableOrder(id: string): Promise<EditableOrder | null> {
  const supabase = await createClient();
  const { data: header } = await supabase.from("v_orders").select("*").eq("id", id).maybeSingle();
  if (!header) return null;
  const { data: items } = await supabase
    .from("v_order_items")
    .select("product_id,quantity,unit_price,price_overridden,manual_reason,price_source,lot_number,manufacturing_date,expiration_date,retest_date")
    .eq("invoice_id", id)
    .order("created_at");
  const h = header as Record<string, unknown>;
  return {
    id: h.id as string,
    status: h.status as string,
    client_id: h.client_id as string | null,
    // The persisted pricing_sheet_id may be the client's default; the builder
    // treats it as the "selected model" for editing convenience.
    selected_model_id: h.pricing_sheet_id as string | null,
    currency: (h.currency as string) ?? "USD",
    shipping: Number(h.shipping ?? 0),
    fees: Number(h.fees ?? 0),
    discount: Number(h.discount ?? 0),
    tax_rate: Number(h.tax_rate ?? 0),
    notes: (h.notes as string | null) ?? null,
    lines: (items ?? []).map((it) => ({
      product_id: it.product_id as string | null,
      quantity: Number(it.quantity ?? 0),
      unit_price: Number(it.unit_price ?? 0),
      price_overridden: !!it.price_overridden,
      manual_reason: (it.manual_reason as string | null) ?? null,
      price_source: (it.price_source as string | null) ?? null,
      lot_number: (it.lot_number as string | null) ?? null,
      manufacturing_date: (it.manufacturing_date as string | null) ?? null,
      expiration_date: (it.expiration_date as string | null) ?? null,
      retest_date: (it.retest_date as string | null) ?? null,
    })),
  };
}

// ---- Invoice view model (customer-facing; preview + PDF share this) ----------

async function getInvoiceSettings(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("app_settings")
    .select(
      "company_name,logo_path,address,contact_email,contact_phone,payment_instructions,remittance_details,invoice_terms,invoice_footer",
    )
    .eq("id", true)
    .maybeSingle();
  return {
    company_name: data?.company_name ?? "Aurum Supply House",
    logo_path: data?.logo_path ?? null,
    address: (data?.address ?? {}) as Record<string, unknown>,
    contact_email: data?.contact_email ?? null,
    contact_phone: data?.contact_phone ?? null,
    payment_instructions: data?.payment_instructions ?? null,
    remittance_details: data?.remittance_details ?? null,
    invoice_terms: data?.invoice_terms ?? null,
    invoice_footer: data?.invoice_footer ?? null,
  };
}

export async function getInvoiceViewModel(id: string): Promise<InvoiceViewModel | null> {
  const supabase = await createClient();
  const { data: header } = await supabase.from("v_orders").select("*").eq("id", id).maybeSingle();
  if (!header) return null;

  const [{ data: items }, settings] = await Promise.all([
    supabase
      .from("v_order_items")
      .select("sku,product_name,strength,pack_size,quantity,unit_price,line_subtotal,lot_number,manufacturing_date,expiration_date,retest_date")
      .eq("invoice_id", id)
      .order("created_at"),
    getInvoiceSettings(supabase),
  ]);

  const h = header as Record<string, unknown>;
  const headerInput: InvoiceHeaderInput = {
    invoice_number: h.invoice_number as string,
    status: h.status as string,
    issue_date: (h.issue_date as string | null) ?? null,
    due_date: (h.due_date as string | null) ?? null,
    currency: (h.currency as string) ?? "USD",
    subtotal: Number(h.subtotal ?? 0),
    discount: Number(h.discount ?? 0),
    shipping: Number(h.shipping ?? 0),
    fees: Number(h.fees ?? 0),
    tax_rate: Number(h.tax_rate ?? 0),
    tax_amount: Number(h.tax_amount ?? 0),
    total: Number(h.total ?? 0),
    amount_paid: Number(h.amount_paid ?? 0),
    balance_due: Number(h.balance_due ?? 0),
    notes: (h.notes as string | null) ?? null,
    client_snapshot: (h.client_snapshot ?? null) as Record<string, unknown> | null,
  };

  return buildInvoiceViewModel(
    headerInput,
    (items ?? []).map((it) => ({
      sku: it.sku as string,
      product_name: it.product_name as string,
      strength: it.strength as string | null,
      pack_size: it.pack_size as string | null,
      quantity: Number(it.quantity ?? 0),
      unit_price: Number(it.unit_price ?? 0),
      line_subtotal: Number(it.line_subtotal ?? 0),
      lot_number: (it.lot_number as string | null) ?? null,
      manufacturing_date: (it.manufacturing_date as string | null) ?? null,
      expiration_date: (it.expiration_date as string | null) ?? null,
      retest_date: (it.retest_date as string | null) ?? null,
    })),
    settings,
  );
}

// ---- Packing slip view model (customer-facing; preview + PDF share this) ------
// All reads go through the row-scoped fulfillment views, so an out-of-scope
// invoice or shipment id resolves to null (→ 404) and no internal financial
// field is ever queried. No service-role credentials are used.
export async function getPackingSlipViewModel(
  invoiceId: string,
  shipmentId: string,
): Promise<PackingSlipViewModel | null> {
  // Reads span new fulfillment views not yet in the generated types.
  const supabase = await createUntypedClient();

  const { data: header } = await supabase
    .from("v_orders")
    .select("id,invoice_number,client_snapshot")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!header) return null;

  const { data: shipment } = await supabase
    .from("v_order_shipments")
    .select("id,invoice_id,shipment_number,shipment_date,status,carrier,service,tracking_number,tracking_url,created_at")
    .eq("id", shipmentId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (!shipment) return null;

  const [{ data: thisItems }, { data: allItems }, { data: allShipments }, { data: fulfillmentLines }, settings] =
    await Promise.all([
      supabase
        .from("v_order_shipment_items")
        .select("invoice_item_id,sku,product_name,quantity_shipped,lot_number,expiration_date,retest_date")
        .eq("shipment_id", shipmentId)
        .order("created_at"),
      supabase
        .from("v_order_shipment_items")
        .select("shipment_id,invoice_item_id,quantity_shipped")
        .eq("invoice_id", invoiceId),
      supabase
        .from("v_order_shipments")
        .select("id,status,created_at,shipment_number")
        .eq("invoice_id", invoiceId),
      supabase
        .from("v_order_fulfillment_lines")
        .select("invoice_item_id,quantity_ordered,strength,pack_size")
        .eq("invoice_id", invoiceId),
      supabase.from("app_settings").select("company_name,logo_path").eq("id", true).maybeSingle(),
    ]);
  const settingsRow = (settings?.data ?? null) as { company_name?: string | null; logo_path?: string | null } | null;

  // Order finalized shipments deterministically so "previously shipped" is the
  // sum from every finalized shipment that precedes THIS one.
  const shipmentsById = new Map(
    (allShipments ?? []).map((s) => [
      s.id as string,
      { status: s.status as string, key: `${s.created_at as string}|${s.shipment_number as string}` },
    ]),
  );
  const thisKey = `${shipment.created_at as string}|${shipment.shipment_number as string}`;

  const orderedByItem = new Map(
    (fulfillmentLines ?? []).map((l) => [
      l.invoice_item_id as string,
      {
        quantity_ordered: Number(l.quantity_ordered ?? 0),
        strength: (l.strength as string | null) ?? null,
        pack_size: (l.pack_size as string | null) ?? null,
      },
    ]),
  );

  const previouslyByItem = new Map<string, number>();
  for (const si of allItems ?? []) {
    const sh = shipmentsById.get(si.shipment_id as string);
    if (!sh || sh.status !== "finalized") continue; // voided shipments never count
    if (sh.key >= thisKey) continue; // strictly before THIS shipment
    const itemId = si.invoice_item_id as string;
    previouslyByItem.set(itemId, (previouslyByItem.get(itemId) ?? 0) + Number(si.quantity_shipped ?? 0));
  }

  const lines: PackingSlipLineInput[] = (thisItems ?? []).map((it) => {
    const itemId = it.invoice_item_id as string;
    const ctx = orderedByItem.get(itemId);
    return {
      sku: it.sku as string,
      product_name: it.product_name as string,
      strength: ctx?.strength ?? null,
      pack_size: ctx?.pack_size ?? null,
      quantity_ordered: ctx?.quantity_ordered ?? Number(it.quantity_shipped ?? 0),
      quantity_this_shipment: Number(it.quantity_shipped ?? 0),
      previously_shipped: previouslyByItem.get(itemId) ?? 0,
      lot_number: (it.lot_number as string | null) ?? null,
      expiration_date: (it.expiration_date as string | null) ?? null,
      retest_date: (it.retest_date as string | null) ?? null,
    };
  });

  return buildPackingSlipViewModel(
    {
      invoice_number: header.invoice_number as string,
      client_snapshot: (header.client_snapshot ?? null) as Record<string, unknown> | null,
    },
    {
      shipment_number: shipment.shipment_number as string,
      shipment_date: (shipment.shipment_date as string | null) ?? null,
      status: shipment.status as string,
      carrier: (shipment.carrier as string | null) ?? null,
      service: (shipment.service as string | null) ?? null,
      tracking_number: (shipment.tracking_number as string | null) ?? null,
      tracking_url: (shipment.tracking_url as string | null) ?? null,
    },
    lines,
    { company_name: settingsRow?.company_name ?? "Aurum Supply House", logo_path: settingsRow?.logo_path ?? null },
  );
}
