-- ════════════════════════════════════════════════════════════════════
--  Leo Tennis Community — database schema for Supabase (PostgreSQL)
--  Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
--  Security model: the website talks to the database directly with the
--  public anon key; every rule is enforced here with Row Level Security
--  and SECURITY DEFINER functions for multi-row operations (booking,
--  cancelling, waitlist promotion).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────

create table if not exists public.admin_emails (
  email text primary key
);

create table if not exists public.settings (
  id text primary key default 'default',
  brand_name text not null default 'Leo Tennis Community',
  tagline text not null default '',
  logo_mark text not null default 'LT',
  color_primary text not null default '#1F3A2E',
  color_accent text not null default '#C9DC4B',
  color_background text not null default '#F7F4EC',
  color_ink text not null default '#1E2420',
  color_sage text not null default '#DCE3D3',
  hero_headline text not null default '',
  hero_subtext text not null default '',
  coach_bio text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  community_url text not null default '',
  default_location text not null default '',
  timezone text not null default 'America/Los_Angeles',
  currency text not null default 'USD',
  cancellation_window_hours int not null default 24,
  cancellation_policy text not null default '',
  waitlist_auto_promote boolean not null default true,
  booking_horizon_days int not null default 28,
  club_disclaimer text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  email text,
  phone text,
  full_name text not null default '',
  role text not null default 'member' check (role in ('member','coach','admin')),
  skill_level text not null default '',
  ntrp text not null default '',
  goals text not null default '',
  dominant_hand text not null default 'Right',
  emergency_contact text not null default '',
  bio text not null default '',
  notify_email boolean not null default true,
  notify_sms boolean not null default false,
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active','inactive')),
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('private','semi_private','group','event')),
  summary text not null default '',
  description text not null default '',
  duration_min int not null default 60,
  capacity int not null default 1 check (capacity > 0),
  price_cents int check (price_cents is null or price_cents >= 0),
  pricing text not null default 'per_participant' check (pricing in ('per_participant','per_session')),
  requires_approval boolean not null default false,
  allow_requests boolean not null default false,
  skill_level text not null default '',
  location text not null default '',
  color text not null default '#1F3A2E',
  coaches_count int not null default 1,
  active boolean not null default true,
  sort_order int not null default 10,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time text not null check (start_time ~ '^\d{2}:\d{2}$'),
  duration_min int not null default 60,
  capacity int,
  coach_ids uuid[] not null default '{}',
  location text not null default '',
  published boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id),
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  coach_ids uuid[] not null default '{}',
  capacity int not null check (capacity > 0),
  price_cents int,
  pricing text not null default 'per_participant' check (pricing in ('per_participant','per_session')),
  location text not null default '',
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  description text not null default '',
  internal_notes text not null default '',
  skill_level text not null default '',
  template_id uuid references public.schedule_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists sessions_starts_idx on public.sessions (starts_at);
create index if not exists sessions_coach_idx on public.sessions using gin (coach_ids);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  status text not null check (status in ('confirmed','pending','waitlisted','cancelled','declined')),
  seats int not null default 1 check (seats between 1 and 20),
  waitlist_position int,
  guest_name text not null default '',
  guest_email text not null default '',
  attended boolean,
  late_cancel boolean not null default false,
  cancel_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists bookings_session_idx on public.bookings (session_id);
create index if not exists bookings_user_idx on public.bookings (user_id);
-- One active booking per player per session, enforced by the database.
create unique index if not exists bookings_one_active on public.bookings (session_id, user_id)
  where status in ('confirmed','pending','waitlisted');

create table if not exists public.lesson_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  program_id uuid not null references public.programs(id),
  preferred_date text not null,
  preferred_time text not null,
  alternatives text not null default '',
  partner_name text not null default '',
  partner_email text not null default '',
  message text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  coach_id uuid,
  session_id uuid references public.sessions(id) on delete set null,
  admin_note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  author_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  body text not null,
  visibility text not null default 'staff' check (visibility in ('staff','shared')),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  sender_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  body text not null,
  read_by_staff boolean not null default false,
  read_by_member boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_member_idx on public.messages (member_id);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_id uuid references public.profiles(id) on update cascade on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on update cascade on delete cascade,
  channel text not null default 'email',
  recipient text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null default 'logged',
  created_at timestamptz not null default now()
);

