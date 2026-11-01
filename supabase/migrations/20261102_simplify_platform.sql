-- Simplifies the platform to two community session types plus coach-owned lessons,
-- and adds what the Google Calendar sync needs. Run once in Supabase → SQL Editor,
-- then deploy the new site straight away: this replaces the booking function the old site calls.
--
-- Nothing is deleted. Retired tables (programs, schedule_templates, lesson_requests, coach_notes,
-- messages, announcements, notifications) stay in place, unused, so their data can still be exported.
-- Safe to re-run: already-converted rows are left alone.

begin;

-- ───────────────────────── columns ─────────────────────────

alter table public.sessions add column if not exists session_type text check (session_type in ('group','performance_accelerator'));
alter table public.sessions alter column program_id drop not null;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'default_group_capacity') then
    alter table public.settings
      add column default_group_capacity int not null default 6,
      add column default_group_price_cents int default 4000,
      add column default_group_duration_min int not null default 90,
      add column default_pa_capacity int not null default 4,
      add column default_pa_price_cents int default 4000,
      add column default_pa_duration_min int not null default 60;
    -- The old programs held these defaults.
    update public.settings s set
      default_group_capacity = p.capacity, default_group_price_cents = p.price_cents, default_group_duration_min = p.duration_min
      from public.programs p where p.slug = 'group-clinics' and s.id = 'default';
    update public.settings s set
      default_pa_capacity = p.capacity, default_pa_price_cents = p.price_cents, default_pa_duration_min = p.duration_min
      from public.programs p where p.slug = 'performance-accelerator' and s.id = 'default';
  end if;
end $$;

-- ───────────────────────── new tables ─────────────────────────

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  kind text not null check (kind in ('private','semi_private')),
  client_names text[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '',
  price_cents int check (price_cents is null or price_cents >= 0),
  notes text not null default '',
  legacy_session_id uuid unique references public.sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists lessons_coach_idx on public.lessons (coach_id, starts_at);

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

-- ───────────────────────── data conversion ─────────────────────────

do $$
begin
  -- Bookings are protected by a guard trigger; this lets the conversion update them.
  perform set_config('ltc.internal', '1', true);

  -- Private and semi-private sessions with real clients become lessons owned by their first coach.
  insert into public.lessons (coach_id, kind, client_names, starts_at, ends_at, location, price_cents, notes, legacy_session_id)
  select s.coach_ids[1],
         case when p.kind = 'semi_private' or array_length(c.names, 1) > 1 then 'semi_private' else 'private' end,
         c.names, s.starts_at, s.ends_at, s.location,
         case when s.pricing = 'per_participant' then s.price_cents * c.seats else s.price_cents end,
         concat_ws(E'\n', nullif(s.description, ''), nullif(s.internal_notes, '')),
         s.id
  from public.sessions s
  join public.programs p on p.id = s.program_id
  cross join lateral (
    select array_agg(n.name) as names, max(x.seats) as seats
    from (select sum(b.seats)::int as seats from public.bookings b where b.session_id = s.id and b.status in ('confirmed','pending')) x,
         lateral (
           select name from public.bookings b
           join public.profiles pr on pr.id = b.user_id
           cross join lateral unnest(array[pr.full_name, nullif(b.guest_name, '')]) as name
           where b.session_id = s.id and b.status in ('confirmed','pending') and name is not null
         ) n
  ) c
  where s.session_type is null
    and s.status <> 'cancelled'
    and s.coach_ids[1] is not null
    and c.names is not null
    and (p.kind in ('private','semi_private') or s.visibility = 'private')
  on conflict (legacy_session_id) do nothing;

  -- Everything public that isn't a lesson becomes one of the two community types.
  -- A Sunset or Clinic name moves into the notes so players still see it.
  update public.sessions s set
    session_type = case when p.slug = 'performance-accelerator' then 'performance_accelerator' else 'group' end,
    title = case when p.slug = 'performance-accelerator'
                 then case when lower(s.title) = 'performance accelerator' then ''
                           else regexp_replace(s.title, '^(performance\s+)?accelerator\s*[:·-]\s*', '', 'i') end
                 else '' end,
    description = case when p.slug = 'performance-accelerator' then s.description
                       else concat_ws(E'\n', nullif(s.title, ''), nullif(s.description, '')) end
  from public.programs p
  where p.id = s.program_id
    and s.session_type is null
    and p.kind in ('group','event')
    and s.visibility = 'public';

  -- Approvals are gone: a held seat is a confirmed seat.
  update public.bookings b set status = 'confirmed', updated_at = now()
    where b.status = 'pending' and exists (select 1 from public.sessions s where s.id = b.session_id and s.session_type is not null);
  update public.bookings set status = 'cancelled', cancelled_at = coalesce(cancelled_at, updated_at), cancel_reason = coalesce(nullif(cancel_reason, ''), 'Declined')
    where status = 'declined';

  perform set_config('ltc.internal', '', true);
end $$;

-- ───────────────────────── security ─────────────────────────

alter table public.lessons enable row level security;
alter table public.coach_calendars enable row level security;
alter table public.coach_google_tokens enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.calendar_sync_queue enable row level security;

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select
  using ((status <> 'draft' and visibility = 'public' and session_type is not null) or public.is_staff() or public.has_booking(id));

-- Lessons belong to their coach. Admins can read them; only the coach can change them.
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists lessons_insert on public.lessons;
create policy lessons_insert on public.lessons for insert to authenticated with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists lessons_update on public.lessons;
create policy lessons_update on public.lessons for update to authenticated
  using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists lessons_delete on public.lessons;
create policy lessons_delete on public.lessons for delete to authenticated using (coach_id = auth.uid() and public.is_staff());

drop policy if exists calendars_read on public.coach_calendars;
create policy calendars_read on public.coach_calendars for select to authenticated using (coach_id = auth.uid() or public.is_admin());

revoke all on public.lessons, public.coach_calendars, public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue from anon;
revoke all on public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue from authenticated;
grant select, insert, update, delete on public.lessons to authenticated;
grant select on public.coach_calendars to authenticated;

-- ───────────────────────── functions ─────────────────────────

drop function if exists public.book_session(uuid, uuid, int, text, text, boolean, text);

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

grant execute on function public.book_session(uuid, uuid, text) to authenticated;
grant execute on function public.set_session_notes(uuid, text) to authenticated;
revoke execute on function public.book_session(uuid, uuid, text), public.set_session_notes(uuid, text) from anon, public;

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
    if row(new.session_type, new.title, new.starts_at, new.ends_at, new.coach_ids, new.location, new.status, new.description)
       is not distinct from
       row(old.session_type, old.title, old.starts_at, old.ends_at, old.coach_ids, old.location, old.status, old.description) then
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

commit;

-- ───────────────────────── check the result ─────────────────────────
-- Retired = old private slots with no client, or with no coach to own them. Worth a look if the count surprises you.
select
  (select count(*) from public.sessions where session_type = 'group') as group_sessions,
  (select count(*) from public.sessions where session_type = 'performance_accelerator') as performance_accelerators,
  (select count(*) from public.lessons) as lessons,
  (select count(*) from public.sessions where session_type is null) as retired_sessions,
  (select count(*) from public.lesson_requests where status = 'pending') as pending_lesson_requests_no_longer_shown,
  (select count(*) from public.messages) as messages_kept_but_hidden,
  (select count(*) from public.coach_notes) as coach_notes_kept_but_hidden;
