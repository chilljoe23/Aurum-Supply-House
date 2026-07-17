import "server-only";

import { createUntypedClient } from "@/lib/supabase/untyped";
import {
  buildPurchaseOrderViewModel,
  type PurchaseOrderViewModel,
} from "@/lib/purchase-orders/purchase-order-document";

// Purchasing is Owner/Admin-only; every relation below inherits admin-only RLS
// (0350), so a Sales Rep gets zero rows. Reads go through the security_invoker
// views (0340) where available and base tables otherwise (admins may read them).

const N = (v: unknown) => Number(v ?? 0);

export type PurchaseOrderListRow = {
  id: string;
  po_number: string;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  expected_date: string | null;
  next_expected_arrival: string | null;
  tracking_numbers: string | null;
  line_count: number;
  created_at: string;
  updated_at: string;
};

export async function getPurchaseOrdersList(): Promise<PurchaseOrderListRow[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("v_purchase_orders")
    .select(
      "id,po_number,manufacturer_id,manufacturer_name,status,currency,total,amount_paid,balance_due,expected_date,next_expected_arrival,tracking_numbers,line_count,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    po_number: r.po_number as string,
    manufacturer_id: (r.manufacturer_id as string | null) ?? null,
    manufacturer_name: (r.manufacturer_name as string | null) ?? null,
    status: r.status as string,
    currency: (r.currency as string) ?? "USD",
    total: N(r.total),
    amount_paid: N(r.amount_paid),
    balance_due: N(r.balance_due),
    expected_date: (r.expected_date as string | null) ?? null,
    next_expected_arrival: (r.next_expected_arrival as string | null) ?? null,
    tracking_numbers: (r.tracking_numbers as string | null) ?? null,
    line_count: N(r.line_count),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));
}

export type PoDetailItem = {
  id: string;
  sku: string;
  product_name: string;
  description: string;
  manufacturer_sku: string | null;
  manufacturer_description: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
  currency: string;
  resolved_cost_source: string | null;
  resolved_tier_min: number | null;
  resolved_tier_max: number | null;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
  cost_reason: string | null;
  quantity_received: number;
};

export type PoDetail = {
  header: {
    id: string;
    po_number: string;
    manufacturer_id: string | null;
    manufacturer_name: string | null;
    manufacturer_snapshot: Record<string, unknown> | null;
    status: string;
    currency: string;
    subtotal: number;
    shipping: number;
    fees: number;
    tax: number;
    total: number;
    amount_paid: number;
    balance_due: number;
    payment_terms: string | null;
    expected_date: string | null;
    notes: string | null;
    sent_at: string | null;
    confirmed_at: string | null;
    received_at: string | null;
    created_at: string;
    updated_at: string;
  };
  items: PoDetailItem[];
  payments: {
    id: string;
    type: string;
    amount: number;
    signed_amount: number;
    payment_date: string;
    method: string;
    reference: string | null;
    notes: string | null;
    created_at: string;
  }[];
  statusHistory: { from_status: string | null; to_status: string; note: string | null; created_at: string }[];
  attachments: {
    id: string;
    type: string;
    filename: string;
    storage_path: string;
    file_type: string | null;
    size_bytes: number | null;
    note: string | null;
    created_at: string;
  }[];
  shipments: {
    id: string;
    carrier: string | null;
    tracking_number: string | null;
    ship_date: string | null;
    expected_arrival_date: string | null;
    received_date: string | null;
    notes: string | null;
    created_at: string;
  }[];
  receipts: {
    id: string;
    purchase_order_item_id: string;
    quantity_received: number;
    received_date: string;
    lot_number: string | null;
    notes: string | null;
    created_at: string;
  }[];
  activity: { action: string; summary: string | null; created_at: string }[];
};

