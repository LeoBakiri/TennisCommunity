-- Coaches and admins can move when a short two-court session gets decided (default: 12 hours before).
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.sessions add column if not exists decide_by timestamptz;

create or replace function public.set_decide_by(p_session_id uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not public.coaches_session(p_session_id) then raise exception 'You can only change your own sessions.'; end if;
  select * into s from public.sessions where id = p_session_id;
  if not found then raise exception 'Session not found.'; end if;
  if p_at <= now() then raise exception 'Pick a time that hasn''t passed yet.'; end if;
  if p_at >= s.starts_at then raise exception 'Pick a time before the session starts.'; end if;
  update public.sessions set decide_by = p_at where id = p_session_id;
end $$;

grant execute on function public.set_decide_by(uuid, timestamptz) to authenticated;
revoke execute on function public.set_decide_by(uuid, timestamptz) from anon, public;
