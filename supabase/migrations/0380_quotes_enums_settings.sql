-- ============================================================================
-- Aurum Supply House · 0380 · Quotes · Enums, settings, numbering (ADDITIVE)
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. First migration of the customer-facing Quotes module. Nothing
-- in 0001–0370 is modified. Introduces:
--   • quote_status enum — the DB-enforced quote lifecycle.
--   • app_settings quote-presentation fields (owner-editable, never hardcoded):
--       quote_number_prefix (QTE → QTE-1001), quote_terms, quote_footer,
--       quote_expiration_days (default validity window).
--   • a concurrency-safe, monotonic, never-reused quote numbering sequence that
--     mirrors the invoice/PO allocators (0180/0320). Numbers are handed out only
--     when a quote is SENT, so drafts never consume a number.
-- ============================================================================

-- ---- Lifecycle enum ---------------------------------------------------------
-- draft → sent → accepted → converted (happy path). sent may also branch to
-- declined / expired; draft or sent may be voided. declined / expired / void /
-- converted are terminal. The state machine that enforces legal moves lives in
-- 0381; this only declares the vocabulary.
do $$ begin
  create type quote_status as enum
    ('draft','sent','accepted','declined','expired','converted','void');
exception when duplicate_object then null; end $$;

-- ---- app_settings: quote presentation (owner-editable) ----------------------
alter table public.app_settings
  add column if not exists quote_number_prefix   text not null default 'QTE',
  add column if not exists quote_terms           text,     -- default customer-facing quote terms/notes
  add column if not exists quote_footer          text,     -- footer / disclaimer line on the quote document
  add column if not exists quote_expiration_days integer not null default 30
    check (quote_expiration_days >= 0);

comment on column public.app_settings.quote_number_prefix is
  'Customer-facing quote number prefix (QTE → QTE-1001). Owner-configurable; historical numbers never change.';
comment on column public.app_settings.quote_expiration_days is
  'Default number of days a new quote stays valid (used to prefill the expiration date). 0 = no default.';

-- ---- Quote numbering sequence -----------------------------------------------
-- Separate sequence key. First allocation → 1001. The UPDATE takes a row lock on
-- the sequence row so concurrent senders are serialized and can never receive the
-- same number; voided/declined quotes keep their retired numbers and the monotonic
-- counter guarantees they are never handed out again.
insert into public.document_sequences (key, next_value)
values ('quote_aur', 1001)
on conflict (key) do nothing;

create or replace function app.next_quote_number()
returns text language plpgsql security definer set search_path = public as $$
declare v_num bigint; v_prefix text;
begin
  select coalesce(nullif(btrim(quote_number_prefix), ''), 'QTE')
    into v_prefix from public.app_settings where id = true;

  update public.document_sequences
     set next_value = next_value + 1
   where key = 'quote_aur'
  returning next_value - 1 into v_num;

  if v_num is null then
    insert into public.document_sequences(key, next_value)
    values ('quote_aur', 1002)
    on conflict (key) do update set next_value = document_sequences.next_value + 1
    returning next_value - 1 into v_num;
  end if;

  return coalesce(v_prefix, 'QTE') || '-' || v_num::text;
end;
$$;

comment on function app.next_quote_number() is
  'Concurrency-safe quote number allocator (QTE-1001…). Assigned at send; never reuses a retired number.';
