-- ShiftRescue: private/shared events and atomic, versioned schedule saves.
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

-- Event collaboration: keep this section aligned with the event_collaboration migration.
-- Membership and join codes are deliberately outside the exposed Data API.
create table shiftrescue_private.event_members (
  event_id uuid not null references public.shiftrescue_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_members_user_idx on shiftrescue_private.event_members(user_id, event_id);
create table shiftrescue_private.access_requests (
  event_id uuid not null references public.shiftrescue_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_role text not null check (requested_role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  granted_role text check (granted_role in ('viewer', 'editor')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index access_requests_user_idx on shiftrescue_private.access_requests(user_id, updated_at desc);
create table shiftrescue_private.event_codes (
  event_id uuid primary key references public.shiftrescue_events(id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
);
create table shiftrescue_private.join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table shiftrescue_private.event_members enable row level security;
alter table shiftrescue_private.access_requests enable row level security;
alter table shiftrescue_private.event_codes enable row level security;
alter table shiftrescue_private.join_attempts enable row level security;
revoke all on all tables in schema shiftrescue_private from public, anon, authenticated;
grant usage on schema shiftrescue_private to authenticated;

-- This narrowly scoped definer lookup avoids recursive policies on memberships
-- and events. Authorization always uses the verified JWT subject, never metadata.
create function shiftrescue_private.event_role(p_event_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when e.owner_id = (select auth.uid()) then 'owner'
    when e.deleted_at is null then m.role end
  from public.shiftrescue_events e
  left join shiftrescue_private.event_members m on m.event_id = e.id and m.user_id = (select auth.uid())
  where e.id = p_event_id and (select auth.uid()) is not null
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false';
$$;
revoke all on function shiftrescue_private.event_role(uuid) from public, anon;
grant execute on function shiftrescue_private.event_role(uuid) to authenticated;

create function shiftrescue_private.create_event_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() <> new.owner_id then
    raise exception 'Cannot create another owner’s event code.' using errcode = '42501';
  end if;
  insert into shiftrescue_private.event_codes(event_id) values (new.id);
  return new;
end;
$$;
revoke all on function shiftrescue_private.create_event_code() from public, anon, authenticated;
create trigger shiftrescue_event_code after insert on public.shiftrescue_events
  for each row execute function shiftrescue_private.create_event_code();
insert into shiftrescue_private.event_codes(event_id) select id from public.shiftrescue_events;

drop policy shiftrescue_event_owner on public.shiftrescue_events;
create policy shiftrescue_event_read on public.shiftrescue_events for select to authenticated
  using ((owner_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false') or shiftrescue_private.event_role(id) is not null);
create policy shiftrescue_event_create on public.shiftrescue_events for insert to authenticated
  with check (owner_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false');
create policy shiftrescue_event_edit on public.shiftrescue_events for update to authenticated
  using (shiftrescue_private.event_role(id) in ('owner', 'editor'))
  with check (shiftrescue_private.event_role(id) in ('owner', 'editor'));
create policy shiftrescue_event_delete on public.shiftrescue_events for delete to authenticated
  using (shiftrescue_private.event_role(id) = 'owner');

create function shiftrescue_private.guard_event_owner()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'Event ownership cannot be changed.' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at and auth.uid() is distinct from old.owner_id then
    raise exception 'Only the owner can delete or restore an event.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function shiftrescue_private.guard_event_owner() from public, anon, authenticated;
create trigger shiftrescue_guard_owner before update on public.shiftrescue_events
  for each row execute function shiftrescue_private.guard_event_owner();

do $$
declare t text; old_policy text;
begin
  foreach t in array array['volunteers', 'shifts', 'assignments', 'activity'] loop
    old_policy := case t when 'volunteers' then 'volunteer' when 'shifts' then 'shift' when 'assignments' then 'assignment' else 'activity' end;
    execute format('drop policy %I on public.%I', 'shiftrescue_' || old_policy || '_owner', 'shiftrescue_' || t);
    execute format('create policy %I on public.%I for select to authenticated using (shiftrescue_private.event_role(event_id) is not null)', 'shiftrescue_' || t || '_read', 'shiftrescue_' || t);
    execute format('create policy %I on public.%I for insert to authenticated with check (shiftrescue_private.event_role(event_id) in (''owner'', ''editor''))', 'shiftrescue_' || t || '_insert', 'shiftrescue_' || t);
    if t <> 'activity' then
      execute format('create policy %I on public.%I for update to authenticated using (shiftrescue_private.event_role(event_id) in (''owner'', ''editor'')) with check (shiftrescue_private.event_role(event_id) in (''owner'', ''editor''))', 'shiftrescue_' || t || '_update', 'shiftrescue_' || t);
      execute format('create policy %I on public.%I for delete to authenticated using (shiftrescue_private.event_role(event_id) in (''owner'', ''editor''))', 'shiftrescue_' || t || '_delete', 'shiftrescue_' || t);
    end if;
  end loop;
end;
$$;
revoke update, delete on public.shiftrescue_activity from authenticated;
alter table public.shiftrescue_activity add column actor_id uuid references auth.users(id) on delete set null;
alter table public.shiftrescue_activity add column actor_name text;
create index shiftrescue_activity_actor_idx on public.shiftrescue_activity(actor_id);
create function shiftrescue_private.record_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.actor_id := auth.uid();
  select coalesce(nullif(p.name, ''), p.username, 'Coordinator') into new.actor_name
    from public.shiftrescue_profiles p where p.id = auth.uid();
  return new;
end;
$$;
revoke all on function shiftrescue_private.record_actor() from public, anon, authenticated;
create trigger shiftrescue_record_actor before insert on public.shiftrescue_activity
  for each row execute function shiftrescue_private.record_actor();

-- Only these small sharing operations need privileged cross-user lookups.
-- Every owner action locks the event, so permission changes and saves serialize.
create function shiftrescue_private.collaboration(p_action text, p_event_id uuid default null, p_user_id uuid default null, p_role text default null, p_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  eid uuid;
  event_owner uuid;
  access_role text;
  previous_request shiftrescue_private.access_requests%rowtype;
  attempt_count integer;
  next_version bigint;
  result jsonb;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Sign in to manage shared events.' using errcode = '28000';
  end if;
  if p_action = 'requests' then
    return coalesce((select jsonb_agg(jsonb_build_object('eventId', r.event_id, 'event', e.name, 'requestedRole', r.requested_role, 'status', r.status, 'grantedRole', r.granted_role, 'updatedAt', r.updated_at, 'role', shiftrescue_private.event_role(e.id)) order by r.updated_at desc)
      from shiftrescue_private.access_requests r join public.shiftrescue_events e on e.id = r.event_id
      where r.user_id = uid and e.deleted_at is null), '[]'::jsonb);
  end if;
  if p_action = 'join' then
    if p_role is null or p_role not in ('viewer', 'editor') then raise exception 'Choose view or edit access.' using errcode = '22023'; end if;
    if p_code is null or char_length(p_code) > 40 then raise exception 'Enter the event code.' using errcode = '22023'; end if;
    insert into shiftrescue_private.join_attempts(user_id) values (uid)
    on conflict (user_id) do update set
      attempts = case when join_attempts.window_start < now() - interval '1 minute' then 1 else join_attempts.attempts + 1 end,
      window_start = case when join_attempts.window_start < now() - interval '1 minute' then now() else join_attempts.window_start end
    returning attempts into attempt_count;
    -- Return errors after rate accounting so invalid guesses cannot roll it back.
    if attempt_count > 20 then return jsonb_build_object('error', 'Too many code attempts. Try again in a minute.', 'status', 429); end if;
    p_code := upper(regexp_replace(p_code, '[\s-]', '', 'g'));
    select e.id, e.owner_id into eid, event_owner from public.shiftrescue_events e
      join shiftrescue_private.event_codes c on c.event_id = e.id
      where c.code = p_code and e.deleted_at is null for update of e;
    if eid is null or not exists (select 1 from shiftrescue_private.event_codes c where c.event_id = eid and c.code = p_code) then
      return jsonb_build_object('error', 'No event found for that code. Check it with the owner.', 'status', 404);
    end if;
    access_role := shiftrescue_private.event_role(eid);
    if access_role in ('owner', 'editor') or (access_role = 'viewer' and p_role = 'viewer') then
      return jsonb_build_object('message', 'You already have access to this event.', 'eventId', eid, 'role', access_role);
    end if;
    select * into previous_request from shiftrescue_private.access_requests r where r.event_id = eid and r.user_id = uid;
    if previous_request.status in ('rejected', 'revoked') and previous_request.updated_at > now() - interval '1 minute' then
      return jsonb_build_object('error', 'Please wait a minute before requesting access again.', 'status', 429);
    end if;
    if (select count(*) from shiftrescue_private.access_requests r where r.event_id = eid and r.status = 'pending') >= 500 and previous_request.status is distinct from 'pending' then
      return jsonb_build_object('error', 'This event has too many pending requests. Ask the owner to review them first.', 'status', 429);
    end if;
    insert into shiftrescue_private.access_requests(event_id, user_id, requested_role) values (eid, uid, p_role)
    on conflict (event_id, user_id) do update set requested_role = excluded.requested_role, status = 'pending', granted_role = null, updated_at = now();
    return jsonb_build_object('message', 'Request sent. The owner will review your profile and access request.', 'eventId', eid, 'status', 'pending');
  end if;
  select e.id, e.owner_id into eid, event_owner from public.shiftrescue_events e
    where e.id = p_event_id and e.owner_id = uid and e.deleted_at is null for update;
  if eid is null then raise exception 'Only the event owner can manage sharing.' using errcode = '42501'; end if;
  if p_action = 'avatar' then
    if not exists (select 1 from shiftrescue_private.access_requests r where r.event_id = eid and r.user_id = p_user_id and r.status = 'pending')
      and not exists (select 1 from shiftrescue_private.event_members m where m.event_id = eid and m.user_id = p_user_id) then
      raise exception 'That profile is not available for this event.' using errcode = 'PT404';
    end if;
    return (select jsonb_build_object('avatarPath', p.avatar_path) from public.shiftrescue_profiles p where p.id = p_user_id);
  elsif p_action = 'rotate' then
    update shiftrescue_private.event_codes set code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) where event_id = eid;
  elsif p_action = 'decision' then
    if p_user_id is null or p_user_id = uid or p_role is null or p_role not in ('viewer', 'editor', 'reject', 'remove') then
      raise exception 'Choose a valid person and access decision.' using errcode = '22023';
    end if;
    select * into previous_request from shiftrescue_private.access_requests r where r.event_id = eid and r.user_id = p_user_id;
    if p_role = 'reject' then
      if previous_request.status is distinct from 'pending' then raise exception 'This request has already been handled. Refresh sharing.' using errcode = 'PT409'; end if;
      update shiftrescue_private.access_requests set status = 'rejected', granted_role = null, updated_at = now() where event_id = eid and user_id = p_user_id;
    elsif p_role = 'remove' then
      delete from shiftrescue_private.event_members where event_id = eid and user_id = p_user_id;
      if not found then raise exception 'This person no longer has access.' using errcode = 'PT409'; end if;
      update shiftrescue_private.access_requests set status = 'revoked', granted_role = null, updated_at = now() where event_id = eid and user_id = p_user_id;
    else
      if previous_request.status is distinct from 'pending' and not exists (select 1 from shiftrescue_private.event_members m where m.event_id = eid and m.user_id = p_user_id) then
        raise exception 'A pending request is required before granting access.' using errcode = 'PT409';
      end if;
      insert into shiftrescue_private.event_members(event_id, user_id, role) values (eid, p_user_id, p_role)
      on conflict (event_id, user_id) do update set role = excluded.role;
      update shiftrescue_private.access_requests set status = 'approved', granted_role = p_role, updated_at = now() where event_id = eid and user_id = p_user_id;
    end if;
  elsif p_action <> 'sharing' then
    raise exception 'Unknown sharing action.' using errcode = '22023';
  end if;
  if p_action in ('rotate', 'decision') then
    update public.shiftrescue_events set version = version + 1, updated_at = now() where id = eid returning version into next_version;
    insert into public.shiftrescue_activity(event_id, version, kind, title, description, source)
    values (eid, next_version, 'setup', 'Event sharing updated', case when p_action = 'rotate' then 'The owner reset the event code.' else 'The owner reviewed an access request or changed a member’s permissions.' end, 'system');
  end if;
  select jsonb_build_object('eventId', eid, 'code', c.code,
    'requests', coalesce((select jsonb_agg(jsonb_build_object('userId', r.user_id, 'requestedRole', r.requested_role, 'updatedAt', r.updated_at, 'name', p.name, 'username', p.username, 'bio', p.bio, 'hasAvatar', p.avatar_path is not null, 'profileUpdatedAt', p.updated_at) order by r.updated_at)
      from shiftrescue_private.access_requests r join public.shiftrescue_profiles p on p.id = r.user_id where r.event_id = eid and r.status = 'pending'), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role, 'name', p.name, 'username', p.username, 'bio', p.bio, 'hasAvatar', p.avatar_path is not null, 'profileUpdatedAt', p.updated_at) order by m.created_at)
      from shiftrescue_private.event_members m join public.shiftrescue_profiles p on p.id = m.user_id where m.event_id = eid), '[]'::jsonb)) into result
  from shiftrescue_private.event_codes c where c.event_id = eid;
  return result;
end;
$$;
revoke all on function shiftrescue_private.collaboration(text, uuid, uuid, text, text) from public, anon;
grant execute on function shiftrescue_private.collaboration(text, uuid, uuid, text, text) to authenticated;

create function public.shiftrescue_request_access(p_code text, p_role text)
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('join', p_code => p_code, p_role => p_role); $$;
create function public.shiftrescue_my_requests()
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('requests'); $$;
create function public.shiftrescue_event_sharing(p_event_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('sharing', p_event_id); $$;
create function public.shiftrescue_decide_access(p_event_id uuid, p_user_id uuid, p_decision text)
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('decision', p_event_id, p_user_id, p_decision); $$;
create function public.shiftrescue_rotate_event_code(p_event_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('rotate', p_event_id); $$;
create function public.shiftrescue_requester_avatar(p_event_id uuid, p_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select shiftrescue_private.collaboration('avatar', p_event_id, p_user_id); $$;
revoke all on function public.shiftrescue_request_access(text, text), public.shiftrescue_my_requests(), public.shiftrescue_event_sharing(uuid), public.shiftrescue_decide_access(uuid, uuid, text), public.shiftrescue_rotate_event_code(uuid), public.shiftrescue_requester_avatar(uuid, uuid) from public, anon;
grant execute on function public.shiftrescue_request_access(text, text), public.shiftrescue_my_requests(), public.shiftrescue_event_sharing(uuid), public.shiftrescue_decide_access(uuid, uuid, text), public.shiftrescue_rotate_event_code(uuid), public.shiftrescue_requester_avatar(uuid, uuid) to authenticated;

create function shiftrescue_private.can_read_shared_avatar(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'false' and exists (
    select 1 from public.shiftrescue_profiles p join public.shiftrescue_events e on e.owner_id = (select auth.uid()) and e.deleted_at is null
    where p.avatar_path = p_path and (
      exists (select 1 from shiftrescue_private.event_members m where m.event_id = e.id and m.user_id = p.id)
      or exists (select 1 from shiftrescue_private.access_requests r where r.event_id = e.id and r.user_id = p.id and r.status = 'pending')));
$$;
revoke all on function shiftrescue_private.can_read_shared_avatar(text) from public, anon;
grant execute on function shiftrescue_private.can_read_shared_avatar(text) to authenticated;
create policy shiftrescue_requester_avatar_read on storage.objects for select to authenticated
  using (bucket_id = 'shiftrescue-avatars' and shiftrescue_private.can_read_shared_avatar(name));

create function shiftrescue_private.event_status(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'version', e.version, 'role', shiftrescue_private.event_role(e.id),
    'pendingRequests', case when e.owner_id = (select auth.uid()) then
      (select count(*) from shiftrescue_private.access_requests r where r.event_id = e.id and r.status = 'pending') else 0 end)
  from public.shiftrescue_events e where e.id = p_event_id and e.deleted_at is null
    and shiftrescue_private.event_role(e.id) is not null;
$$;
revoke all on function shiftrescue_private.event_status(uuid) from public, anon;
grant execute on function shiftrescue_private.event_status(uuid) to authenticated;
create function public.shiftrescue_event_status(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select shiftrescue_private.event_status(p_event_id); $$;
revoke all on function public.shiftrescue_event_status(uuid) from public, anon;
grant execute on function public.shiftrescue_event_status(uuid) to authenticated;

create or replace function public.shiftrescue_load_event(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'role', shiftrescue_private.event_role(e.id), 'id', e.id, 'version', e.version, 'updatedAt', e.updated_at,
    'state', jsonb_build_object(
      'event', e.name, 'date', e.event_date, 'timezone', e.timezone,
      'volunteers', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'skills', v.skills, 'availability', v.availability, 'maxHours', v.max_hours, 'color', v.color) order by v.position) from public.shiftrescue_volunteers v where v.event_id = e.id), '[]'::jsonb),
      'shifts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'station', s.station, 'start', s.start_min, 'end', s.end_min, 'required', s.required, 'skills', s.skills) order by s.position) from public.shiftrescue_shifts s where s.event_id = e.id), '[]'::jsonb),
      'schedule', coalesce((select jsonb_object_agg(s.id, coalesce((select jsonb_agg(a.volunteer_id order by a.position) from public.shiftrescue_assignments a where a.event_id = e.id and a.shift_id = s.id), '[]'::jsonb)) from public.shiftrescue_shifts s where s.event_id = e.id), '{}'::jsonb),
      'history', coalesce((select jsonb_agg(h.entry order by h.version desc, h.created_at desc, h.id desc) from (select a.id, a.version, a.created_at, jsonb_build_object('actor', a.actor_name, 'actorId', a.actor_id, 'at', a.created_at, 'title', a.title, 'text', a.description, 'source', a.source, 'kind', a.kind, 'differences', a.differences) as entry from public.shiftrescue_activity a where a.event_id = e.id order by a.version desc, a.created_at desc, a.id desc limit 50) h), '[]'::jsonb)
    )
  ) from public.shiftrescue_events e where e.id = p_event_id and e.deleted_at is null;
$$;

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
    if coalesce(shiftrescue_private.event_role(p_event_id), '') not in ('owner', 'editor') then raise exception 'Edit access is required to change this event.' using errcode = '42501'; end if;
    update public.shiftrescue_events e set name = p_state->>'event', event_date = (p_state->>'date')::date, timezone = p_state->>'timezone', version = e.version + 1, updated_at = now()
    where e.id = p_event_id and shiftrescue_private.event_role(e.id) in ('owner', 'editor') and e.version = p_expected_version and e.deleted_at is null
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
