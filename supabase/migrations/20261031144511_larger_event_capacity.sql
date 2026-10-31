-- Expand event capacity without changing ownership or existing saved data.
alter table public.shiftrescue_volunteers drop constraint shiftrescue_volunteers_position_check;
alter table public.shiftrescue_volunteers add constraint shiftrescue_volunteers_position_check check (position between 0 and 79);
alter table public.shiftrescue_shifts drop constraint shiftrescue_shifts_position_check;
alter table public.shiftrescue_shifts add constraint shiftrescue_shifts_position_check check (position between 0 and 23);
alter table public.shiftrescue_shifts drop constraint shiftrescue_shifts_required_check;
alter table public.shiftrescue_shifts add constraint shiftrescue_shifts_required_check check (required between 1 and 8);
alter table public.shiftrescue_assignments drop constraint shiftrescue_assignments_position_check;
alter table public.shiftrescue_assignments add constraint shiftrescue_assignments_position_check check (position between 0 and 7);

create or replace function public.shiftrescue_save_event(p_event_id uuid, p_expected_version bigint, p_state jsonb, p_activity jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_event_id uuid;
  v_next_version bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to save an event.' using errcode = '28000'; end if;
  if jsonb_typeof(p_state->'volunteers') is distinct from 'array' or jsonb_typeof(p_state->'shifts') is distinct from 'array' or jsonb_typeof(p_state->'schedule') is distinct from 'object' then
    raise exception 'Invalid event data.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_state->'volunteers') not between 0 and 80 or jsonb_array_length(p_state->'shifts') not between 0 and 24 or octet_length(p_state::text) > 524288 then
    raise exception 'Event exceeds the 80-volunteer, 24-shift or data-size limits.' using errcode = '22023';
  end if;
  if p_event_id is null then
    insert into public.shiftrescue_events(owner_id, name, event_date, timezone)
    values (auth.uid(), p_state->>'event', (p_state->>'date')::date, p_state->>'timezone')
    returning id, version into v_event_id, v_next_version;
  else
    update public.shiftrescue_events e set name = p_state->>'event', event_date = (p_state->>'date')::date, timezone = p_state->>'timezone', version = e.version + 1, updated_at = now()
    where e.id = p_event_id and e.owner_id = auth.uid() and e.version = p_expected_version and e.deleted_at is null
    returning e.id, e.version into v_event_id, v_next_version;
    if v_event_id is null then raise exception 'This event changed in another tab or is no longer available. Reload it before applying a repair.' using errcode = 'PT409'; end if;
  end if;
  delete from public.shiftrescue_assignments a where a.event_id = v_event_id;
  delete from public.shiftrescue_shifts s where s.event_id = v_event_id;
  delete from public.shiftrescue_volunteers v where v.event_id = v_event_id;
  insert into public.shiftrescue_volunteers(event_id, id, name, skills, availability, max_hours, color, position)
  select v_event_id, v.item->>'id', v.item->>'name', array(select jsonb_array_elements_text(v.item->'skills')), v.item->'availability', (v.item->>'maxHours')::numeric, v.item->>'color', v.position - 1
  from jsonb_array_elements(p_state->'volunteers') with ordinality as v(item, position);
  insert into public.shiftrescue_shifts(event_id, id, station, start_min, end_min, required, skills, position)
  select v_event_id, s.item->>'id', s.item->>'station', (s.item->>'start')::integer, (s.item->>'end')::integer, (s.item->>'required')::integer, array(select jsonb_array_elements_text(s.item->'skills')), s.position - 1
  from jsonb_array_elements(p_state->'shifts') with ordinality as s(item, position);
  insert into public.shiftrescue_assignments(event_id, shift_id, volunteer_id, position)
  select v_event_id, s.key, a.item #>> '{}', a.position - 1
  from jsonb_each(p_state->'schedule') s cross join lateral jsonb_array_elements(s.value) with ordinality as a(item, position);
  if p_activity is not null then
    insert into public.shiftrescue_activity(event_id, version, kind, title, description, source, differences)
    values (v_event_id, v_next_version, p_activity->>'kind', p_activity->>'title', p_activity->>'text', p_activity->>'source', coalesce(p_activity->'differences', '[]'::jsonb));
  end if;
  return public.shiftrescue_load_event(v_event_id);
end;
$$;
