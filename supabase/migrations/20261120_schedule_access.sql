-- Schedule access: a coach (Kaan) can run the Community Schedule in Admin — create, edit,
-- publish, cancel and delete community sessions, and add, move in or remove players —
-- without anything else in Admin (coaches, members, settings, commission).
-- Admins switch it on per coach on the member page. Run once in Supabase → SQL Editor. Safe to run again.

alter table public.profiles add column if not exists schedule_access boolean not null default false;

create or replace function public.can_schedule() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'coach' and status = 'active' and schedule_access
  )
$$;
revoke execute on function public.can_schedule() from public;
grant execute on function public.can_schedule() to anon, authenticated;

-- Community sessions and their bookings.
drop policy if exists sessions_write on public.sessions;
create policy sessions_write on public.sessions for all using (public.can_schedule()) with check (public.can_schedule());
drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings for all using (public.can_schedule()) with check (public.can_schedule());

-- Removing or cancelling any player's booking (cancel_booking checks this).
create or replace function public.coaches_session(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_schedule() or exists (
    select 1 from public.sessions s where s.id = sid and auth.uid() = any (s.coach_ids) and public.is_staff()
  )
$$;

-- Booking someone else in, and the bookings column guard: swap is_admin() for can_schedule()
-- in the live definitions, so nothing else in them changes.
do $$
declare
  f text;
  src text;
begin
  foreach f in array array['public.book_session(uuid, uuid, text)', 'public.guard_bookings()'] loop
    src := pg_get_functiondef(f::regprocedure);
    if position('public.is_admin()' in src) > 0 then
      execute replace(src, 'public.is_admin()', 'public.can_schedule()');
    end if;
  end loop;
end $$;

-- Only admins can give or take away schedule access; nobody can give it to themselves.
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
    new.schedule_access := false;
    new.created_at := now();
  else
    new.id := old.id;
    new.role := old.role;
    new.status := old.status;
    new.schedule_access := old.schedule_access;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- Give Kaan schedule access if they're already a coach. The SQL editor isn't signed in,
-- so the profiles guard needs ltc.internal or it quietly undoes the change.
begin;
set local ltc.internal = '1';
update public.profiles set schedule_access = true
where role = 'coach' and lower(full_name) like 'kaan%';
commit;

select full_name, role, schedule_access from public.profiles where role in ('coach', 'admin') order by full_name;
