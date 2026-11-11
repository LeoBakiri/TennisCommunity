-- Two-court sessions: a Group Session over 6 players or a Performance Accelerator over 4 runs on two
-- courts and needs 10 (Group) or 6 (Accelerator) players to go ahead. Below that, a coach decides by
-- 12 hours before: run it anyway, drop to one court, or cancel.
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.sessions add column if not exists decided_at timestamptz;

-- p_choice: 'run', 'one_court' or 'cancel'. Returns how many players were moved to the waitlist
-- (one court) or cancelled (cancel).
create or replace function public.decide_session(p_session_id uuid, p_choice text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  size int;
  moved int := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not public.coaches_session(p_session_id) then raise exception 'You can only decide on your own sessions.'; end if;
  if p_choice not in ('run', 'one_court', 'cancel') then raise exception 'Unknown choice.'; end if;
  select * into s from public.sessions where id = p_session_id for update;
  if not found or s.session_type is null then raise exception 'Session not found.'; end if;
  if s.status <> 'published' then raise exception 'This session isn''t open.'; end if;
  size := case s.session_type when 'performance_accelerator' then 4 else 6 end;
  if s.capacity <= size then raise exception 'This session is already on one court.'; end if;

  perform set_config('ltc.internal', '1', true);
  if p_choice = 'cancel' then
    update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
      cancel_reason = 'Not enough players for two courts', waitlist_position = null
    where session_id = s.id and status in ('confirmed', 'waitlisted');
    get diagnostics moved = row_count;
    update public.sessions set status = 'cancelled', decided_at = now() where id = s.id;
  elsif p_choice = 'one_court' then
    -- The earliest sign-ups keep their spots; the rest go to the front of the waitlist.
    with ranked as (
      select id, row_number() over (order by created_at) rn from public.bookings
      where session_id = s.id and status = 'confirmed'
    )
    update public.bookings b set status = 'waitlisted', spot_offered_at = null, updated_at = now(), waitlist_position = -(1000 - r.rn)
    from ranked r where b.id = r.id and r.rn > size;
    get diagnostics moved = row_count;
    update public.bookings x set waitlist_position = q.rn
      from (select id, row_number() over (order by waitlist_position, created_at) rn
            from public.bookings where session_id = s.id and status = 'waitlisted') q
      where x.id = q.id;
    update public.sessions set capacity = size, decided_at = now() where id = s.id;
  else
    update public.sessions set decided_at = now() where id = s.id;
  end if;
  perform set_config('ltc.internal', '', true);
  return moved;
end $$;

grant execute on function public.decide_session(uuid, text) to authenticated;
revoke execute on function public.decide_session(uuid, text) from anon, public;
