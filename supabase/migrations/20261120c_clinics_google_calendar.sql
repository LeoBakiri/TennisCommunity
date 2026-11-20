-- Club clinics on the coach's Google Calendar: each clinic is one weekly event; covered nights are left out.
-- Run once in Supabase → SQL Editor after 20261120b_club_clinics.sql. Safe to run again.

alter table public.calendar_event_links drop constraint if exists calendar_event_links_source_type_check;
alter table public.calendar_event_links add constraint calendar_event_links_source_type_check check (source_type in ('session', 'lesson', 'clinic'));
alter table public.calendar_sync_queue drop constraint if exists calendar_sync_queue_source_type_check;
alter table public.calendar_sync_queue add constraint calendar_sync_queue_source_type_check check (source_type in ('session', 'lesson', 'clinic'));

-- A change to a clinic, or to one of its covered nights, queues that clinic.
create or replace function public.enqueue_clinic_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := case tg_table_name
    when 'clinics' then (case tg_op when 'DELETE' then old.id else new.id end)
    else (case tg_op when 'DELETE' then old.clinic_id else new.clinic_id end) end;
begin
  insert into public.calendar_sync_queue (source_type, source_id) values ('clinic', cid)
    on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';
  return null;
end $$;
drop trigger if exists clinics_calendar_sync on public.clinics;
create trigger clinics_calendar_sync after insert or update or delete on public.clinics
  for each row execute function public.enqueue_clinic_sync();
drop trigger if exists clinic_covers_calendar_sync on public.clinic_covers;
create trigger clinic_covers_calendar_sync after insert or update or delete on public.clinic_covers
  for each row execute function public.enqueue_clinic_sync();

-- Connecting a calendar also brings over the coach's running clinics.
create or replace function public.calendar_enqueue_coach(p_coach uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.calendar_sync_queue (source_type, source_id)
    select 'session', id from public.sessions where p_coach = any (coach_ids) and session_type is not null and status = 'published' and ends_at > now()
    union select 'lesson', id from public.lessons where coach_id = p_coach and ends_at > now()
    union select 'clinic', id from public.clinics where coach_id = p_coach and (ends_on is null or ends_on >= current_date)
    union select source_type, source_id from public.calendar_event_links where coach_id = p_coach
  on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';
$$;
revoke execute on function public.calendar_enqueue_coach(uuid) from public, anon, authenticated;
grant execute on function public.calendar_enqueue_coach(uuid) to service_role;

-- Queue the clinics that already exist.
insert into public.calendar_sync_queue (source_type, source_id)
  select 'clinic', id from public.clinics
  on conflict (source_type, source_id) do update set enqueued_at = now(), next_attempt_at = now(), attempts = 0, last_error = '';

-- Should list the clinics waiting to sync.
select q.source_type, c.title from public.calendar_sync_queue q join public.clinics c on c.id = q.source_id where q.source_type = 'clinic';