-- ───────────────────────── role helpers ─────────────────────────

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('coach','admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_staff_user(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and role in ('coach','admin'))
$$;

create or replace function public.coaches_session(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.sessions s where s.id = sid and auth.uid() = any (s.coach_ids) and public.is_staff()
  )
$$;

create or replace function public.has_booking(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bookings b where b.session_id = sid and b.user_id = auth.uid())
$$;

-- ───────────────────────── column guards ─────────────────────────
-- Non-admins may only change a narrow set of columns. Internal functions
-- set `ltc.internal` to bypass these guards inside a transaction.

create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ltc.internal', true), '') = '1' or public.is_admin() then
    if tg_op = 'INSERT' and exists (select 1 from public.admin_emails a where lower(a.email) = lower(new.email)) then
      new.role := 'admin';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.id is distinct from auth.uid() then
      raise exception 'You can only create your own profile.';
    end if;
    new.role := case when exists (select 1 from public.admin_emails a where lower(a.email) = lower(new.email)) then 'admin' else 'member' end;
    new.status := 'active';
    new.created_at := now();
  else
    new.id := old.id;
    new.role := old.role;
    new.status := old.status;
    new.tags := old.tags;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists guard_profiles on public.profiles;
create trigger guard_profiles before insert or update on public.profiles
  for each row execute function public.guard_profiles();

create or replace function public.guard_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ltc.internal', true), '') = '1' or public.is_admin() then
    return new;
  end if;
  -- Coaches may record attendance only.
  new.id := old.id; new.session_id := old.session_id; new.user_id := old.user_id;
  new.status := old.status; new.seats := old.seats; new.waitlist_position := old.waitlist_position;
  new.guest_name := old.guest_name; new.guest_email := old.guest_email;
  new.late_cancel := old.late_cancel; new.cancel_reason := old.cancel_reason;
  new.created_at := old.created_at; new.cancelled_at := old.cancelled_at;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_bookings on public.bookings;
create trigger guard_bookings before update on public.bookings
  for each row execute function public.guard_bookings();

create or replace function public.guard_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.session_id := null; new.coach_id := null; new.admin_note := '';
    new.created_at := now();
    return new;
  end if;
  if not (old.status = 'pending' and new.status = 'withdrawn') then
    raise exception 'This request has already been handled.';
  end if;
  old.status := 'withdrawn';
  return old;
end $$;
drop trigger if exists guard_requests on public.lesson_requests;
create trigger guard_requests before insert or update on public.lesson_requests
  for each row execute function public.guard_requests();

create or replace function public.guard_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  new.id := old.id; new.member_id := old.member_id; new.sender_id := old.sender_id;
  new.body := old.body; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists guard_messages on public.messages;
create trigger guard_messages before insert or update on public.messages
  for each row execute function public.guard_messages();

-- ───────────────────────── row level security ─────────────────────────

alter table public.admin_emails enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.lesson_requests enable row level security;
alter table public.coach_notes enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;

do $$
declare r record;
begin
  -- start from a clean slate so the script can be re-run
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- settings: everyone reads, admins write
create policy settings_read on public.settings for select using (true);
create policy settings_write on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- profiles: yourself, staff see everyone, everyone sees coach profiles
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_staff() or role in ('coach','admin'));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete using (public.is_admin());

-- programs: public catalogue, admins write
create policy programs_read on public.programs for select using (active or public.is_staff());
create policy programs_write on public.programs for all using (public.is_admin()) with check (public.is_admin());

-- recurring schedule: staff only
create policy templates_read on public.schedule_templates for select using (public.is_staff());
create policy templates_write on public.schedule_templates for all using (public.is_admin()) with check (public.is_admin());

-- sessions: published public ones are visible to all; private ones to booked players; staff see all
create policy sessions_read on public.sessions for select
  using ((status <> 'draft' and visibility = 'public') or public.is_staff() or public.has_booking(id));
create policy sessions_write on public.sessions for all using (public.is_admin()) with check (public.is_admin());

-- bookings: players see their own; staff see all. Players create/cancel via functions only.
create policy bookings_read on public.bookings for select using (user_id = auth.uid() or public.is_staff());
create policy bookings_admin on public.bookings for all using (public.is_admin()) with check (public.is_admin());
create policy bookings_coach_attendance on public.bookings for update to authenticated
  using (public.coaches_session(session_id)) with check (public.coaches_session(session_id));