export async function getPurchaseOrderDetail(id: string): Promise<PoDetail | null> {
  const supabase = await createUntypedClient();

  const { data: header } = await supabase
    .from("v_purchase_orders")
    .select(
      "id,po_number,manufacturer_id,manufacturer_name,status,currency,subtotal,shipping,fees,tax,total,amount_paid,balance_due,payment_terms,expected_date,notes,sent_at,confirmed_at,received_at,created_at,updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!header) return null;

  // manufacturer_snapshot lives on the base table (not the view).
  const { data: snapRow } = await supabase
    .from("purchase_orders")
    .select("manufacturer_snapshot")
    .eq("id", id)
    .maybeSingle();

  const [items, payments, statusHistory, attachments, shipments, receipts, activity] = await Promise.all([
    supabase
      .from("v_purchase_order_items")
      .select(
        "id,sku,product_name,description,manufacturer_sku,manufacturer_description,quantity,unit_cost,line_total,currency,resolved_cost_source,resolved_tier_min,resolved_tier_max,moq,order_multiple,lead_time_days,cost_reason,quantity_received,created_at",
      )
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("v_manufacturer_payments")
      .select("id,type,amount,signed_amount,payment_date,method,reference,notes,created_at")
      .eq("purchase_order_id", id)
      .order("payment_date", { ascending: true }),
    supabase
      .from("purchase_order_status_history")
      .select("from_status,to_status,note,created_at")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("purchase_order_attachments")
      .select("id,type,filename,storage_path,file_type,size_bytes,note,created_at")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_order_shipments")
      .select("id,carrier,tracking_number,ship_date,expected_arrival_date,received_date,notes,created_at")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_order_receipts")
      .select("id,purchase_order_item_id,quantity_received,received_date,lot_number,notes,created_at")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("activity_log")
      .select("action,summary,created_at")
      .eq("entity_type", "purchase_order")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return {
    header: {
      id: header.id,
      po_number: header.po_number,
      manufacturer_id: header.manufacturer_id ?? null,
      manufacturer_name: header.manufacturer_name ?? null,
      manufacturer_snapshot: (snapRow?.manufacturer_snapshot as Record<string, unknown> | null) ?? null,
      status: header.status,
      currency: header.currency ?? "USD",
      subtotal: N(header.subtotal),
      shipping: N(header.shipping),
      fees: N(header.fees),
      tax: N(header.tax),
      total: N(header.total),
      amount_paid: N(header.amount_paid),
      balance_due: N(header.balance_due),
      payment_terms: header.payment_terms ?? null,
      expected_date: header.expected_date ?? null,
      notes: header.notes ?? null,
      sent_at: header.sent_at ?? null,
      confirmed_at: header.confirmed_at ?? null,
      received_at: header.received_at ?? null,
      created_at: header.created_at,
      updated_at: header.updated_at,
    },
    items: (items.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      sku: r.sku as string,
      product_name: r.product_name as string,
      description: (r.description as string) ?? "",
      manufacturer_sku: (r.manufacturer_sku as string | null) ?? null,
      manufacturer_description: (r.manufacturer_description as string | null) ?? null,
      quantity: N(r.quantity),
      unit_cost: N(r.unit_cost),
      line_total: N(r.line_total),
      currency: (r.currency as string) ?? "USD",
      resolved_cost_source: (r.resolved_cost_source as string | null) ?? null,
      resolved_tier_min: r.resolved_tier_min != null ? N(r.resolved_tier_min) : null,
      resolved_tier_max: r.resolved_tier_max != null ? N(r.resolved_tier_max) : null,
      moq: r.moq != null ? N(r.moq) : null,
      order_multiple: r.order_multiple != null ? N(r.order_multiple) : null,
      lead_time_days: r.lead_time_days != null ? N(r.lead_time_days) : null,
      cost_reason: (r.cost_reason as string | null) ?? null,
      quantity_received: N(r.quantity_received),
    })),
    payments: (payments.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      type: r.type as string,
      amount: N(r.amount),
      signed_amount: N(r.signed_amount),
      payment_date: r.payment_date as string,
      method: r.method as string,
      reference: (r.reference as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      created_at: r.created_at as string,
    })),
    statusHistory: (statusHistory.data ?? []).map((r: Record<string, unknown>) => ({
      from_status: (r.from_status as string | null) ?? null,
      to_status: r.to_status as string,
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
    })),
    attachments: (attachments.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      type: r.type as string,
      filename: r.filename as string,
      storage_path: r.storage_path as string,
      file_type: (r.file_type as string | null) ?? null,
      size_bytes: r.size_bytes != null ? N(r.size_bytes) : null,
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
    })),
    shipments: (shipments.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      carrier: (r.carrier as string | null) ?? null,
      tracking_number: (r.tracking_number as string | null) ?? null,
      ship_date: (r.ship_date as string | null) ?? null,
      expected_arrival_date: (r.expected_arrival_date as string | null) ?? null,
      received_date: (r.received_date as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      created_at: r.created_at as string,
    })),
    receipts: (receipts.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      purchase_order_item_id: r.purchase_order_item_id as string,
      quantity_received: N(r.quantity_received),
      received_date: r.received_date as string,
      lot_number: (r.lot_number as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      created_at: r.created_at as string,
    })),
    activity: (activity.data ?? []).map((r: Record<string, unknown>) => ({
      action: r.action as string,
      summary: (r.summary as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  };
}

// ---- Builder bootstrap ------------------------------------------------------
export type PoManufacturerOption = { id: string; name: string };

export async function getPoBuilderData(): Promise<{ manufacturers: PoManufacturerOption[] }> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturers")
    .select("id,name,status")
    .eq("status", "active")
    .order("name", { ascending: true });
  return {
    manufacturers: (data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, name: r.name as string })),
  };
}

export type PoCatalogProduct = {
  product_id: string;
  sku: string;
  product_name: string;
  manufacturer_sku: string | null;
  manufacturer_description: string | null;
  current_unit_cost: number | null;
  currency: string;
  moq: number | null;
  order_multiple: number | null;
  lead_time_days: number | null;
};

