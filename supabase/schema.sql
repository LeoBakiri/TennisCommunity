-- ════════════════════════════════════════════════════════════════════
--  El Patio Tennis — database schema for Supabase (PostgreSQL)
--  For a brand-new project: run once in Supabase → SQL Editor.
--  An existing database upgrades through supabase/migrations/ instead.
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
  brand_name text not null default 'El Patio Tennis',
  logo_mark text not null default 'EP',
  color_primary text not null default '#1F3A2E',
  color_accent text not null default '#C9DC4B',
  color_background text not null default '#F7F4EC',
  color_ink text not null default '#1E2420',
  color_sage text not null default '#DCE3D3',
  community_url text not null default '',
  default_location text not null default '',
  timezone text not null default 'America/Los_Angeles',
  currency text not null default 'USD',
  cancellation_window_hours int not null default 24,
  cancellation_policy text not null default '',
  booking_horizon_days int not null default 28,
  club_disclaimer text not null default '',
  default_group_capacity int not null default 6,
  default_group_price_cents int default 4000,
  default_group_duration_min int not null default 90,
  default_pa_capacity int not null default 4,
  default_pa_price_cents int default 4000,
  default_pa_duration_min int not null default 60,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  email text,
  phone text,
  full_name text not null default '',
  role text not null default 'member' check (role in ('member','coach','admin')),
  emergency_contact text not null default '',
  status text not null default 'active' check (status in ('active','inactive')),
  onboarded boolean not null default false,
  weekly_goal int not null default 1 check (weekly_goal between 1 and 3), -- sessions a week the player aims for
  leaderboard_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  session_type text check (session_type in ('group','performance_accelerator')),
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  coach_ids uuid[] not null default '{}',
  capacity int not null check (capacity > 0),
  price_cents int,
  location text not null default '',
  court int check (court between 1 and 4),
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  visibility text not null default 'public' check (visibility in ('public','private')),
  description text not null default '',
  internal_notes text not null default '',
  decided_at timestamptz, -- a coach confirmed a two-court session that was under its minimum
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

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  kind text not null check (kind in ('private','semi_private')),
  client_names text[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '',
  court int check (court between 1 and 4),
  price_cents int check (price_cents is null or price_cents >= 0),
  commission_cents int check (commission_cents is null or commission_cents >= 0), -- the club's cut, fixed when saved
  paid_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists lessons_coach_idx on public.lessons (coach_id, starts_at);

-- What a club takes from lessons at its courts, matched by place name in the lesson location.
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  place text not null,
  percent numeric(5,2) not null default 0 check (percent >= 0 and percent <= 100),
  per_hour_cents int not null default 0 check (per_hour_cents >= 0),
  per_lesson_cents int not null default 0 check (per_lesson_cents >= 0),
  created_at timestamptz not null default now()
);

-- A card per person a coach teaches privately. Lessons match it by name, ignoring case.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text,
  email text,
  level text not null default '',
  goals text not null default '',
  notes text not null default '', -- only the coach sees these
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_coach_name on public.clients (coach_id, lower(full_name));