-- lesson requests
create policy requests_read on public.lesson_requests for select using (user_id = auth.uid() or public.is_staff());
create policy requests_insert on public.lesson_requests for insert to authenticated with check (user_id = auth.uid());
create policy requests_update on public.lesson_requests for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy requests_delete on public.lesson_requests for delete using (public.is_admin());

-- coach notes: staff; players see notes shared with them
create policy notes_read on public.coach_notes for select
  using (public.is_staff() or (player_id = auth.uid() and visibility = 'shared'));
create policy notes_insert on public.coach_notes for insert to authenticated
  with check (public.is_staff() and author_id = auth.uid());
create policy notes_delete on public.coach_notes for delete using (author_id = auth.uid() or public.is_admin());

-- messages: a conversation between one player and the coaching team
create policy messages_read on public.messages for select using (member_id = auth.uid() or public.is_staff());
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and (member_id = auth.uid() or public.is_staff()));
create policy messages_update on public.messages for update to authenticated
  using (member_id = auth.uid() or public.is_staff()) with check (member_id = auth.uid() or public.is_staff());

-- announcements: signed-in members read, admins write
create policy announcements_read on public.announcements for select to authenticated using (true);
create policy announcements_write on public.announcements for all using (public.is_admin()) with check (public.is_admin());

-- notification log
create policy notifications_read on public.notifications for select using (user_id = auth.uid() or public.is_admin());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (user_id = auth.uid() or public.is_staff() or public.is_staff_user(user_id));

-- ───────────────────────── privileges ─────────────────────────

grant usage on schema public to anon, authenticated;
grant select on public.settings, public.profiles, public.programs, public.sessions to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.admin_emails from anon, authenticated;

-- ───────────────────────── functions ─────────────────────────

-- Seat counts for any set of sessions (bookings themselves stay private).
create or replace function public.session_stats(ids uuid[])
returns table (session_id uuid, booked int, waitlist int, pending int)
language sql stable security definer set search_path = public as $$
  select s.id,
         coalesce(sum(b.seats) filter (where b.status in ('confirmed','pending')), 0)::int,
         count(b.id) filter (where b.status = 'waitlisted')::int,
         count(b.id) filter (where b.status = 'pending')::int
  from unnest(ids) as s(id)
  left join public.bookings b on b.session_id = s.id
  group by s.id
$$;

