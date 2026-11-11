// Fetches the signed-in player's CourtReserve calendar for My Sessions.
// CourtReserve doesn't let browsers read its feeds directly, so the app asks this function.
//   POST {}  signed-in player: returns { ics } from the link they saved in calendar_feeds
// Deploy: Supabase → Edge Functions → new function "courtreserve-feed", paste this file.
// It only uses the built-in SUPABASE_URL and SUPABASE_ANON_KEY secrets.

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Kept in step with cleanFeedUrl in src/core/ical.ts and the calendar_feeds check.
const FEED_PATH = /^https:\/\/app\.courtreserve\.com\/Online\/PublicIcal\/\S+$/i;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 6_000;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Please sign in first." }, 401);

  // Read with the player's own token, so the row-level rules only hand back their link.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/calendar_feeds?select=url&limit=1`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  if (res.status === 401) return json({ error: "Please sign in first." }, 401);
  if (!res.ok) return json({ error: "Couldn't read your saved link." }, 500);
  const [row] = (await res.json()) as { url: string }[];
  if (!row) return json({ error: "No CourtReserve calendar is connected." }, 404);
  if (!FEED_PATH.test(row.url)) return json({ error: "That isn't a CourtReserve calendar link." }, 400);

  try {
    const feed = await fetch(row.url, { headers: { Accept: "text/calendar" }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!feed.ok) return json({ error: `CourtReserve answered ${feed.status}.` }, 502);
    const ics = await feed.text();
    if (ics.length > MAX_BYTES) return json({ error: "That calendar is too large to show." }, 502);
    if (!ics.includes("BEGIN:VCALENDAR")) return json({ error: "That link didn't return a calendar." }, 502);
    return json({ ics });
  } catch {
    return json({ error: "Couldn't reach CourtReserve." }, 504);
  }
});
