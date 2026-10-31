-- ShiftRescue: owner-isolated events and atomic, versioned schedule saves.
create table public.shiftrescue_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  event_date date not null,
  timezone text not null default 'Asia/Dhaka' check (timezone = 'Asia/Dhaka'),
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shiftrescue_events_active_owner_updated_idx on public.shiftrescue_events(owner_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists shiftrescue_events_trash_owner_updated_idx on public.shiftrescue_events(owner_id, updated_at desc, id desc) where deleted_at is not null;

create table public.shiftrescue_volunteers (
  event_id uuid not null references public.shiftrescue_events(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  skills text[] not null,
  availability jsonb not null check (jsonb_typeof(availability) = 'array'),
  max_hours numeric(5,2) not null check (max_hours between 0 and 24),
  color text,
  position integer not null check (position between 0 and 79),
  primary key (event_id, id)
);
create table public.shiftrescue_shifts (
  event_id uuid not null references public.shiftrescue_events(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9-]{1,40}$'),
  station text not null check (char_length(station) between 1 and 80),
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440 and end_min > start_min),
  required integer not null check (required between 1 and 8),
  skills text[] not null,
  position integer not null check (position between 0 and 23),
  primary key (event_id, id)
);
create table public.shiftrescue_assignments (
  event_id uuid not null,
  shift_id text not null,
  volunteer_id text not null,
  position integer not null check (position between 0 and 7),
  primary key (event_id, shift_id, volunteer_id),
  foreign key (event_id, shift_id) references public.shiftrescue_shifts(event_id, id) on delete cascade,
  foreign key (event_id, volunteer_id) references public.shiftrescue_volunteers(event_id, id) on delete cascade
);
create index shiftrescue_assignments_volunteer_idx on public.shiftrescue_assignments(event_id, volunteer_id);
create table public.shiftrescue_activity (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.shiftrescue_events(id) on delete cascade,
  version bigint not null,
  kind text not null check (kind in ('repair', 'reset', 'setup')),
  title text not null check (char_length(title) <= 250),
  description text not null check (char_length(description) <= 3500),
  source text not null check (source in ('gemma', 'scenario', 'team', 'system')),
  differences jsonb not null default '[]'::jsonb check (jsonb_typeof(differences) = 'array'),
  created_at timestamptz not null default now()
);
create index shiftrescue_activity_event_created_idx on public.shiftrescue_activity(event_id, created_at desc);

alter table public.shiftrescue_events enable row level security;
alter table public.shiftrescue_volunteers enable row level security;
alter table public.shiftrescue_shifts enable row level security;
alter table public.shiftrescue_assignments enable row level security;
alter table public.shiftrescue_activity enable row level security;

create policy shiftrescue_event_owner on public.shiftrescue_events for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy shiftrescue_volunteer_owner on public.shiftrescue_volunteers for all to authenticated
using (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())))
with check (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy shiftrescue_shift_owner on public.shiftrescue_shifts for all to authenticated
using (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())))
with check (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy shiftrescue_assignment_owner on public.shiftrescue_assignments for all to authenticated
using (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())))
with check (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())));
create policy shiftrescue_activity_owner on public.shiftrescue_activity for all to authenticated
using (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())))
with check (exists (select 1 from public.shiftrescue_events e where e.id = event_id and e.owner_id = (select auth.uid())));

revoke all on public.shiftrescue_events, public.shiftrescue_volunteers, public.shiftrescue_shifts, public.shiftrescue_assignments, public.shiftrescue_activity from anon;
grant select, insert, update, delete on public.shiftrescue_events, public.shiftrescue_volunteers, public.shiftrescue_shifts, public.shiftrescue_assignments, public.shiftrescue_activity to authenticated;

-- A single SQL statement reads a consistent snapshot across all related tables.
create function public.shiftrescue_load_event(p_event_id uuid)
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
create function public.shiftrescue_save_event(p_event_id uuid, p_expected_version bigint, p_state jsonb, p_activity jsonb default null)
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

revoke all on function public.shiftrescue_load_event(uuid) from public, anon;
revoke all on function public.shiftrescue_save_event(uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.shiftrescue_load_event(uuid) to authenticated;
grant execute on function public.shiftrescue_save_event(uuid, bigint, jsonb, jsonb) to authenticated;

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
-- Private account profiles. Email remains authoritative in Supabase Auth.
create table public.shiftrescue_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  username text unique check (username ~ '^[a-z0-9][a-z0-9._]{2,29}$'),
  phone text not null default '' check (phone = '' or phone ~ '^\+?[0-9]{7,15}$'),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_path text check (avatar_path is null or (split_part(avatar_path, '/', 1) = id::text and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shiftrescue_profiles enable row level security;
create policy shiftrescue_profile_read on public.shiftrescue_profiles for select to authenticated
  using ((select auth.uid()) = id and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy shiftrescue_profile_update on public.shiftrescue_profiles for update to authenticated
  using ((select auth.uid()) = id and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false')
  with check ((select auth.uid()) = id and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
revoke all on public.shiftrescue_profiles from public, anon, authenticated;
grant select on public.shiftrescue_profiles to authenticated;
grant update (name, username, phone, bio, avatar_path) on public.shiftrescue_profiles to authenticated;

-- Auth creates rows even when signup requires email confirmation. Existing
-- accounts start with an empty profile and can complete it in My account.
create schema if not exists shiftrescue_private;
revoke all on schema shiftrescue_private from public, anon, authenticated;
create function shiftrescue_private.create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(new.raw_user_meta_data->>'username'));
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '[\s().-]', '', 'g');
begin
  if (select auth.uid()) is not null and (select auth.uid()) <> new.id then
    raise exception 'Cannot create another user profile.' using errcode = '42501';
  end if;
  insert into public.shiftrescue_profiles (id, name, username, phone)
  values (new.id, left(btrim(coalesce(new.raw_user_meta_data->>'name', '')), 80),
    case when v_username ~ '^[a-z0-9][a-z0-9._]{2,29}$' then v_username else null end,
    case when v_phone ~ '^\+?[0-9]{7,15}$' then v_phone else '' end);
  return new;
end;
$$;
revoke all on function shiftrescue_private.create_profile() from public, anon, authenticated;
create trigger shiftrescue_profile_on_signup after insert on auth.users
  for each row execute function shiftrescue_private.create_profile();
insert into public.shiftrescue_profiles(id) select id from auth.users on conflict (id) do nothing;

create function shiftrescue_private.touch_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function shiftrescue_private.touch_profile() from public, anon, authenticated;
create trigger shiftrescue_profile_on_update before update on public.shiftrescue_profiles
  for each row execute function shiftrescue_private.touch_profile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shiftrescue-avatars', 'shiftrescue-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);
-- Unique filenames avoid stale image caches and require no overwrite permission.
create policy shiftrescue_avatar_read on storage.objects for select to authenticated
  using (bucket_id = 'shiftrescue-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy shiftrescue_avatar_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shiftrescue-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy shiftrescue_avatar_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shiftrescue-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
