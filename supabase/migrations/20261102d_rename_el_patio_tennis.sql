-- The business is now El Patio Tennis. Run once in Supabase → SQL Editor.
-- The site reads its name from this row, so the live name only changes once this has run.

alter table public.settings
  alter column brand_name set default 'El Patio Tennis',
  alter column logo_mark set default 'EP';

update public.settings set
  brand_name = 'El Patio Tennis',
  logo_mark = 'EP',
  club_disclaimer = replace(club_disclaimer, 'Leo Tennis Community', 'El Patio Tennis');

-- Should show El Patio Tennis, EP, and a disclaimer starting with El Patio Tennis.
select brand_name, logo_mark, club_disclaimer from public.settings;
