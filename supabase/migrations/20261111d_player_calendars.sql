-- Player calendar links: each player gets a private link that Apple Calendar, Google Calendar
-- and Outlook subscribe to. The player-calendar function serves it with the service role.
-- Anyone with the link sees that player's bookings, so only the player can read their token.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.player_calendars (
  id uuid primary key references public.profiles(id) on update cascade on delete cascade, -- the player
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);

alter table public.player_calendars enable row level security;
drop policy if exists player_calendars_own on public.player_calendars;
create policy player_calendars_own on public.player_calendars for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.player_calendars from anon;
grant select, insert, delete on public.player_calendars to authenticated;

-- What the player-calendar function reads.
grant select on public.player_calendars, public.bookings, public.sessions, public.profiles, public.settings to service_role;
