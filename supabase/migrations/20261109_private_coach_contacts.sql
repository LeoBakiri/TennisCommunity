-- Coach and admin profiles were readable in full by anyone, email and phone included.
-- Now only staff see other people's profiles; everyone else gets coach names through staff_names().
-- Run once in Supabase → SQL Editor. Safe to run again.

create or replace function public.staff_names()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select id, full_name, role from public.profiles where role in ('coach','admin')
$$;
grant execute on function public.staff_names() to anon, authenticated;

-- profiles: yourself, and staff see everyone
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_staff());
