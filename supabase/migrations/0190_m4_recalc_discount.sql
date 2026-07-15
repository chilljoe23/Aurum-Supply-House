-- ============================================================================
-- Aurum Supply House · 0190 · M4 · Deterministic money math (with discount)
-- ----------------------------------------------------------------------------
-- ADDITIVE: replaces app.recalc_invoice, the immutability lock, and the header
-- recalc trigger so the order-level discount participates in the DB-side money
-- math. Discount = 0 reproduces the pre-M4 result exactly, so no historical row
-- changes value. All money is fixed-precision numeric; rounding is half-up via
-- app.money_round (never floating point).
--
--   net_sales    = subtotal - discount            (product revenue after discount)
--   tax_amount   = round(net_sales * tax_rate, 2)
--   total        = net_sales + shipping + fees + tax_amount
--   gross_profit = net_sales - total_true_cost    (customer shipping/fees excluded)
--   gross_margin = gross_profit / net_sales
--   net_profit   = gross_profit - commission - order_expenses
-- Customer-paid shipping is revenue (invoices.shipping); company-paid freight is
-- an internal order_expense — the two never cross.
-- ============================================================================

create or replace function app.recalc_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric(14,4);
  v_cost numeric(14,4);
  v_comm numeric(14,4);
  v_exp  numeric(14,4);
  v_tax_rate numeric(9,6);
  v_shipping numeric(14,4);
  v_fees numeric(14,4);
  v_discount numeric(14,4);
  v_net_sales numeric(14,4);
  v_tax numeric(14,4);
  v_total numeric(14,4);
  v_gp numeric(14,4);
  v_margin numeric(9,6);
begin
  select coalesce(sum(line_subtotal),0), coalesce(sum(line_true_cost),0)
    into v_sub, v_cost
    from public.invoice_items where invoice_id = p_invoice;

  select coalesce(sum(amount),0) into v_comm
    from public.commissions where invoice_id = p_invoice and status <> 'void';

  -- Internal per-order expenses (processing fee, company-paid freight, packaging,
  -- testing, referral, other). Never billed to the customer.
  select coalesce(sum(amount),0) into v_exp
    from public.order_expenses where invoice_id = p_invoice;

  select tax_rate, shipping, fees, discount
    into v_tax_rate, v_shipping, v_fees, v_discount
    from public.invoices where id = p_invoice;

  -- Discount cannot exceed product sales (clamp so net_sales/total never go negative
  -- from an over-large discount; the customer never owes a negative product line).
  v_discount  := least(coalesce(v_discount,0), v_sub);
  v_net_sales := v_sub - v_discount;

  v_tax    := app.money_round(v_net_sales * coalesce(v_tax_rate,0), 2);
  v_total  := v_net_sales + coalesce(v_shipping,0) + coalesce(v_fees,0) + v_tax;
  v_gp     := v_net_sales - v_cost;                              -- customer shipping/fees excluded
  v_margin := case when v_net_sales > 0 then round(v_gp / v_net_sales, 6) else 0 end;

  update public.invoices
     set subtotal         = v_sub,
         total_true_cost  = v_cost,
         tax_amount       = v_tax,
         total            = v_total,
         gross_profit     = v_gp,
         gross_margin     = v_margin,
         total_commission = v_comm,
         total_expenses   = v_exp,
         net_profit       = v_gp - v_comm - v_exp,
         balance_due      = v_total - amount_paid
   where id = p_invoice;
end;
$$;

-- Header recalc now also fires when the discount changes on a draft.
create or replace function app.trg_recalc_invoice_from_header()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.tax_rate is distinct from old.tax_rate
      or new.shipping is distinct from old.shipping
      or new.fees is distinct from old.fees
      or new.discount is distinct from old.discount) then
    perform app.recalc_invoice(new.id);
  end if;
  return new;
end;
$$;

-- Immutability lock now also freezes discount once the invoice leaves draft.
create or replace function app.enforce_invoice_lock()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    if old.status <> 'draft' then
      raise exception 'Invoice % is % and cannot be deleted. Void it instead.', old.invoice_number, old.status;
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    if ( new.subtotal        is distinct from old.subtotal
      or new.total           is distinct from old.total
      or new.total_true_cost is distinct from old.total_true_cost
      or new.gross_profit    is distinct from old.gross_profit
      or new.tax_rate        is distinct from old.tax_rate
      or new.tax_amount      is distinct from old.tax_amount
      or new.shipping        is distinct from old.shipping
      or new.fees            is distinct from old.fees
      or new.discount        is distinct from old.discount
      or new.client_id       is distinct from old.client_id
      or new.client_snapshot is distinct from old.client_snapshot
      or new.sales_rep_id    is distinct from old.sales_rep_id
      or new.pricing_sheet_id is distinct from old.pricing_sheet_id
      or new.issue_date      is distinct from old.issue_date
      or new.invoice_number  is distinct from old.invoice_number )
    then
      raise exception 'Invoice % is locked (status %). Financial fields cannot change.',
        old.invoice_number, old.status;
    end if;
  end if;
  return new;
end;
$$;
