-- ============================================================================
-- Aurum Supply House · 0384 · Quotes · Row Level Security (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Same defense-in-depth model M4 uses for orders (0080 + 0210): the base tables
-- are admin-only for DIRECT access; Sales Reps read through the row-scoped,
-- security-barrier views (v_quotes / v_quote_items) and mutate ONLY through the
-- SECURITY DEFINER RPCs (0382) — never the base tables. This guarantees a rep can
-- never flip a status, edit frozen financials, or read another rep's quote by a
-- direct table write, and there is no cost column anywhere to leak.
-- ============================================================================

alter table public.quotes               enable row level security;
alter table public.quote_items          enable row level security;
alter table public.quote_status_history enable row level security;

-- ---- quotes : admin-only base access (reps use v_quotes + RPCs) -------------
drop policy if exists quotes_admin_all on public.quotes;
create policy quotes_admin_all on public.quotes for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- quote_items : admin-only base access (reps use v_quote_items + RPCs) ----
drop policy if exists quote_items_admin_all on public.quote_items;
create policy quote_items_admin_all on public.quote_items for all
  using (app.is_admin()) with check (app.is_admin());

-- ---- quote_status_history : rep may READ history for a quote they can access;
--       writes happen only through the definer log trigger / RPCs. -------------
drop policy if exists quote_hist_admin_all on public.quote_status_history;
create policy quote_hist_admin_all on public.quote_status_history for all
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists quote_hist_read on public.quote_status_history;
create policy quote_hist_read on public.quote_status_history for select
  using (app.can_access_quote(quote_id));

-- ---- Table privileges: reachable by `authenticated` (RLS is the real gate),
--       never by `anon`. -------------------------------------------------------
revoke all on public.quotes               from anon;
revoke all on public.quote_items          from anon;
revoke all on public.quote_status_history from anon;
grant select, insert, update, delete on public.quotes               to authenticated;
grant select, insert, update, delete on public.quote_items          to authenticated;
grant select, insert, update, delete on public.quote_status_history to authenticated;