// The active product relationships for ONE manufacturer (admin-only cost view).
export async function getManufacturerCatalog(manufacturerId: string): Promise<PoCatalogProduct[]> {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("manufacturer_product_costs")
    .select(
      "product_id,sku,product_name,manufacturer_sku,manufacturer_description,current_unit_cost,currency,moq,order_multiple,lead_time_days,active,product_status",
    )
    .eq("manufacturer_id", manufacturerId)
    .eq("active", true)
    .eq("product_status", "active")
    .order("sku", { ascending: true });
  return (data ?? []).map((r: Record<string, unknown>) => ({
    product_id: r.product_id as string,
    sku: r.sku as string,
    product_name: r.product_name as string,
    manufacturer_sku: (r.manufacturer_sku as string | null) ?? null,
    manufacturer_description: (r.manufacturer_description as string | null) ?? null,
    current_unit_cost: r.current_unit_cost != null ? N(r.current_unit_cost) : null,
    currency: (r.currency as string) ?? "USD",
    moq: r.moq != null ? N(r.moq) : null,
    order_multiple: r.order_multiple != null ? N(r.order_multiple) : null,
    lead_time_days: r.lead_time_days != null ? N(r.lead_time_days) : null,
  }));
}

export type EditablePurchaseOrder = {
  id: string;
  manufacturer_id: string | null;
  currency: string;
  shipping: number;
  fees: number;
  tax: number;
  expected_date: string | null;
  payment_terms: string | null;
  notes: string | null;
  lines: {
    product_id: string;
    quantity: number;
    unit_cost: number;
    resolved_cost_source: string | null;
    manual: boolean;
    manual_reason: string | null;
    notes: string | null;
  }[];
};

export async function getEditablePurchaseOrder(id: string): Promise<EditablePurchaseOrder | null> {
  const supabase = await createUntypedClient();
  const { data: h } = await supabase
    .from("purchase_orders")
    .select("id,manufacturer_id,status,currency,shipping,fees,tax,expected_date,payment_terms,notes")
    .eq("id", id)
    .maybeSingle();
  if (!h || h.status !== "draft") return null;

  const { data: items } = await supabase
    .from("purchase_order_items")
    .select("product_id,quantity,unit_cost,resolved_cost_source,cost_reason,notes,created_at")
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: true });

  return {
    id: h.id,
    manufacturer_id: h.manufacturer_id ?? null,
    currency: h.currency ?? "USD",
    shipping: N(h.shipping),
    fees: N(h.fees),
    tax: N(h.tax),
    expected_date: h.expected_date ?? null,
    payment_terms: h.payment_terms ?? null,
    notes: h.notes ?? null,
    lines: (items ?? []).map((r: Record<string, unknown>) => ({
      product_id: (r.product_id as string) ?? "",
      quantity: N(r.quantity),
      unit_cost: N(r.unit_cost),
      resolved_cost_source: (r.resolved_cost_source as string | null) ?? null,
      manual: r.resolved_cost_source === "manual",
      manual_reason: (r.cost_reason as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    })),
  };
}

// ---- PO document view model -------------------------------------------------
async function getPoSettings() {
  const supabase = await createUntypedClient();
  const { data } = await supabase
    .from("app_settings")
    .select("company_name,address,contact_email,contact_phone")
    .eq("id", true)
    .maybeSingle();
  return {
    company_name: (data?.company_name as string) ?? "Aurum Supply House",
    address: (data?.address as Record<string, unknown> | null) ?? null,
    contact_email: (data?.contact_email as string | null) ?? null,
    contact_phone: (data?.contact_phone as string | null) ?? null,
    po_footer: null as string | null,
  };
}

export async function getPurchaseOrderViewModel(id: string): Promise<PurchaseOrderViewModel | null> {
  const detail = await getPurchaseOrderDetail(id);
  if (!detail) return null;
  const settings = await getPoSettings();

  const poDate = detail.header.sent_at
    ? detail.header.sent_at.slice(0, 10)
    : detail.header.created_at.slice(0, 10);

  return buildPurchaseOrderViewModel(
    {
      po_number: detail.header.po_number,
      status: detail.header.status,
      po_date: poDate,
      expected_date: detail.header.expected_date,
      payment_terms: detail.header.payment_terms,
      currency: detail.header.currency,
      subtotal: detail.header.subtotal,
      shipping: detail.header.shipping,
      fees: detail.header.fees,
      tax: detail.header.tax,
      total: detail.header.total,
      amount_paid: detail.header.amount_paid,
      balance_due: detail.header.balance_due,
      notes: detail.header.notes,
      manufacturer_snapshot: detail.header.manufacturer_snapshot,
    },
    detail.items.map((it) => ({
      sku: it.sku,
      product_name: it.description || it.product_name,
      strength: null,
      pack_size: null,
      manufacturer_sku: it.manufacturer_sku,
      manufacturer_description: it.manufacturer_description,
      quantity: it.quantity,
      unit_cost: it.unit_cost,
      line_total: it.line_total,
    })),
    settings,
  );
}
