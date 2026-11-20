-- Paychecks: the before-tax amount from the pay stub, next to the take-home. Optional: empty uses the app's own total.
-- Run once in Supabase → SQL Editor. Safe to run again.
alter table public.paychecks add column if not exists gross_cents integer check (gross_cents >= 0);

-- Should list gross_cents.
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'paychecks' and column_name = 'gross_cents';
