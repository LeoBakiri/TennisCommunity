-- Leo runs the community and Kaan Ayman co-runs it. Run once in Supabase → SQL Editor.
-- Kaan's own account is promoted from the Admin portal after he signs up, so it isn't touched here.

do $$
begin
  perform set_config('ltc.internal', '1', true);

  -- Public copy. Each replace does nothing if the text has since been edited.
  update public.settings set
    hero_subtext = replace(hero_subtext, 'with coach Leo Bakiri', 'with coaches Leo Bakiri and Kaan Ayman'),
    club_disclaimer = replace(club_disclaimer, 'run by coach Leo Bakiri.', 'run by coach Leo Bakiri and co-run by coach Kaan Ayman.'),
    coach_bio = case when coach_bio like '%Kaan Ayman%' then coach_bio
                     else coach_bio || ' The community is run by Leo and co-run by coach Kaan Ayman.' end,
    updated_at = now()
  where id = 'default';

  update public.programs
    set description = replace(description, 'A focused hour with Leo on', 'A focused hour with your coach on')
  where slug = 'private-lessons';

  -- There are two "Leo Bakiri" profiles. Remove any whose login no longer exists,
  -- as long as another one with the same email still has a working login.
  delete from public.profiles p
  where lower(p.email) = 'leocanbakiri@gmail.com'
    and not exists (select 1 from auth.users u where u.id = p.id)
    and exists (select 1 from public.profiles k join auth.users u on u.id = k.id where lower(k.email) = 'leocanbakiri@gmail.com');

  update public.profiles
    set tags = array_append(array_remove(array_remove(tags, 'New'), 'Head coach'), 'Head coach')
  where lower(email) = 'leocanbakiri@gmail.com';

  perform set_config('ltc.internal', '', true);
end $$;

-- Should list exactly one Leo Bakiri, with the Head coach tag.
select id, full_name, role, tags from public.profiles where role in ('coach', 'admin');
