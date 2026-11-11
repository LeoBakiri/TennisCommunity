-- CourtReserve calendars: a player saves their CourtReserve calendar link, and My Sessions
-- shows their club clinics and privates next to their El Patio sessions.
-- The link works like a password to their club bookings, so only its owner can read it.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.calendar_feeds (
  id uuid primary key references public.profiles(id) on update cascade on delete cascade, -- the player
  url text not null check (url ~* '^https://app\.courtreserve\.com/Online/PublicIcal/\S+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;
drop policy if exists calendar_feeds_own on public.calendar_feeds;
create policy calendar_feeds_own on public.calendar_feeds for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.calendar_feeds from anon;
grant select, insert, update, delete on public.calendar_feeds to authenticated;
