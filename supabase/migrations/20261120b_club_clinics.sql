-- Club clinics: a class the club runs every week (e.g. a BTC Legacy Clinic) that pays the coach a flat amount.
-- No players or commission: the club pays the coach through its payroll. The weekly dates are worked out in the app,
-- so a clinic never runs out of weeks. A night someone else takes is saved in clinic_covers and pays nothing.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  title text not null check (length(trim(title)) > 0),
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Monday
  start_time text not null check (start_time ~ '^\d{2}:\d{2}$'), -- Pacific
  duration_min integer not null check (duration_min between 15 and 600),
  pay_cents integer not null check (pay_cents >= 0), -- before tax, per clinic
  location text not null default '',
  starts_on date not null,
  ends_on date, -- last week it runs; null keeps going
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinic_covers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on update cascade on delete cascade,
  day date not null,
  covered_by text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists clinic_covers_day on public.clinic_covers (clinic_id, day);

-- Like lessons: the coach's own. Admins can read them; only the coach changes them.
alter table public.clinics enable row level security;
alter table public.clinic_covers enable row level security;
do $$
declare t text;
begin
  foreach t in array array['clinics', 'clinic_covers'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using ((coach_id = auth.uid() and public.is_staff()) or public.is_admin())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (coach_id = auth.uid() and public.is_staff())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (coach_id = auth.uid() and public.is_staff()) with check (coach_id = auth.uid() and public.is_staff())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (coach_id = auth.uid() and public.is_staff())', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
    execute format('grant all on public.%1$s to service_role', t);
  end loop;
end $$;

-- Should list both tables.
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('clinics', 'clinic_covers');
