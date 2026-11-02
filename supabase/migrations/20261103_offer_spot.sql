-- Offer your spot: inside the cancellation window players can't cancel a booked spot.
-- They offer it instead. Whoever takes it gets the seat and the first player is let off;
-- if nobody takes it before the start, the first player keeps the booking and pays.
-- Run once in Supabase → SQL Editor. Safe to run again.

alter table public.bookings add column if not exists spot_offered_at timestamptz;

-- Coaches may still only record attendance; the offer is changed through the functions below.
create or replace function public.guard_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ltc.internal', true), '') = '1' or public.is_admin() then
    return new;
  end if;
  -- Coaches may record attendance only.
  new.id := old.id; new.session_id := old.session_id; new.user_id := old.user_id;
  new.status := old.status; new.seats := old.seats; new.waitlist_position := old.waitlist_position;
  new.guest_name := old.guest_name; new.guest_email := old.guest_email;
  new.late_cancel := old.late_cancel; new.cancel_reason := old.cancel_reason;
  new.created_at := old.created_at; new.cancelled_at := old.cancelled_at;
  new.spot_offered_at := old.spot_offered_at;
  new.updated_at := now();
  return new;
end $$;

-- Seat counts now include how many booked spots are on offer.
drop function if exists public.session_stats(uuid[]);
create function public.session_stats(ids uuid[])
returns table (session_id uuid, booked int, waitlist int, pending int, offered int)
language sql stable security definer set search_path = public as $$
  select s.id,
         coalesce(sum(b.seats) filter (where b.status in ('confirmed','pending')), 0)::int,
         count(b.id) filter (where b.status = 'waitlisted')::int,
         count(b.id) filter (where b.status = 'pending')::int,
         count(b.id) filter (where b.status = 'confirmed' and b.spot_offered_at is not null)::int
  from unnest(ids) as s(id)
  left join public.bookings b on b.session_id = s.id
  group by s.id
$$;
grant execute on function public.session_stats(uuid[]) to anon, authenticated;

-- Cancel a booking and promote from the waitlist. Inside the window, players can't cancel a booked spot.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default '', p_late boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  s public.sessions;
  cfg public.settings;
  me uuid := auth.uid();
  staff boolean;
  hrs int;
  free int;
  w record;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  select * into s from public.sessions where id = b.session_id for update;
  staff := public.coaches_session(s.id);
  if b.user_id <> me and not staff then raise exception 'You can only cancel your own bookings.'; end if;
  if b.status not in ('confirmed','waitlisted') then raise exception 'This booking is already cancelled.'; end if;
  if s.starts_at <= now() and not staff then raise exception 'This session has already started.'; end if;

  select * into cfg from public.settings where id = 'default';
  hrs := coalesce(cfg.cancellation_window_hours, 24);
  if not staff and b.status = 'confirmed' and s.starts_at - now() < make_interval(hours => hrs) then
    raise exception 'It''s less than % hours to the session, so you can''t cancel. Offer your spot instead.', hrs;
  end if;

  perform set_config('ltc.internal', '1', true);
  update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
    cancel_reason = coalesce(nullif(p_reason, ''), case when staff and b.user_id <> me then 'Cancelled by coach' else 'Cancelled by player' end),
    late_cancel = false, waitlist_position = null
  where id = b.id;

  if s.status = 'published' then
    select s.capacity - coalesce(sum(x.seats), 0) into free from public.bookings x
      where x.session_id = s.id and x.status = 'confirmed';
    for w in select * from public.bookings where session_id = s.id and status = 'waitlisted' order by waitlist_position, created_at loop
      exit when free <= 0;
      continue when w.seats > free;
      update public.bookings set status = 'confirmed', waitlist_position = null, updated_at = now() where id = w.id;
      free := free - w.seats;
    end loop;
  end if;

  -- renumber the remaining waitlist
  update public.bookings x set waitlist_position = r.rn
    from (select id, row_number() over (order by waitlist_position, created_at) rn
          from public.bookings where session_id = s.id and status = 'waitlisted') r
    where x.id = r.id;
  perform set_config('ltc.internal', '', true);
