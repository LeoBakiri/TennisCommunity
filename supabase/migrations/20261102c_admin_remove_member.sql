-- Lets an admin remove a member from the website, including the login the browser can't reach.
create or replace function public.admin_remove_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  removed_email text;
  b record;
begin
  if not public.is_admin() then raise exception 'Administrators only.'; end if;
  if p_user_id = auth.uid() then raise exception 'You can''t remove your own account.'; end if;
  select email into removed_email from public.profiles where id = p_user_id;
  if not found then raise exception 'Member not found.'; end if;

  -- Cancelling first moves the next player in from the waitlist.
  for b in
    select x.id from public.bookings x join public.sessions s on s.id = x.session_id
    where x.user_id = p_user_id and x.status in ('confirmed','waitlisted') and s.starts_at > now()
  loop
    perform public.cancel_booking(b.id, 'Member removed', false);
  end loop;

  -- coach_ids is a plain array, so deleting a profile would not clear it.
  update public.sessions set coach_ids = array_remove(coach_ids, p_user_id) where p_user_id = any (coach_ids);
  delete from public.admin_emails where lower(email) = lower(removed_email);
  -- Bookings, lessons, calendar data and retired player data cascade from profiles.
  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end $$;

revoke execute on function public.admin_remove_member(uuid) from anon, public;
grant execute on function public.admin_remove_member(uuid) to authenticated;
