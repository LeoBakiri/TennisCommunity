# Coach assistant setup

The Assistant button on the coach pages talks to Claude through the `coach-assistant` Edge Function.
The function holds the API key, the assistant's instructions and its list of tools. Everything the
assistant looks up or changes runs in the coach's browser with the coach's own sign-in, so it can
only see and change what that coach can, and every change waits for the coach to tap Confirm.

**Who has it:** only the admin's coach pages show the button, and the function refuses everyone
else, because every question is paid for from the club's Claude account. To open it to all
coaches, accept role `coach` in `currentCoach()` in the function and in `canUseAssistant` in
`src/core/assistant.ts`, then redeploy both.

## 1. Get an API key

1. Go to https://platform.claude.com and sign in (or create an account).
2. Add a payment method and some credit under **Billing**. Set a monthly spend limit there too.
3. Under **API keys**, create a key named "El Patio coach assistant" and copy it. It starts with `sk-ant-`.

## 2. Add the function in Supabase

1. Supabase dashboard → **Edge Functions** → **Deploy a new function** → name it exactly `coach-assistant`.
2. Paste the whole of `supabase/functions/coach-assistant/index.ts` and deploy.
3. Leave **Verify JWT** on: only signed-in people can call it, and the function itself checks they are the admin.
4. **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY` with the key from step 1.

Nothing changes in the database: there is no migration to run.

## 3. Try it

Sign in as the admin, switch to Coach, open My Schedule, tap **Assistant** and ask "What's on tomorrow?".
If it says it isn't set up yet, the secret is missing or the key was not accepted.

## Cost and model

It uses Claude Opus 5.5. A typical question costs a few cents (it reads the coach's schedule or
client list, then answers). Usage shows in the Claude console, and each call logs its token counts
in the function's logs in Supabase.

To keep costs low, add a secret `ASSISTANT_MODEL` set to `claude-haiku-5-5` (Edge Functions →
Secrets; it takes effect on the next question, no redeploy). That is well under a cent a question:
fine for look-ups and message drafts, weaker on anything tricky such as a long run of bookings.
Delete the secret to go back to Opus.

## What is sent to Claude

What the coach types, plus what the assistant looks up to answer: the coach's schedule, the names
of players booked into their sessions, their client cards (name, level, goals, notes), lesson
prices and earnings. Phone numbers and email addresses are not sent; the WhatsApp button on a
drafted message is filled in by the portal.
