-- Coach earnings: commission and paid status on lessons, and the club commission rules.
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.lessons
  add column if not exists commission_cents int check (commission_cents is null or commission_cents >= 0),
  add column if not exists paid_at timestamptz;

-- What a club takes from lessons at its courts. Coaches read it; only admins change it; players never see it.
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  place text not null,
  percent numeric(5,2) not null default 0 check (percent >= 0 and percent <= 100),
  per_hour_cents int not null default 0 check (per_hour_cents >= 0),
  per_lesson_cents int not null default 0 check (per_lesson_cents >= 0),
  created_at timestamptz not null default now()
);
alter table public.commission_rules enable row level security;
drop policy if exists commission_rules_read on public.commission_rules;
create policy commission_rules_read on public.commission_rules for select to authenticated using (public.is_staff());
drop policy if exists commission_rules_write on public.commission_rules;
create policy commission_rules_write on public.commission_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.commission_rules from anon;
grant select, insert, update, delete on public.commission_rules to authenticated;

-- Should show commission_cents and paid_at, then an empty commission_rules table.
select column_name from information_schema.columns where table_name = 'lessons' and column_name in ('commission_cents', 'paid_at');
select * from public.commission_rules;
