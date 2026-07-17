-- ============================================================================
-- Aurum Supply House · 0180 · M4 · Settings, invoice numbering, order discount
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. Extends app_settings with invoice-presentation fields (payment
-- instructions come from settings, never hardcoded), adds an order-level discount
-- column to invoices, and introduces an Aurum-branded, concurrency-safe invoice
-- numbering sequence (AUR-1001, AUR-1002, …) that never reuses a voided number.
-- ============================================================================

-- ---- app_settings: invoice presentation + remittance (owner-editable) -------
alter table public.app_settings
  add column if not exists invoice_number_prefix text not null default 'AUR',
  add column if not exists payment_instructions  text,      -- how to pay (wire/ACH/check text)
  add column if not exists remittance_details     text,     -- optional bank/remit-to block
  add column if not exists invoice_terms          text,     -- default customer terms/notes
  add column if not exists invoice_footer         text;     -- footer line (thank-you, contact)

comment on column public.app_settings.payment_instructions is
  'Customer-facing payment instructions printed on invoices. Configured here, never hardcoded.';

-- ---- invoices: order-level discount (customer-facing revenue reduction) ------
-- Discount reduces product net sales BEFORE tax. Defaults to 0 so all existing
-- rows and prior math (net_sales = subtotal - 0 = subtotal) are unchanged.
alter table public.invoices
  add column if not exists discount numeric(14,4) not null default 0 check (discount >= 0);

comment on column public.invoices.discount is
  'Customer-facing order discount applied to product sales before tax. Reduces revenue & gross profit.';

-- ---- Aurum invoice numbering sequence ---------------------------------------
-- Separate sequence key so we never disturb the legacy INV-YYYY-NNNNNN sequence
-- ('invoice') that other tooling may reference. First allocation → 1001.
insert into public.document_sequences (key, next_value)
values ('invoice_aur', 1001)
on conflict (key) do nothing;

-- Allocate the next branded invoice number atomically. The UPDATE takes a row
-- lock on the sequence row, so concurrent issuers are serialized and can never
-- receive the same number. Voided invoices keep their (now-retired) numbers; the
-- monotonic counter guarantees they are never handed out again.
create or replace function app.next_invoice_number()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_num    bigint;
  v_prefix text;
begin
  select coalesce(nullif(btrim(invoice_number_prefix), ''), 'AUR')
    into v_prefix from public.app_settings where id = true;

  update public.document_sequences
     set next_value = next_value + 1
   where key = 'invoice_aur'
  returning next_value - 1 into v_num;

  if v_num is null then
    insert into public.document_sequences(key, next_value)
    values ('invoice_aur', 1002)
    on conflict (key) do update set next_value = document_sequences.next_value + 1
    returning next_value - 1 into v_num;
  end if;

  return coalesce(v_prefix, 'AUR') || '-' || v_num::text;
end;
$$;

comment on function app.next_invoice_number() is
  'Concurrency-safe Aurum invoice number allocator (AUR-1001…). Never reuses voided numbers.';
