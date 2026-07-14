-- ============================================================================
-- Aurum Supply House · 0160 · M3 · Client activity logging (additive)
-- ============================================================================
-- Purely additive. Adds a trigger that journals client lifecycle events into the
-- existing public.activity_log via app.record_activity (0075). No table, column,
-- enum, or policy changes — migrations 0001–0150 are untouched.
--
-- Captured events (entity_type = 'client'):
--   created          — a client row is inserted
--   status_changed   — status active/inactive/prospect transition
--   rep_reassigned   — assigned_rep_id changed
--   model_changed    — default_pricing_sheet_id changed
--   updated          — any other tracked field changed (name/contact/terms/notes/addresses)
-- Metadata is deliberately non-sensitive (ids, statuses, changed-field names) —
-- never contact PII values.

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
  if new.company_name         is distinct from old.company_name         then v_changed := v_changed || 'company_name'; end if;
  if new.primary_contact_name is distinct from old.primary_contact_name then v_changed := v_changed || 'primary_contact_name'; end if;
  if new.email                is distinct from old.email                then v_changed := v_changed || 'email'; end if;
  if new.phone                is distinct from old.phone                then v_changed := v_changed || 'phone'; end if;
  if new.payment_terms        is distinct from old.payment_terms        then v_changed := v_changed || 'payment_terms'; end if;
  if new.notes                is distinct from old.notes                then v_changed := v_changed || 'notes'; end if;
  if new.billing_address      is distinct from old.billing_address      then v_changed := v_changed || 'billing_address'; end if;
  if new.shipping_address     is distinct from old.shipping_address     then v_changed := v_changed || 'shipping_address'; end if;

  if array_length(v_changed, 1) is not null then
    perform app.record_activity(
      'client', new.id, 'updated',
      'Client '||new.company_name||' updated',
      jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_activity_client on public.clients;
create trigger trg_activity_client
  after insert or update on public.clients
  for each row execute function app.trg_activity_client();

comment on function app.trg_activity_client() is
  'M3: journals client create/update/status/rep/model events into activity_log (non-sensitive metadata).';
