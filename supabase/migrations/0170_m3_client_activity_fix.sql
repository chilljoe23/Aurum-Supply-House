-- ============================================================================
-- Aurum Supply House · 0170 · M3 · Client activity trigger fix (additive)
-- ============================================================================
-- Corrects a runtime failure in app.trg_activity_client() introduced by 0160.
--
-- Symptom: saving edits to a client raised
--   ERROR: malformed array literal: "email"
--
-- Cause: the generic-edit branch appended changed-field names with
--   v_changed := v_changed || 'email';
-- where v_changed is text[] and the right operand is an UNTYPED string literal.
-- PostgreSQL's `||` operator resolution can bind this to `anyarray || anyarray`
-- and then tries to parse the scalar 'email' as an array literal, which fails.
-- (The error names the first field that actually changed — company_name and
-- primary_contact_name were unchanged, so 'email' was the first append.)
--
-- Fix: append with array_append(v_changed, '<field>'::text), which is
-- unambiguously an array-plus-element operation and cannot be misresolved.
--
-- This migration is purely additive: it CREATE OR REPLACEs the function only.
-- Migration 0160 is left untouched (already applied); the existing
-- trg_activity_client trigger keeps pointing at the same function name, so no
-- trigger DDL is needed. No table, column, enum, or policy changes. All emitted
-- metadata (ids, statuses, changed-field names) is preserved exactly, and it
-- remains non-sensitive — never contact PII values.

create or replace function app.trg_activity_client()
returns trigger
language plpgsql
security definer set search_path = public, app
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform app.record_activity(
      'client', new.id, 'created',
      'Client '||new.company_name||' created',
      jsonb_build_object(
        'status', new.status,
        'assigned_rep_id', new.assigned_rep_id,
        'default_pricing_sheet_id', new.default_pricing_sheet_id
      ));
    return new;
  end if;

  -- UPDATE: emit the most specific event(s) that apply.
  if new.status is distinct from old.status then
    perform app.record_activity(
      'client', new.id, 'status_changed',
      'Client '||new.company_name||' → '||new.status,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_rep_id is distinct from old.assigned_rep_id then
    perform app.record_activity(
      'client', new.id, 'rep_reassigned',
      'Client '||new.company_name||' representative reassigned',
      jsonb_build_object('from', old.assigned_rep_id, 'to', new.assigned_rep_id));
  end if;

  if new.default_pricing_sheet_id is distinct from old.default_pricing_sheet_id then
    perform app.record_activity(
      'client', new.id, 'model_changed',
      'Client '||new.company_name||' pricing model changed',
      jsonb_build_object('from', old.default_pricing_sheet_id, 'to', new.default_pricing_sheet_id));
  end if;

  -- Generic field edits (no sensitive values, just which fields moved).
  -- Uses array_append with an explicit ::text element so the append cannot be
  -- misresolved as an array-array concatenation (the 0160 defect).
  if new.company_name         is distinct from old.company_name         then v_changed := array_append(v_changed, 'company_name'::text);         end if;
  if new.primary_contact_name is distinct from old.primary_contact_name then v_changed := array_append(v_changed, 'primary_contact_name'::text); end if;
  if new.email                is distinct from old.email                then v_changed := array_append(v_changed, 'email'::text);                end if;
  if new.phone                is distinct from old.phone                then v_changed := array_append(v_changed, 'phone'::text);                end if;
  if new.payment_terms        is distinct from old.payment_terms        then v_changed := array_append(v_changed, 'payment_terms'::text);        end if;
  if new.notes                is distinct from old.notes                then v_changed := array_append(v_changed, 'notes'::text);                end if;
  if new.billing_address      is distinct from old.billing_address      then v_changed := array_append(v_changed, 'billing_address'::text);      end if;
  if new.shipping_address     is distinct from old.shipping_address     then v_changed := array_append(v_changed, 'shipping_address'::text);     end if;

  if array_length(v_changed, 1) is not null then
    perform app.record_activity(
      'client', new.id, 'updated',
      'Client '||new.company_name||' updated',
      jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;

  return new;
end;
$$;

comment on function app.trg_activity_client() is
  'M3: journals client create/update/status/rep/model events into activity_log (non-sensitive metadata). 0170: scalar-append fix.';
