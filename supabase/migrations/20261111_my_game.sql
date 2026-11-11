-- My Game: coaches note which skills got better after a session, players set a weekly goal,
-- and a monthly leaderboard ranks players by sessions played (first name and last initial only).
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.profiles add column if not exists weekly_goal int not null default 1;
alter table public.profiles drop constraint if exists profiles_weekly_goal_check;
alter table public.profiles add constraint profiles_weekly_goal_check check (weekly_goal between 1 and 3);
alter table public.profiles add column if not exists leaderboard_hidden boolean not null default false;

-- One row per player per session: the skills that moved up a level, and an optional tip.
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

-- Players read their own; the session's coaches (and admins) write it.
alter table public.feedback enable row level security;
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated with check (coach_id = auth.uid() and public.coaches_session(session_id));
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update to authenticated
  using (public.coaches_session(session_id)) with check (coach_id = auth.uid() and public.coaches_session(session_id));
drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete to authenticated using (public.coaches_session(session_id));
revoke all on public.feedback from anon;
grant select, insert, update, delete on public.feedback to authenticated;

-- Sessions played between two moments, per player. Players can't read each other's bookings
-- or profiles, so this hands out only the short name and the count.
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
revoke execute on function public.leaderboard(timestamptz, timestamptz) from anon, public;
grant execute on function public.leaderboard(timestamptz, timestamptz) to authenticated;

-- Should list the two new profile columns and the feedback table.
select table_name, column_name from information_schema.columns
where table_schema = 'public' and ((table_name = 'profiles' and column_name in ('weekly_goal','leaderboard_hidden')) or (table_name = 'feedback' and column_name = 'skills'));
