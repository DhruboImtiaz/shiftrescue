-- Apply to an existing ShiftRescue database before deploying the event lifecycle API.
-- No event or schedule data is removed.
alter table public.shiftrescue_events add column if not exists deleted_at timestamptz;
create index if not exists shiftrescue_events_active_owner_updated_idx on public.shiftrescue_events(owner_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists shiftrescue_events_trash_owner_updated_idx on public.shiftrescue_events(owner_id, updated_at desc, id desc) where deleted_at is not null;

create or replace function public.shiftrescue_load_event(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'version', e.version, 'updatedAt', e.updated_at,
    'state', jsonb_build_object(
      'event', e.name, 'date', e.event_date, 'timezone', e.timezone,
      'volunteers', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'skills', v.skills, 'availability', v.availability, 'maxHours', v.max_hours, 'color', v.color) order by v.position) from public.shiftrescue_volunteers v where v.event_id = e.id), '[]'::jsonb),
      'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'station', s.station, 'start', s.start_min, 'end', s.end_min, 'required', s.required, 'skills', s.skills) order by s.position) from public.shiftrescue_shifts s where s.event_id = e.id), '[]'::jsonb),
      'schedule', coalesce((select jsonb_object_agg(s.id, coalesce((select jsonb_agg(a.volunteer_id order by a.position) from public.shiftrescue_assignments a where a.event_id = e.id and a.shift_id = s.id), '[]'::jsonb)) from public.shiftrescue_shifts s where s.event_id = e.id), '{}'::jsonb),
      'history', coalesce((select jsonb_agg(h.entry order by h.created_at desc) from (select a.created_at, jsonb_build_object('at', a.created_at, 'title', a.title, 'text', a.description, 'source', a.source, 'kind', a.kind, 'differences', a.differences) as entry from public.shiftrescue_activity a where a.event_id = e.id order by a.created_at desc limit 50) h), '[]'::jsonb)
    )
  ) from public.shiftrescue_events e where e.id = p_event_id and e.deleted_at is null;
$$;

-- Row locking via version-checked UPDATE prevents stale tabs overwriting new work.
-- Everything below succeeds or rolls back together; no half-written event is visible.
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
  if jsonb_array_length(p_state->'volunteers') not between 0 and 12 or jsonb_array_length(p_state->'shifts') not between 0 and 8 or octet_length(p_state::text) > 120000 then
    raise exception 'Event exceeds prototype limits.' using errcode = '22023';
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


-- Recoverable deletion keeps the team and schedule intact. The row lock and
-- version increment also invalidate previews made before deletion/restoration.
create or replace function public.shiftrescue_set_event_deleted(p_event_id uuid, p_expected_version bigint, p_deleted boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_event public.shiftrescue_events%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to manage events.' using errcode = '28000'; end if;
  if p_deleted is null then raise exception 'Choose delete or restore.' using errcode = '22023'; end if;
  select e.* into v_event from public.shiftrescue_events e
  where e.id = p_event_id and e.owner_id = auth.uid() for update;
  if not found then raise exception 'That event is not available to your account.' using errcode = 'PT404'; end if;
  if v_event.version is distinct from p_expected_version then raise exception 'The event changed. Refresh before deleting or restoring it.' using errcode = 'PT409'; end if;
  if (v_event.deleted_at is not null) = p_deleted then
    return jsonb_build_object('id', v_event.id, 'version', v_event.version, 'deletedAt', v_event.deleted_at);
  end if;
  update public.shiftrescue_events e
  set deleted_at = case when p_deleted then now() else null end, version = e.version + 1, updated_at = now()
  where e.id = v_event.id returning e.* into v_event;
  return jsonb_build_object('id', v_event.id, 'version', v_event.version, 'deletedAt', v_event.deleted_at);
end;
$$;
revoke all on function public.shiftrescue_set_event_deleted(uuid, bigint, boolean) from public, anon;
grant execute on function public.shiftrescue_set_event_deleted(uuid, bigint, boolean) to authenticated;
