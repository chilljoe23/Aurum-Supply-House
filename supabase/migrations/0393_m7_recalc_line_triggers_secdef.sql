-- ============================================================================
-- Aurum Supply House · 0393 · M7 · FIX — "permission denied for schema app"
--                                        inside the per-line recalc triggers
-- ----------------------------------------------------------------------------
-- SYMPTOM (live database)
--   Writing an invoice line (and, identically, a purchase-order line) raised:
--       permission denied for schema app
--   from inside app.recalc_invoice_line() at the point it calls app.money_round().
--
-- ROOT CAUSE
--   0001 locks the private helper schema down: `revoke all on schema app from
--   public, anon, authenticated;` — the API roles have NO USAGE on schema `app`.
--   The two per-line BEFORE triggers below were created with the DEFAULT
--   SECURITY INVOKER context and no search_path:
--       app.recalc_invoice_line()  (0060, on public.invoice_items)
--       app.recalc_po_line()       (0050, on public.purchase_order_items)
--   When the app writes a line row directly as `authenticated` (PostgREST), the
--   trigger body runs AS `authenticated`. Resolving the schema-qualified call
--   `app.money_round(...)` then requires USAGE on schema `app`, which that role
--   does not have → "permission denied for schema app".
--   Every OTHER money_round caller (app.recalc_invoice, app.recalc_po_header,
--   app.compute_commission, app.recalc_quote, …) is already SECURITY DEFINER, so
--   only these two per-line triggers were affected. This is a missed-hardening
--   defect, not a schema-permission that should be opened up.
--
-- FIX (narrow, additive, behavior-preserving)
--   Recreate ONLY these two trigger functions as SECURITY DEFINER with a locked,
--   empty search_path. `create or replace function` keeps the same function OID,
--   so the existing triggers (trg_inv_line_calc, trg_po_line_calc) stay bound and
--   are NOT touched. The function owner (the app-schema owner) already holds USAGE
--   on schema `app`, so the definer context resolves app.money_round without
--   granting any API role access to the `app` schema.
--
-- WHY THIS IS SAFE
--   * The bodies are byte-for-byte identical in arithmetic — they only set
--     computed columns on the NEW row from values already in that row; no table
--     reads, no dynamic SQL. SECURITY DEFINER cannot change the result.
--   * `set search_path = ''` is the hardened choice: the only cross-schema
--     reference is the fully-qualified app.money_round(); all math resolves from
--     pg_catalog (always implicitly present). Nothing is looked up ambiguously.
--   * A SECURITY DEFINER *trigger function* does NOT bypass RLS on the triggering
--     statement — the INSERT/UPDATE on invoice_items / purchase_order_items is
--     still evaluated against the caller's role and policies. Only the trigger
--     body's own schema resolution is elevated. RLS, row-scoping and masking are
--     unchanged.
--   * No GRANT/REVOKE is issued. USAGE on schema `app` remains revoked from
--     public/anon/authenticated exactly as 0001 set it.
-- ============================================================================

-- Invoice line (0060 · trigger trg_inv_line_calc on public.invoice_items) --------
create or replace function app.recalc_invoice_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.line_subtotal     := app.money_round(new.quantity * new.unit_price, 4);
  new.line_true_cost    := app.money_round(new.quantity * new.unit_true_cost, 4);
  new.line_gross_profit := new.line_subtotal - new.line_true_cost;
  return new;
end;
$$;

-- Purchase-order line (0050 · trigger trg_po_line_calc on public.purchase_order_items)
-- Identical latent defect; Purchasing is an Owner module, so it is fixed here too.
create or replace function app.recalc_po_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.line_total := app.money_round(new.quantity * new.unit_cost, 4);
  return new;
end;
$$;

comment on function app.recalc_invoice_line() is
  'BEFORE trigger on invoice_items. SECURITY DEFINER + locked search_path (0393) so app.money_round resolves without granting API roles USAGE on schema app. Computation unchanged.';
comment on function app.recalc_po_line() is
  'BEFORE trigger on purchase_order_items. SECURITY DEFINER + locked search_path (0393) so app.money_round resolves without granting API roles USAGE on schema app. Computation unchanged.';