end $$;

-- A booked player puts their spot on offer. They stay booked until someone takes it.
create or replace function public.offer_spot(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  s public.sessions;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.user_id <> auth.uid() then raise exception 'Booking not found.'; end if;
  if b.status <> 'confirmed' then raise exception 'Only a booked spot can be offered.'; end if;
  select * into s from public.sessions where id = b.session_id;
  if s.status <> 'published' or s.starts_at <= now() then raise exception 'This session has already started.'; end if;
  if b.spot_offered_at is not null then return; end if;
  perform set_config('ltc.internal', '1', true);
  update public.bookings set spot_offered_at = now(), updated_at = now() where id = b.id;
  perform set_config('ltc.internal', '', true);
end $$;

-- Take the offer back, as long as nobody has taken the spot yet.
create or replace function public.withdraw_offer(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.user_id <> auth.uid() then raise exception 'Booking not found.'; end if;
  -- Same lock order as take_offered_spot: session first, then the booking.
  perform 1 from public.sessions where id = b.session_id for update;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status <> 'confirmed' then raise exception 'Someone has already taken your spot.'; end if;
  perform set_config('ltc.internal', '1', true);
  update public.bookings set spot_offered_at = null, updated_at = now() where id = b.id;
  perform set_config('ltc.internal', '', true);
end $$;

-- Take an offered spot. The first to tap gets it; the player who offered it is cancelled with no charge.
create or replace function public.take_offered_spot(p_session_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_name text;
  s public.sessions;
  mine public.bookings;
  o public.bookings;
  b public.bookings;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select full_name into my_name from public.profiles where id = me and status = 'active';
  if not found then raise exception 'Please complete your profile first.'; end if;

  select * into s from public.sessions where id = p_session_id for update;
  if not found or s.session_type is null then raise exception 'Session not found.'; end if;
  if s.status <> 'published' or s.starts_at <= now() then raise exception 'This session has already started.'; end if;

  select * into mine from public.bookings where session_id = s.id and user_id = me and status in ('confirmed','waitlisted');
  if found and mine.status = 'confirmed' then raise exception 'You''re already booked into this session.'; end if;

  select * into o from public.bookings
    where session_id = s.id and status = 'confirmed' and spot_offered_at is not null and user_id <> me
    order by spot_offered_at, created_at limit 1 for update;
  if not found then raise exception 'Someone else just took this spot.'; end if;

  perform set_config('ltc.internal', '1', true);
  update public.bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
    cancel_reason = 'Handed over to ' || my_name, late_cancel = false, waitlist_position = null
  where id = o.id;

  if mine.id is not null then
    update public.bookings set status = 'confirmed', waitlist_position = null, updated_at = now()
      where id = mine.id returning * into b;
  else
    insert into public.bookings (session_id, user_id, status, seats, waitlist_position)
      values (s.id, me, 'confirmed', 1, null) returning * into b;
  end if;

  update public.bookings x set waitlist_position = r.rn
    from (select id, row_number() over (order by waitlist_position, created_at) rn
          from public.bookings where session_id = s.id and status = 'waitlisted') r
    where x.id = r.id;
  perform set_config('ltc.internal', '', true);
  return b;
end $$;

revoke execute on function public.offer_spot(uuid), public.withdraw_offer(uuid), public.take_offered_spot(uuid) from anon, public;
grant execute on function public.offer_spot(uuid), public.withdraw_offer(uuid), public.take_offered_spot(uuid) to authenticated;

-- Should show spot_offered_at, then the three new functions.
select column_name from information_schema.columns where table_name = 'bookings' and column_name = 'spot_offered_at';
select proname from pg_proc where proname in ('offer_spot', 'withdraw_offer', 'take_offered_spot');
