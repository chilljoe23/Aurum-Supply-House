-- ============================================================================
-- Aurum Supply House · 0065 · Order expenses (internal; never billed to customer)
-- ============================================================================
-- Internal costs attached to an order that reduce net profit but are NOT shown
-- on the customer invoice unless the user separately adds a customer charge
-- (invoices.fees / a line item). Categories: payment processing fee, outbound
-- (company-paid) shipping, packaging, testing, referral expense, other.
--
-- Net Profit = Gross Profit - Commission Expense - Σ(order_expenses).
-- Company-paid freight lives here; customer-paid shipping revenue lives on
-- invoices.shipping — the two are deliberately separate.

create table if not exists public.order_expenses (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  type        order_expense_type not null default 'other',
  amount      numeric(14,4) not null check (amount >= 0),
  note        text,
  incurred_on date not null default current_date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_order_expenses_invoice on public.order_expenses(invoice_id);
create index if not exists idx_order_expenses_type    on public.order_expenses(type);

-- Recompute the parent invoice's total_expenses + net_profit.
-- (Expenses may legitimately be recorded after an invoice is sent — e.g. a
--  payment-processing fee realized on payment — so this is intentionally NOT
--  blocked by the invoice lock, which guards only customer-facing amounts.)
create or replace function app.trg_recalc_invoice_from_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_expense_rollup on public.order_expenses;
create trigger trg_expense_rollup after insert or update or delete on public.order_expenses
  for each row execute function app.trg_recalc_invoice_from_expense();
