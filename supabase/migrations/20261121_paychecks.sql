-- Paychecks: what actually reached the coach's bank for one BTC payroll, after tax. The coach types it in after each payday.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.paychecks (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  payday date not null, -- the 5th or the 20th
  take_home_cents integer not null check (take_home_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists paychecks_coach_payday on public.paychecks (coach_id, payday);

-- The coach's own, like lessons: admins can read them; only the coach changes them.
alter table public.paychecks enable row level security;
drop policy if exists paychecks_read on public.paychecks;
create policy paychecks_read on public.paychecks for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists paychecks_insert on public.paychecks;
create policy paychecks_insert on public.paychecks for insert to authenticated with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists paychecks_update on public.paychecks;
create policy paychecks_update on public.paychecks for update to authenticated using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff());
drop policy if exists paychecks_delete on public.paychecks;
create policy paychecks_delete on public.paychecks for delete to authenticated using (coach_id = auth.uid() and public.is_staff());
revoke all on public.paychecks from anon;
grant select, insert, update, delete on public.paychecks to authenticated;
grant all on public.paychecks to service_role;

-- Should list the table.
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'paychecks';
