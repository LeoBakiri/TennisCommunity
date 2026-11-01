# Rolling out the simplified platform

Do the first two parts together: the new site needs the new database, and the old site can't book once the migration has run.

## 1. Database

Run `supabase/migrations/20261102_simplify_platform.sql`, then `20261102b_service_role_grants.sql`, in Supabase → SQL Editor. It finishes by showing counts: check that they look right. It deletes nothing; retired tables stay in place, unused.

## 2. Website

```bash
npm run build
```

Then publish `docs/` the way you normally do.

The site works from this point. Coaches see **Connect Google Calendar**, but it won't work until part 3 is done.

## 3. Google Calendar

### Create the Google credentials

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project and enable the **Google Calendar API**.
2. Under **Google Auth Platform → Audience**, choose **External** and then **Publish app**. Stay out of "Testing" mode: Google cancels access after 7 days there, so every coach would have to reconnect weekly.
3. Under **Data Access**, add the scopes `openid`, `email` and `.../auth/calendar.events`.
4. Under **Clients**, create a **Web application** client with this authorized redirect URI:

   ```
   https://nqcrhliobtulrjryfcme.supabase.co/functions/v1/google-calendar
   ```

Publishing needs a home page and a privacy policy link (`https://leobakiri.github.io/TennisCommunity/privacy.html`) under **Branding**.

Until Google verifies the app, coaches see an "unverified app" warning and must click **Advanced → Continue**. Google limits unverified apps to 100 users in total, which is plenty for a coaching team, so verification is optional.

### Set the secrets and deploy the function

```bash
npx supabase login
```

```bash
npx supabase secrets set --project-ref nqcrhliobtulrjryfcme GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... APP_URL=https://leobakiri.github.io/TennisCommunity CRON_SECRET=choose-a-long-random-string
```

```bash
npx supabase functions deploy google-calendar --project-ref nqcrhliobtulrjryfcme --no-verify-jwt
```

Without the CLI, you can paste a bundled copy into Supabase → Edge Functions, then turn off **Verify JWT with legacy secret** under the function's Settings. `--no-verify-jwt` is required because Google's redirect carries no Supabase login. The function checks the login itself for every other request.

`APP_URL` is the address of the live site, without a trailing slash or `#`.

### Schedule retries

The site asks for a sync right after each change. This job catches anything that failed, such as a Google outage. Enable the `pg_cron` and `pg_net` extensions in Supabase → Database → Extensions, then run this in the SQL Editor with your own `CRON_SECRET`:

```sql
select cron.schedule('google-calendar-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://nqcrhliobtulrjryfcme.supabase.co/functions/v1/google-calendar',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    body := '{"action": "sync"}'::jsonb
  );
$$);
```

### Try it

1. Sign in as a coach and open **My Schedule**.
2. Click **Connect Google Calendar**, and approve access.
3. Add a private lesson and check that it appears on your Google Calendar.
4. Change its time and check that the same event moves.
5. Delete it and check that the event disappears.

## How the sync behaves

- It runs one way, from the platform to Google. Supabase is the source of truth, so a change made directly to one of these events in Google is overwritten the next time that session or lesson changes.
- Each coach's event ID is stored in `calendar_event_links`, so updates change the existing event.
- Drafts and cancelled sessions don't appear on calendars. Unpublishing or cancelling removes the event.
- Booking counts aren't part of the event, so players booking don't generate calendar updates.
- If a coach revokes access, My Schedule asks them to reconnect. Reconnecting catches up on everything missed.
- To check for problems, look at `calendar_sync_queue` in Supabase: rows that stay there have a `last_error`.
