-- ============================================================================
-- Aurum Supply House · 0370 · M6 · Invoice lot view fix (ADDITIVE)
-- ----------------------------------------------------------------------------
-- 0360 was recorded as applied, but the LIVE public.v_order_items still ends at
-- column 20 (id … line_gross_profit) and never surfaced the four lot fields.
-- This migration re-asserts the intended view definition additively so the live
-- object matches the source of truth. It is IDENTICAL in shape to the 0360 view
-- and safe to (re)apply:
--   * The 20 columns from 0210 are preserved in their EXACT original order, so
--     CREATE OR REPLACE VIEW sees no rename/reorder (PostgreSQL rejects those —
--     SQLSTATE 42P16); the four lot fields are APPENDED at positions 21–24.
--   * security_invoker = false / security_barrier = true are preserved.
--   * app.can_access_invoice(ii.invoice_id) row filtering is preserved.
--   * Role-based masking of unit/line true cost and line gross profit (admin
--     only) is preserved.
--   * coa_path is NEVER exposed on this (or any) read surface.
-- Do NOT edit or rerun 0360; this file is the corrective, forward-only fix.
-- ============================================================================

create or replace view public.v_order_items
  with (security_invoker = false, security_barrier = true)
as
select
  -- ---- Columns 1–20: preserved from 0210 in their exact original order -------
  ii.id,                                                            -- 1
  ii.invoice_id,                                                    -- 2
  ii.product_id,                                                    -- 3
  ii.sku,                                                           -- 4
  ii.product_name,                                                  -- 5
  ii.strength,                                                      -- 6
  ii.pack_size,                                                     -- 7
  ii.manufacturer_name,                                             -- 8
  ii.quantity,                                                      -- 9
  ii.unit_price,                                                    -- 10
  ii.line_subtotal,                                                 -- 11
  ii.price_overridden,                                              -- 12
  ii.original_unit_price,                                           -- 13
  ii.price_source,                                                  -- 14
  ii.price_source_sheet,                                            -- 15
  ii.manual_reason,                                                 -- 16
  ii.created_at,                                                    -- 17
  -- Internal cost — masked for non-admins.
  case when app.is_admin() then ii.unit_true_cost    end as unit_true_cost,    -- 18
  case when app.is_admin() then ii.line_true_cost    end as line_true_cost,    -- 19
  case when app.is_admin() then ii.line_gross_profit end as line_gross_profit, -- 20
  -- ---- Columns 21–24: lot annotation appended AFTER the 0210 columns ---------
  -- coa_path is deliberately excluded from every read surface.
  ii.lot_number,                                                    -- 21
  ii.manufacturing_date,                                            -- 22
  ii.expiration_date,                                               -- 23
  ii.retest_date                                                    -- 24
from public.invoice_items ii
where app.can_access_invoice(ii.invoice_id);

revoke all on public.v_order_items from anon;
grant select on public.v_order_items to authenticated;
comment on view public.v_order_items is
  'Staff order line-item surface. Exposes lot number + lot dates (never coa_path); masks true cost / GP for non-admins.';

-- ---- Verification: the four lot fields must occupy positions 21–24 -----------
-- Fails the migration loudly if the live view did not pick up the appended
-- columns at their expected ordinal positions (and confirms coa_path is absent).
do $$
declare
  v_total       integer;
  v_lot         integer;
  v_mfg         integer;
  v_exp         integer;
  v_retest      integer;
  v_coa         integer;
begin
  select count(*)::int into v_total
    from information_schema.columns
   where table_schema = 'public' and table_name = 'v_order_items';

  select ordinal_position into v_lot    from information_schema.columns
   where table_schema='public' and table_name='v_order_items' and column_name='lot_number';
  select ordinal_position into v_mfg    from information_schema.columns
   where table_schema='public' and table_name='v_order_items' and column_name='manufacturing_date';
  select ordinal_position into v_exp    from information_schema.columns
   where table_schema='public' and table_name='v_order_items' and column_name='expiration_date';
  select ordinal_position into v_retest from information_schema.columns
   where table_schema='public' and table_name='v_order_items' and column_name='retest_date';
  select ordinal_position into v_coa    from information_schema.columns
   where table_schema='public' and table_name='v_order_items' and column_name='coa_path';

  if v_total <> 24 then
    raise exception 'v_order_items must have exactly 24 columns; found %.', v_total;
  end if;
  if v_lot    is distinct from 21 then raise exception 'lot_number must be column 21; found %.', v_lot; end if;
  if v_mfg    is distinct from 22 then raise exception 'manufacturing_date must be column 22; found %.', v_mfg; end if;
  if v_exp    is distinct from 23 then raise exception 'expiration_date must be column 23; found %.', v_exp; end if;
  if v_retest is distinct from 24 then raise exception 'retest_date must be column 24; found %.', v_retest; end if;
  if v_coa    is not null then raise exception 'coa_path must never be exposed on v_order_items (found at column %).', v_coa; end if;

  raise notice 'v_order_items verified: 24 columns; lot_number=21, manufacturing_date=22, expiration_date=23, retest_date=24; coa_path absent.';
end $$;
