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
