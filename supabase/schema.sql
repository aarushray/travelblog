-- memora: Supabase setup. Safe to run more than once, and on a project that
-- already ran an earlier version of this file.
-- Paste this whole file into Supabase → SQL Editor → New query, then Run.
--
-- Access model:
--   • Anyone (no account) can VIEW trips, memories and photos.
--   • Anyone can create an account, but it starts as "pending".
--   • The admin (aarushray210207@gmail.com, once that email is confirmed)
--     approves or declines accounts, and can edit everything.
--   • Approved members can add trips and edit / delete their own.

-- ---------- Members ----------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- Every new account gets a pending profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for accounts that existed before this ran.
insert into public.profiles (id, email, created_at)
select id, email, created_at from auth.users
on conflict (id) do nothing;

-- ---------- Roles ----------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'aarushray210207@gmail.com'
      and email_confirmed_at is not null
  );
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

grant execute on function public.is_admin()  to anon, authenticated;
grant execute on function public.is_member() to anon, authenticated;

alter table public.profiles enable row level security;

drop policy if exists "See own profile, admin sees all" on public.profiles;
drop policy if exists "Admin decides on accounts"       on public.profiles;

create policy "See own profile, admin sees all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "Admin decides on accounts" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Trips & memories ----------

create table if not exists public.trips (
  id          bigint generated always as identity primary key,
  title       text not null,
  start_date  date,
  end_date    date,
  date_text   text,               -- free-text date from trips made before dates existed
  description text,
  tags        text[] not null default '{}',
  cover_path  text,               -- path inside the "photos" bucket
  created_at  timestamptz not null default now()
);

-- Who added the trip (trips from before accounts existed have none; the admin manages those).
alter table public.trips add column if not exists owner uuid default auth.uid() references auth.users (id) on delete set null;

create table if not exists public.memories (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null references public.trips (id) on delete cascade,
  title       text not null,
  note        text,
  photo_path  text,               -- path inside the "photos" bucket
  created_at  timestamptz not null default now()
);

create index if not exists memories_trip_id_idx on public.memories (trip_id);

create or replace function public.can_edit_trip(trip bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_member() and exists (select 1 from public.trips where id = trip and owner = auth.uid()));
$$;

grant execute on function public.can_edit_trip(bigint) to anon, authenticated;

alter table public.trips    enable row level security;
alter table public.memories enable row level security;

-- Policies from earlier versions of this file
drop policy if exists "Editor manages trips"    on public.trips;
drop policy if exists "Editor manages memories" on public.memories;

drop policy if exists "Anyone can view trips"       on public.trips;
drop policy if exists "Members add trips"           on public.trips;
drop policy if exists "Owner or admin edits trips"  on public.trips;
drop policy if exists "Owner or admin deletes trips" on public.trips;

create policy "Anyone can view trips" on public.trips
  for select to anon, authenticated using (true);
create policy "Members add trips" on public.trips
  for insert to authenticated with check (public.is_member() and owner = auth.uid());
create policy "Owner or admin edits trips" on public.trips
  for update to authenticated
  using (public.is_admin() or (public.is_member() and owner = auth.uid()))
  with check (public.is_admin() or (public.is_member() and owner = auth.uid()));
create policy "Owner or admin deletes trips" on public.trips
  for delete to authenticated using (public.is_admin() or (public.is_member() and owner = auth.uid()));

drop policy if exists "Anyone can view memories"         on public.memories;
drop policy if exists "Trip editors add memories"        on public.memories;
drop policy if exists "Trip editors edit memories"       on public.memories;
drop policy if exists "Trip editors delete memories"     on public.memories;

create policy "Anyone can view memories" on public.memories
  for select to anon, authenticated using (true);
create policy "Trip editors add memories" on public.memories
  for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy "Trip editors edit memories" on public.memories
  for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy "Trip editors delete memories" on public.memories
  for delete to authenticated using (public.can_edit_trip(trip_id));

-- ---------- Photo storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'])
on conflict (id) do update set public = true;

drop policy if exists "Editor uploads photos"          on storage.objects;
drop policy if exists "Editor updates photos"          on storage.objects;
drop policy if exists "Editor deletes photos"          on storage.objects;
drop policy if exists "Members upload photos"          on storage.objects;
drop policy if exists "Uploader or admin updates photos" on storage.objects;
drop policy if exists "Uploader or admin deletes photos" on storage.objects;

-- Public bucket: anyone can load photos by URL. Members upload; the uploader or admin can change them.
create policy "Members upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "Uploader or admin updates photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (public.is_admin() or owner_id = auth.uid()::text));
create policy "Uploader or admin deletes photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (public.is_admin() or owner_id = auth.uid()::text));

-- ---------- Leftovers from the earlier "first account edits" version ----------

drop function if exists public.is_editor();
drop function if exists public.editor_exists();