-- What a coach noticed about one player after a community session: skills that moved up a level, and a tip.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on update cascade on delete cascade,
  user_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  skills text[] not null default '{}' check (skills <@ array['serve','forehand','backhand','volley','movement','match_play']),
  tip text not null default '' check (length(tip) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists feedback_session_user on public.feedback (session_id, user_id);
create index if not exists feedback_user_idx on public.feedback (user_id);

create table if not exists public.coach_calendars (
  coach_id uuid primary key references public.profiles(id) on update cascade on delete cascade,
  google_email text not null default '',
  status text not null default 'connected' check (status in ('connected','needs_reconnect')),
  last_synced_at timestamptz,
  last_error text not null default '',
  connected_at timestamptz not null default now()
);

-- Readable only with the service role: never reachable from the browser.
create table if not exists public.coach_google_tokens (
  coach_id uuid primary key references public.profiles(id) on update cascade on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_event_links (
  source_type text not null check (source_type in ('session','lesson')),
  source_id uuid not null,
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  calendar_id text not null default 'primary',
  google_event_id text not null,
  payload text not null default '',
  updated_at timestamptz not null default now(),
  primary key (source_type, source_id, coach_id)
);
create index if not exists calendar_links_coach_idx on public.calendar_event_links (coach_id);

create table if not exists public.calendar_sync_queue (
  source_type text not null check (source_type in ('session','lesson')),
  source_id uuid not null,
  enqueued_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '',
  primary key (source_type, source_id)
);

-- A player's CourtReserve calendar link, shown on My Sessions. Works like a password to their club bookings.
create table if not exists public.calendar_feeds (
  id uuid primary key references public.profiles(id) on update cascade on delete cascade,
  url text not null check (url ~* '^https://app\.courtreserve\.com/Online/PublicIcal/\S+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

-- ───────────────────────── row level security ─────────────────────────

alter table public.admin_emails enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.lessons enable row level security;
alter table public.clients enable row level security;
alter table public.feedback enable row level security;
alter table public.commission_rules enable row level security;
alter table public.coach_calendars enable row level security;
alter table public.coach_google_tokens enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.calendar_sync_queue enable row level security;
alter table public.calendar_feeds enable row level security;

-- settings: everyone reads, admins write
create policy settings_read on public.settings for select using (true);
create policy settings_write on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- profiles: yourself, and staff see everyone; everyone else gets coach names from staff_names()
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_staff());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete using (public.is_admin());

-- sessions: published community sessions are visible to all; staff see all
create policy sessions_read on public.sessions for select
  using ((status <> 'draft' and visibility = 'public' and session_type is not null) or public.is_staff() or public.has_booking(id));
create policy sessions_write on public.sessions for all using (public.is_admin()) with check (public.is_admin());

-- bookings: players see their own; staff see all. Players create/cancel via functions only.
create policy bookings_read on public.bookings for select using (user_id = auth.uid() or public.is_staff());
create policy bookings_admin on public.bookings for all using (public.is_admin()) with check (public.is_admin());
create policy bookings_coach_attendance on public.bookings for update to authenticated
  using (public.coaches_session(session_id)) with check (public.coaches_session(session_id));

-- lessons belong to their coach. Admins can read them; only the coach can change them.
create policy lessons_read on public.lessons for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin());
create policy lessons_insert on public.lessons for insert to authenticated with check (coach_id = auth.uid() and public.is_staff());
create policy lessons_update on public.lessons for update to authenticated
  using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff());
create policy lessons_delete on public.lessons for delete to authenticated using (coach_id = auth.uid() and public.is_staff());

-- clients belong to their coach, like lessons
create policy clients_read on public.clients for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin());
create policy clients_insert on public.clients for insert to authenticated with check (coach_id = auth.uid() and public.is_staff());
create policy clients_update on public.clients for update to authenticated
  using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff());
create policy clients_delete on public.clients for delete to authenticated using (coach_id = auth.uid() and public.is_staff());

-- feedback: players read their own; the session's coaches write it
create policy feedback_read on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy feedback_insert on public.feedback for insert to authenticated with check (coach_id = auth.uid() and public.coaches_session(session_id));
create policy feedback_update on public.feedback for update to authenticated
  using (public.coaches_session(session_id)) with check (coach_id = auth.uid() and public.coaches_session(session_id));
create policy feedback_delete on public.feedback for delete to authenticated using (public.coaches_session(session_id));

-- commission rules: coaches read them for their earnings; only admins change them
create policy commission_rules_read on public.commission_rules for select to authenticated using (public.is_staff());
create policy commission_rules_write on public.commission_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy calendars_read on public.coach_calendars for select to authenticated using (coach_id = auth.uid() or public.is_admin());

-- CourtReserve links: only their owner, not even admins
create policy calendar_feeds_own on public.calendar_feeds for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ───────────────────────── privileges ─────────────────────────

