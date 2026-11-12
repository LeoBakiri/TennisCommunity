-- Club commission by group size, and Balboa's real rates.
-- Balboa takes $25 an hour for 4 players or fewer, and 30% for 5 or more.
-- It applies to private and semi-private lessons and to community sessions at Balboa.
-- Safe to run more than once.

alter table public.commission_rules add column if not exists max_players int check (max_players is null or max_players >= 1);

-- Balboa's two rates, only if no Balboa rate has been set yet.
insert into public.commission_rules (place, percent, per_hour_cents, per_lesson_cents, max_players)
select place, percent, per_hour_cents, per_lesson_cents, max_players
from (values ('Balboa', 0::numeric, 2500, 0, 4), ('Balboa', 30::numeric, 0, 0, null::int)) as v(place, percent, per_hour_cents, per_lesson_cents, max_players)
where not exists (select 1 from public.commission_rules where place ilike '%balboa%' and (percent > 0 or per_hour_cents > 0 or per_lesson_cents > 0));

-- Should show two Balboa rows: $25/hour up to 4 players, and 30% with no limit.
select place, percent, per_hour_cents, per_lesson_cents, max_players from public.commission_rules order by max_players nulls last;
