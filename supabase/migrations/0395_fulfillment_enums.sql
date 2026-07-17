-- ============================================================================
-- Aurum Supply House · 0395 · Fulfillment · Enums & shipment numbering (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Partial-order fulfillment: independent per-line fulfillment states, multiple
-- shipments per order, and branded packing slips. This block is PURELY additive
-- and touches NOTHING that exists: no invoice/quote/PO/commission table, view,
-- RPC, trigger, RLS policy, or financial snapshot is modified. All new objects
-- live alongside the current schema.
--
-- Design invariants (enforced by 0396–0399):
--   • Quantities are authoritative. quantity_shipped is DERIVED from finalized
--     shipment-item rows; it is never a manually-editable number and can never be
--     negative or exceed quantity_ordered.
--   • Issued-invoice financial immutability is preserved. Fulfillment data lives
--     in NEW child tables — invoice_items is never mutated by shipping, so
--     totals / price / true cost / gross profit / commissions / payments cannot
--     change. (The reserved invoices.stage column is left untouched too.)
--   • Owner/Admin only at the DB (app.is_admin()); the UI adds an Owner-only
--     launch surface without weakening any RLS, masking, or role protection.
-- ----------------------------------------------------------------------------
-- Highest prior migration: 0394. This file starts the additive 0395+ block.
-- ============================================================================

-- Operational fulfillment status — the MANUALLY-settable subset. "Partially
-- shipped" and "Shipped" are deliberately NOT here: they are derived from
-- shipment quantities and must never be selected by hand.
do $$ begin
  create type fulfillment_op_status as enum
    ('not_yet_shipped','in_production','ready_to_ship','backordered','cancelled');
exception when duplicate_object then null; end $$;

-- Derived per-line fulfillment status — the full customer-visible set. A superset
-- of fulfillment_op_status plus the two quantity-derived states.
do $$ begin
  create type fulfillment_line_status as enum
    ('not_yet_shipped','in_production','ready_to_ship',
     'partially_shipped','shipped','backordered','cancelled');
exception when duplicate_object then null; end $$;

-- Shipment record lifecycle. Shipments are created finalized and are append-only;
-- a correction is an audited void (status -> 'void'), never a silent edit.
do $$ begin
  create type shipment_status as enum ('finalized','void');
exception when duplicate_object then null; end $$;

-- Derived order-level fulfillment summary — kept strictly SEPARATE from the
-- financial invoice_status (draft/sent/partial/paid/void). Payment status and
-- fulfillment status are two independent axes.
do $$ begin
  create type order_fulfillment_status as enum
    ('not_started','in_progress','partially_shipped','fully_shipped','cancelled');
exception when duplicate_object then null; end $$;

-- Branded packing-slip / shipment numbering — PS-#### (mirrors the concurrency-
-- safe app.next_invoice_number allocator, 0180). Monotonic: a voided shipment's
-- number is retired and never reissued.
insert into public.document_sequences(key, next_value) values ('shipment_ps', 1001)
on conflict (key) do nothing;

create or replace function app.next_shipment_number()
returns text language plpgsql security definer set search_path = public as $$
declare v_num bigint;
begin
  update public.document_sequences set next_value = next_value + 1
   where key = 'shipment_ps' returning next_value - 1 into v_num;
  if v_num is null then
    insert into public.document_sequences(key, next_value) values ('shipment_ps', 1002)
    on conflict (key) do update set next_value = document_sequences.next_value + 1
    returning next_value - 1 into v_num;
  end if;
  return 'PS-' || v_num::text;
end;
$$;

comment on function app.next_shipment_number() is
  'Concurrency-safe packing-slip/shipment number allocator (PS-1001…). Never reuses a retired number.';