-- Transaction-safe booking with capacity, approval and waitlist handling.
create or replace function public.book_session(
  p_session_id uuid, p_user_id uuid, p_seats int default 1,
  p_guest_name text default '', p_guest_email text default '',
  p_requires_approval boolean default false, p_force_status text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  prog public.programs;
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  used int;
  st text;
  pos int := null;
  seats int := greatest(1, coalesce(p_seats, 1));
  b public.bookings;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_user_id <> me and not admin then raise exception 'You can only book for yourself.'; end if;
  if p_force_status is not null and not admin then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'Please complete your profile first.';
  end if;

  select * into s from public.sessions where id = p_session_id for update;
  if not found then raise exception 'Session not found.'; end if;
  select * into prog from public.programs where id = s.program_id;

  if not admin then
    if s.status <> 'published' then raise exception 'This session isn''t open for booking.'; end if;
    if s.starts_at <= now() then raise exception 'This session has already started.'; end if;
    if s.visibility = 'private' then raise exception 'This session is private.'; end if;
    seats := case when prog.kind = 'semi_private' then least(seats, 2) else 1 end;
  end if;

  if exists (select 1 from public.bookings where session_id = s.id and user_id = p_user_id and status in ('confirmed','pending','waitlisted')) then
    raise exception 'You''re already booked into this session.';
  end if;

  select coalesce(sum(b2.seats), 0) into used from public.bookings b2
    where b2.session_id = s.id and b2.status in ('confirmed','pending');

  if p_force_status is not null then st := p_force_status;
  elsif used + seats <= s.capacity then st := case when prog.requires_approval then 'pending' else 'confirmed' end;
  else st := 'waitlisted';
  end if;
  if st = 'waitlisted' then
    select coalesce(max(waitlist_position), 0) + 1 into pos from public.bookings where session_id = s.id and status = 'waitlisted';
  end if;

  perform set_config('ltc.internal', '1', true);
  insert into public.bookings (session_id, user_id, status, seats, waitlist_position, guest_name, guest_email)
    values (s.id, p_user_id, st, seats, pos, coalesce(p_guest_name, ''), lower(coalesce(p_guest_email, '')))
    returning * into b;
  perform set_config('ltc.internal', '', true);
  return b;
end $$;

-- Cancel a booking, apply the late-cancel rule and promote from the waitlist.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default '', p_late boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  s public.sessions;
  cfg public.settings;
  me uuid := auth.uid();
  staff boolean;
  late boolean := false;
  free int;
  w record;
  title text;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  select * into s from public.sessions where id = b.session_id for update;
  staff := public.coaches_session(s.id);
  if b.user_id <> me and not staff then raise exception 'You can only cancel your own bookings.'; end if;
  if b.status not in ('confirmed','pending','waitlisted') then raise exception 'This booking is already cancelled.'; end if;
  if s.starts_at <= now() and not staff then raise exception 'This session has already started.'; end if;

  select * into cfg from public.settings where id = 'default';
  if not staff and b.status <> 'waitlisted' then
    late := s.starts_at - now() < make_interval(hours => coalesce(cfg.cancellation_window_hours, 24));
  end if;

  perform set_config('ltc.internal', '1', true);
  update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
    cancel_reason = coalesce(nullif(p_reason, ''), case when staff and b.user_id <> me then 'Cancelled by coach' else 'Cancelled by player' end),
    late_cancel = late, waitlist_position = null
  where id = b.id;

  if coalesce(cfg.waitlist_auto_promote, true) and s.status = 'published' then
    select s.capacity - coalesce(sum(x.seats), 0) into free from public.bookings x
      where x.session_id = s.id and x.status in ('confirmed','pending');
    select coalesce(nullif(s.title, ''), p.name) into title from public.programs p where p.id = s.program_id;
    for w in select * from public.bookings where session_id = s.id and status = 'waitlisted' order by waitlist_position, created_at loop
      exit when free <= 0;
      continue when w.seats > free;
      update public.bookings set status = 'confirmed', waitlist_position = null, updated_at = now() where id = w.id;
      free := free - w.seats;
      insert into public.notifications (user_id, channel, recipient, subject, body)
        select w.user_id, 'email', coalesce(p.email, p.phone, ''), 'You''re in: ' || title,
               'A spot opened up and you''ve been moved from the waitlist into ' || title || ' on ' ||
               to_char(s.starts_at at time zone 'America/Los_Angeles', 'Dy Mon DD, HH12:MI AM') || '.'
        from public.profiles p where p.id = w.user_id;
    end loop;
  end if;

  -- renumber the remaining waitlist
  update public.bookings x set waitlist_position = r.rn
    from (select id, row_number() over (order by waitlist_position, created_at) rn
          from public.bookings where session_id = s.id and status = 'waitlisted') r
    where x.id = r.id;
  perform set_config('ltc.internal', '', true);
end $$;

-- Link a profile that the coach created in advance (same email) to the
-- newly signed-up account, keeping all of its bookings and notes.
create or replace function public.claim_profile() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  pre uuid;
begin
  if me is null or em = '' then return; end if;
  if exists (select 1 from public.profiles where id = me) then return; end if;
  select id into pre from public.profiles where lower(email) = em and onboarded = false and id <> me limit 1;
  if pre is null then return; end if;
  perform set_config('ltc.internal', '1', true);
  update public.profiles set id = me where id = pre;
  update public.sessions set coach_ids = array_replace(coach_ids, pre, me) where pre = any (coach_ids);
  perform set_config('ltc.internal', '', true);
end $$;

grant execute on function public.session_stats(uuid[]) to anon, authenticated;
grant execute on function public.book_session(uuid, uuid, int, text, text, boolean, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text, boolean) to authenticated;
grant execute on function public.claim_profile() to authenticated;
grant execute on function public.my_role(), public.is_staff(), public.is_admin(), public.is_staff_user(uuid),
  public.coaches_session(uuid), public.has_booking(uuid) to anon, authenticated;

-- ───────────────────────── starting data ─────────────────────────

insert into public.admin_emails (email) values ('leocanbakiri@gmail.com') on conflict do nothing;

insert into public.settings (id, brand_name, tagline, logo_mark, hero_headline, hero_subtext, coach_bio, contact_email,
  default_location, cancellation_policy, club_disclaimer)
values ('default', 'Leo Tennis Community', 'Coaching & community in San Diego', 'LT',
  'Better tennis, built together.',
  'Private lessons, small-group clinics and community sessions with coach Leo Bakiri — mostly at Balboa Tennis Club, San Diego.',
  'Leo Bakiri is an independent tennis coach in San Diego. His sessions blend clean technique, smart movement and point construction with a warm, community-first atmosphere — for players from first rally to competitive league play.',
  'leocanbakiri@gmail.com', 'Balboa Tennis Club, San Diego',
  'Please cancel at least 24 hours before your session so someone from the waitlist can take your spot. Late cancellations may still be charged by the coach.',
  'Leo Tennis Community is an independent coaching business run by coach Leo Bakiri. It is not affiliated with or operated by Balboa Tennis Club, and booking a lesson here does not reserve club courts.')
on conflict (id) do nothing;

insert into public.programs (id, slug, name, kind, summary, description, duration_min, capacity, price_cents, pricing,
  requires_approval, allow_requests, skill_level, location, color, coaches_count, sort_order) values
('00000000-0000-4000-8000-000000000101', 'private-lessons', 'Private Lesson', 'private',
 'One-on-one coaching built entirely around your game.',
 'A focused hour with Leo on the parts of your game that matter most to you — technique, tactics, movement or match preparation. Book an open slot or request a time that works for you.',
 60, 1, 10000, 'per_session', false, true, 'All levels', 'Balboa Tennis Club, San Diego', '#1F3A2E', 1, 1),
('00000000-0000-4000-8000-000000000102', 'semi-private-lessons', 'Semi-Private Lesson', 'semi_private',
 'Train with a partner — shared attention, shared cost.',
 'Two players, one coach. Great for doubles partners, friends at a similar level, or families. Bring a partner when you book, or request a time for both of you.',
 60, 2, 11000, 'per_session', true, true, 'All levels', 'Balboa Tennis Club, San Diego', '#4F6B4A', 1, 2),
('00000000-0000-4000-8000-000000000103', 'group-clinics', 'Group Clinic', 'group',
 '90 minutes of drills, live-ball and play in a group of six.',
 'High-energy small-group clinics with progressive drills, live-ball patterns and situational play. Reserve your individual spot; if it''s full, join the waitlist and you''ll be moved in automatically when a spot opens.',
 90, 6, 4000, 'per_participant', false, false, '3.0 – 4.0', 'Balboa Tennis Club, San Diego', '#7A8F3A', 1, 3),
('00000000-0000-4000-8000-000000000104', 'performance-accelerator', 'Performance Accelerator', 'group',
 'Four players. Technique, movement, consistency, point construction.',
 'Small-group technical training for players who want measurable improvement. Each block focuses on one theme — from footwork patterns to serve +1 — with drills you can take straight into match play.',
 60, 4, 4000, 'per_participant', false, false, '3.5+ recommended', 'Balboa Tennis Club, San Diego', '#2F5D62', 1, 4),
('00000000-0000-4000-8000-000000000105', 'sunset-tennis', 'Sunset Tennis', 'event',
 'Sunday evening community tennis — drills, points and good company.',
 'Our weekly community gathering: structured warm-up drills, rotating point play and plenty of time to meet the rest of the community. Multiple coaches on court.',
 90, 12, null, 'per_participant', false, false, 'All levels', 'Balboa Tennis Club, San Diego', '#B5672C', 2, 5)
on conflict (id) do nothing;

insert into public.schedule_templates (id, program_id, weekday, start_time, duration_min, capacity, notes, published) values
('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000103', 1, '17:00', 90, 6, 'Monday Group Clinic', false),
('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000103', 2, '17:00', 90, 6, 'Tuesday Pop-Up Group Clinic', false),
('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103', 5, '15:00', 90, 6, 'Friday Group Clinic', false),
('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000105', 0, '18:30', 90, 12, 'Sunset Tennis', false)
on conflict (id) do nothing;
