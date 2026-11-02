-- Balboa court numbers (1–4) on sessions and lessons.
-- Run once in Supabase → SQL Editor before publishing the site that saves courts. Safe to run again.

alter table public.sessions add column if not exists court int check (court between 1 and 4);
alter table public.lessons add column if not exists court int check (court between 1 and 4);

-- ───────────────────────── Google Calendar ─────────────────────────
-- The court shows in the calendar event's location, so a court change has to resync it.

create or replace function public.enqueue_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  src text := case tg_table_name when 'sessions' then 'session' else 'lesson' end;
  sid uuid := case tg_op when 'DELETE' then old.id else new.id end;
begin
  -- Nested, not joined with AND: these columns exist only on sessions, and AND wouldn't protect lessons.
  if tg_table_name = 'sessions' and tg_op = 'UPDATE' then
    if row(new.session_type, new.title, new.starts_at, new.ends_at, new.coach_ids, new.location, new.court, new.status, new.description)
       is not distinct from
       row(old.session_type, old.title, old.starts_at, old.ends_at, old.coach_ids, old.location, old.court, old.status, old.description) then
      return null;
    end if;
  end if;
  insert into public.calendar_sync_queue (source_type, source_id) values (src, sid)
    on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';
  return null;
end $$;

-- Should show 2.
select count(*) as court_columns from information_schema.columns
where table_schema = 'public' and column_name = 'court' and table_name in ('sessions','lessons');
