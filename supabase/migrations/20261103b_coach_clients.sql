-- Coach clients: a card per person a coach teaches privately (contact, level, goals, private notes).
-- Lessons still name their players; a client card matches them by name, ignoring case.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text,
  email text,
  level text not null default '',
  goals text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_coach_name on public.clients (coach_id, lower(full_name));

-- Clients belong to their coach, like lessons. Admins can read them; only the coach can change them.
alter table public.clients enable row level security;
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated using (coach_id = auth.uid() and public.is_staff());
revoke all on public.clients from anon;
grant select, insert, update, delete on public.clients to authenticated;

-- A card for everyone already named on a lesson, so the Clients page starts full.
insert into public.clients (coach_id, full_name, created_at)
select distinct on (l.coach_id, lower(trim(n))) l.coach_id, trim(n), min(l.created_at) over (partition by l.coach_id, lower(trim(n)))
from public.lessons l, unnest(l.client_names) as n
where length(trim(n)) > 0
order by l.coach_id, lower(trim(n)), l.starts_at desc
on conflict (coach_id, lower(full_name)) do nothing;

-- Should list each coach with how many clients they have.
select p.full_name as coach, count(c.id) as clients from public.clients c join public.profiles p on p.id = c.coach_id group by p.full_name;
