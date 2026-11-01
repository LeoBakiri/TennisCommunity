-- The google-calendar function reads and writes these tables with the service role.
-- Newer Supabase projects don't grant the service role table access by default.
grant select on public.profiles, public.sessions, public.lessons to service_role;
grant select, insert, update, delete on public.coach_calendars, public.coach_google_tokens, public.calendar_event_links, public.calendar_sync_queue to service_role;
