-- Member level: each member picks their tennis level at sign-up (Beginner, Advanced beginner,
-- Intermediate, Advanced) and can change it on their Profile; admins can set it on the member page.
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.profiles add column if not exists level text not null default '';

select count(*) as profiles, count(*) filter (where level <> '') as with_level from public.profiles;