grant usage on schema public to anon, authenticated;
grant select on public.settings, public.profiles, public.sessions to anon;
grant select, insert, update, delete on public.settings, public.profiles, public.sessions, public.bookings, public.lessons, public.clients, public.feedback to authenticated;
grant select on public.coach_calendars to authenticated;
grant select, insert, update, delete on public.calendar_feeds to authenticated;
revoke all on public.calendar_feeds from anon;
grant select, insert, update, delete on public.commission_rules to authenticated;
revoke all on public.admin_emails from anon, authenticated;
revoke all on public.lessons, public.feedback, public.commission_rules, public.coach_calendars, public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue from anon;
revoke all on public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue from authenticated;
-- The google-calendar function uses the service role.
grant select on public.profiles, public.sessions, public.lessons to service_role;
grant select, insert, update, delete on public.coach_calendars, public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue to service_role;

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

-- Coach names for the public schedule, without their contact details.
create or replace function public.staff_names()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select id, full_name, role from public.profiles where role in ('coach','admin')
$$;

-- Sessions played between two moments, per player, for the monthly leaderboard.
-- Hands out only the first name and last initial, and skips players who hid themselves.
create or replace function public.leaderboard(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, name text, played int, reached_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id,
         split_part(trim(p.full_name), ' ', 1) || coalesce(' ' || upper(substring(trim(p.full_name) from '\s(\S)\S*$')) || '.', ''),
         count(*)::int,
         max(s.starts_at)
  from public.bookings b
  join public.sessions s on s.id = b.session_id
  join public.profiles p on p.id = b.user_id
  where b.status = 'confirmed' and b.attended is distinct from false
    and s.session_type is not null and s.status <> 'cancelled'
    and s.starts_at >= p_from and s.starts_at < p_to and s.starts_at <= now()
    and p.role = 'member' and p.status = 'active' and not p.leaderboard_hidden
  group by p.id
  order by 3 desc, 4 asc
  limit 50
$$;

-- Transaction-safe booking with capacity and waitlist handling.
create or replace function public.book_session(p_session_id uuid, p_user_id uuid, p_force_status text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  used int;
  st text;
  pos int := null;
  b public.bookings;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if p_user_id <> me and not admin then raise exception 'You can only book for yourself.'; end if;
  if p_force_status is not null and not admin then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'Please complete your profile first.';
  end if;

  select * into s from public.sessions where id = p_session_id for update;
  if not found or s.session_type is null then raise exception 'Session not found.'; end if;

  if not admin then
    if s.status <> 'published' then raise exception 'This session isn''t open for booking.'; end if;
    if s.starts_at <= now() then raise exception 'This session has already started.'; end if;
  end if;

  if exists (select 1 from public.bookings where session_id = s.id and user_id = p_user_id and status in ('confirmed','waitlisted')) then
    raise exception 'You''re already booked into this session.';
  end if;

  select coalesce(sum(b2.seats), 0) into used from public.bookings b2
    where b2.session_id = s.id and b2.status = 'confirmed';

  if p_force_status is not null then st := p_force_status;
  elsif used + 1 <= s.capacity then st := 'confirmed';
  else st := 'waitlisted';
  end if;
  if st = 'waitlisted' then
    select coalesce(max(waitlist_position), 0) + 1 into pos from public.bookings where session_id = s.id and status = 'waitlisted';
  end if;

  perform set_config('ltc.internal', '1', true);
  insert into public.bookings (session_id, user_id, status, seats, waitlist_position)
    values (s.id, p_user_id, st, 1, pos)
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
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  select * into s from public.sessions where id = b.session_id for update;
  staff := public.coaches_session(s.id);
  if b.user_id <> me and not staff then raise exception 'You can only cancel your own bookings.'; end if;
  if b.status not in ('confirmed','waitlisted') then raise exception 'This booking is already cancelled.'; end if;
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

  if s.status = 'published' then
    select s.capacity - coalesce(sum(x.seats), 0) into free from public.bookings x
      where x.session_id = s.id and x.status = 'confirmed';
    for w in select * from public.bookings where session_id = s.id and status = 'waitlisted' order by waitlist_position, created_at loop
      exit when free <= 0;
      continue when w.seats > free;
      update public.bookings set status = 'confirmed', waitlist_position = null, updated_at = now() where id = w.id;
      free := free - w.seats;
    end loop;
  end if;

  -- renumber the remaining waitlist
  update public.bookings x set waitlist_position = r.rn
    from (select id, row_number() over (order by waitlist_position, created_at) rn
          from public.bookings where session_id = s.id and status = 'waitlisted') r
    where x.id = r.id;
  perform set_config('ltc.internal', '', true);
end $$;

-- Coaches edit one column of a session: their notes.
create or replace function public.set_session_notes(p_session_id uuid, p_notes text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.coaches_session(p_session_id) then raise exception 'You can only edit notes for your own sessions.'; end if;
  update public.sessions set internal_notes = coalesce(p_notes, '') where id = p_session_id;
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

-- Lets an admin remove a member from the website, including the login the browser can't reach.
create or replace function public.admin_remove_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  removed_email text;
  b record;
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  if p_user_id = auth.uid() then raise exception 'You can''t remove your own account.'; end if;
  select email into removed_email from public.profiles where id = p_user_id;
  if not found then raise exception 'Member not found.'; end if;

  -- Cancelling first moves the next player in from the waitlist.
  for b in
    select x.id from public.bookings x join public.sessions s on s.id = x.session_id
    where x.user_id = p_user_id and x.status in ('confirmed','waitlisted') and s.starts_at > now()
  loop
    perform public.cancel_booking(b.id, 'Member removed', false);
  end loop;

  -- coach_ids is a plain array, so deleting a profile would not clear it.
  update public.sessions set coach_ids = array_remove(coach_ids, p_user_id) where p_user_id = any (coach_ids);
  delete from public.admin_emails where lower(email) = lower(removed_email);
  -- Bookings, lessons, calendar data and retired player data cascade from profiles.
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end $$;

revoke execute on function public.admin_remove_member(uuid) from anon, public;
grant execute on function public.admin_remove_member(uuid) to authenticated;
grant execute on function public.session_stats(uuid[]) to anon, authenticated;
grant execute on function public.staff_names() to anon, authenticated;
revoke execute on function public.leaderboard(timestamptz, timestamptz) from anon, public;
grant execute on function public.leaderboard(timestamptz, timestamptz) to authenticated;
grant execute on function public.book_session(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text, boolean) to authenticated;
grant execute on function public.set_session_notes(uuid, text) to authenticated;
grant execute on function public.claim_profile() to authenticated;
revoke execute on function public.book_session(uuid, uuid, text), public.set_session_notes(uuid, text) from anon, public;
grant execute on function public.my_role(), public.is_staff(), public.is_admin(), public.is_staff_user(uuid),
  public.coaches_session(uuid), public.has_booking(uuid) to anon, authenticated;

-- ───────────────────────── calendar sync queue ─────────────────────────
-- Any change that could affect a calendar event queues its source row. The google-calendar
-- function works through the queue and compares against Supabase, the source of truth.

create or replace function public.enqueue_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  src text := case tg_table_name when 'sessions' then 'session' else 'lesson' end;
  sid uuid := case tg_op when 'DELETE' then old.id else new.id end;
begin
  -- Nested, not joined with AND: these columns exist only on sessions, and AND wouldn't protect lessons.
  if tg_table_name = 'sessions' and tg_op = 'UPDATE' then
    if row(new.session_type, new.title, new.starts_at, new.ends_at, new.coach_ids, new.location, new.court, new.status, new.description)
       is not distinct from
       row(old.session_type, old.title, old.starts_at, old.ends_at, old.coach_ids, old.location, old.court, old.status, old.description) then
      return null;
    end if;
  end if;
  insert into public.calendar_sync_queue (source_type, source_id) values (src, sid)
    on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';
  return null;
end $$;

drop trigger if exists sessions_calendar_sync on public.sessions;
create trigger sessions_calendar_sync after insert or update or delete on public.sessions
  for each row execute function public.enqueue_calendar_sync();
drop trigger if exists lessons_calendar_sync on public.lessons;
create trigger lessons_calendar_sync after insert or update or delete on public.lessons
  for each row execute function public.enqueue_calendar_sync();

-- When a coach connects, queue their upcoming work plus anything already linked to them.
create or replace function public.calendar_enqueue_coach(p_coach uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.calendar_sync_queue (source_type, source_id)
    select 'session', id from public.sessions where p_coach = any (coach_ids) and session_type is not null and status = 'published' and ends_at > now()
    union select 'lesson', id from public.lessons where coach_id = p_coach and ends_at > now()
    union select source_type, source_id from public.calendar_event_links where coach_id = p_coach
  on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';
$$;
revoke execute on function public.calendar_enqueue_coach(uuid) from public, anon, authenticated;
grant execute on function public.calendar_enqueue_coach(uuid) to service_role;

-- ───────────────────────── starting data ─────────────────────────

insert into public.admin_emails (email) values ('leocanbakiri@gmail.com') on conflict do nothing;

insert into public.settings (id, brand_name, logo_mark, default_location, cancellation_policy, club_disclaimer)
values ('default', 'El Patio Tennis', 'EP', 'Balboa Tennis Club, San Diego',
  'Less than 24 hours before a session you can''t cancel, but you can offer your spot. If someone takes it, you won''t be charged. If nobody does, you pay as normal.',
  'El Patio Tennis is an independent coaching business run by coach Leo Bakiri and co-run by coach Kaan Ayman. It is not affiliated with or operated by Balboa Tennis Club, and booking a lesson here does not reserve club courts.')
on conflict (id) do nothing;

-- ───────────────────────── two-court decision ─────────────────────────
-- p_choice: 'run', 'one_court' or 'cancel'. Returns how many players were moved to the waitlist
-- (one court) or cancelled (cancel).
create or replace function public.decide_session(p_session_id uuid, p_choice text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  size int;
  moved int := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not public.coaches_session(p_session_id) then raise exception 'You can only decide on your own sessions.'; end if;
  if p_choice not in ('run', 'one_court', 'cancel') then raise exception 'Unknown choice.'; end if;
  select * into s from public.sessions where id = p_session_id for update;
  if not found or s.session_type is null then raise exception 'Session not found.'; end if;
  if s.status <> 'published' then raise exception 'This session isn''t open.'; end if;
  size := case s.session_type when 'performance_accelerator' then 4 else 6 end;
  if s.capacity <= size then raise exception 'This session is already on one court.'; end if;

  perform set_config('ltc.internal', '1', true);
  if p_choice = 'cancel' then
    update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
      cancel_reason = 'Not enough players for two courts', waitlist_position = null
    where session_id = s.id and status in ('confirmed', 'waitlisted');
    get diagnostics moved = row_count;
    update public.sessions set status = 'cancelled', decided_at = now() where id = s.id;
  elsif p_choice = 'one_court' then
    -- The earliest sign-ups keep their spots; the rest go to the front of the waitlist.
    with ranked as (
      select id, row_number() over (order by created_at) rn from public.bookings
      where session_id = s.id and status = 'confirmed'
    )
    update public.bookings b set status = 'waitlisted', spot_offered_at = null, updated_at = now(), waitlist_position = -(1000 - r.rn)
    from ranked r where b.id = r.id and r.rn > size;
    get diagnostics moved = row_count;
    update public.bookings x set waitlist_position = q.rn
      from (select id, row_number() over (order by waitlist_position, created_at) rn
            from public.bookings where session_id = s.id and status = 'waitlisted') q
      where x.id = q.id;
    update public.sessions set capacity = size, decided_at = now() where id = s.id;
  else
    update public.sessions set decided_at = now() where id = s.id;
  end if;
  perform set_config('ltc.internal', '', true);
  return moved;
end $$;

grant execute on function public.decide_session(uuid, text) to authenticated;
revoke execute on function public.decide_session(uuid, text) from anon, public;
