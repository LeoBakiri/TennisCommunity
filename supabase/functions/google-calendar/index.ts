// Connects each coach's Google Calendar and pushes platform changes to it.
// See supabase/GOOGLE_CALENDAR_SETUP.md for the secrets and how to deploy.
//   GET  ?code=…&state=…        Google's redirect after a coach grants access
//   POST { action: "start" }       signed-in coach: returns the Google consent URL
//   POST { action: "disconnect" }  signed-in coach: removes upcoming events and the token
//   POST { action: "sync" }        signed-in coach or admin, or the cron job: works through the queue
import { backoffMinutes, GoogleError, ReconnectNeeded, signState, syncSource, verifyState, type EventLink, type GoogleApi, type GoogleEvent, type SourceType, type SyncDeps } from "../_shared/calendarSync.ts";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): void };

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_ID = env("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = env("GOOGLE_CLIENT_SECRET");
const APP_URL = env("APP_URL").replace(/\/+$/, "");
const CRON_SECRET = env("CRON_SECRET");
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar`;
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";
const BATCH = 40;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ───────────────────────── database (service role) ─────────────────────────

async function db<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`Database ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
const upsertRow = (table: string, row: unknown, conflict: string) =>
  db(`${table}?on_conflict=${conflict}`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });

// ───────────────────────── Google ─────────────────────────

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  return { ok: res.ok, body: (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string } };
}

function googleClient(accessToken: () => Promise<string>): GoogleApi {
  const call = async (method: string, path: string, body?: GoogleEvent) => {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new GoogleError(res.status, `Google ${method} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : ((await res.json()) as { id: string });
  };
  const events = (calendarId: string, id?: string) => `${encodeURIComponent(calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;
  return {
    insert: async (calendarId, id, event) => (await call("POST", events(calendarId), { ...event, id } as GoogleEvent))!,
    update: async (calendarId, id, event) => (await call("PUT", events(calendarId, id), event))!,
    remove: async (calendarId, id) => void (await call("DELETE", events(calendarId, id))),
  };
}

function makeDeps(): SyncDeps {
  const tokens = new Map<string, Promise<string>>();
  const accessToken = (coachId: string, refreshToken: string) => {
    if (!tokens.has(coachId)) {
      tokens.set(
        coachId,
        tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }).then(({ ok, body }) => {
          if (ok && body.access_token) return body.access_token;
          if (body.error === "invalid_grant") throw new ReconnectNeeded("Google access expired or was revoked.");
          throw new Error(`Google token: ${body.error ?? "request failed"}`);
        }),
      );
    }
    return tokens.get(coachId)!;
  };
  return {
    loadSource: async (type, id) => (await db<never[]>(`${type === "session" ? "sessions" : "lessons"}?id=eq.${id}&select=*`))[0] ?? null,
    listLinks: (type, id) => db<EventLink[]>(`calendar_event_links?source_type=eq.${type}&source_id=eq.${id}&select=*`),
    saveLink: (link) => upsertRow("calendar_event_links", { ...link, updated_at: new Date().toISOString() }, "source_type,source_id,coach_id").then(() => undefined),
    deleteLink: (l) => db(`calendar_event_links?source_type=eq.${l.source_type}&source_id=eq.${l.source_id}&coach_id=eq.${l.coach_id}`, { method: "DELETE" }).then(() => undefined),
    connection: async (coachId) => {
      const [cal] = await db<{ status: string }[]>(`coach_calendars?coach_id=eq.${coachId}&select=status`);
      if (!cal) return "none";
      if (cal.status !== "connected") return "reconnect";
      const [tok] = await db<{ refresh_token: string }[]>(`coach_google_tokens?coach_id=eq.${coachId}&select=refresh_token`);
      if (!tok) return "reconnect";
      return googleClient(() => accessToken(coachId, tok.refresh_token));
    },
    markSynced: (coachId) => db(`coach_calendars?coach_id=eq.${coachId}`, { method: "PATCH", body: JSON.stringify({ last_synced_at: new Date().toISOString(), last_error: "" }) }).then(() => undefined),
    markReconnect: (coachId, reason) => db(`coach_calendars?coach_id=eq.${coachId}`, { method: "PATCH", body: JSON.stringify({ status: "needs_reconnect", last_error: reason }) }).then(() => undefined),
  };
}

// ───────────────────────── queue ─────────────────────────

interface QueueRow {
  source_type: SourceType;
  source_id: string;
  enqueued_at: string;
  attempts: number;
}

async function drainQueue() {
  const rows = await db<QueueRow[]>(`calendar_sync_queue?next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}&order=enqueued_at&limit=${BATCH}&select=source_type,source_id,enqueued_at,attempts`);
  const deps = makeDeps();
  let failed = 0;
  for (const q of rows) {
    const where = `source_type=eq.${q.source_type}&source_id=eq.${q.source_id}`;
    let errors: string[];
    try {
      errors = await syncSource(deps, q.source_type, q.source_id);
    } catch (e) {
      errors = [e instanceof Error ? e.message : String(e)];
    }
    if (errors.length) {
      failed++;
      const attempts = q.attempts + 1;
      await db(`calendar_sync_queue?${where}`, { method: "PATCH", body: JSON.stringify({ attempts, last_error: errors.join("; ").slice(0, 1000), next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60000).toISOString() }) });
    } else {
      // Only clear the row if nothing changed while we worked; a newer change keeps it queued.
      await db(`calendar_sync_queue?${where}&enqueued_at=eq.${encodeURIComponent(q.enqueued_at)}`, { method: "DELETE" });
    }
  }
  return { processed: rows.length, failed };
}

// ───────────────────────── connect / disconnect ─────────────────────────

async function currentCoach(req: Request): Promise<{ id: string; role: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!res.ok) return null;
  const { id } = (await res.json()) as { id: string };
  const [p] = await db<{ id: string; role: string }[]>(`profiles?id=eq.${id}&status=eq.active&select=id,role`);
  return p && (p.role === "coach" || p.role === "admin") ? p : null;
}

async function startConnect(coachId: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: await signState(CLIENT_SECRET, coachId),
  }).toString();
  return url.toString();
}

async function finishConnect(code: string, coachId: string): Promise<string> {
  const { ok, body } = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
  if (!ok || !body.refresh_token) {
    console.error("Google token exchange failed", body.error ?? "no refresh token", body.error_description ?? "");
    return "failed";
  }
  if (!body.scope?.includes("calendar.events")) return "denied";
  // The ID token came straight from Google over TLS, so its payload can be read without verifying it.
  const email = body.id_token ? (JSON.parse(atob(body.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string }).email ?? "" : "";
  await upsertRow("coach_google_tokens", { coach_id: coachId, refresh_token: body.refresh_token, updated_at: new Date().toISOString() }, "coach_id");
  await upsertRow("coach_calendars", { coach_id: coachId, google_email: email, status: "connected", last_error: "", connected_at: new Date().toISOString() }, "coach_id");
  await db("rpc/calendar_enqueue_coach", { method: "POST", body: JSON.stringify({ p_coach: coachId }) });
  await drainQueue();
  return "connected";
}

async function disconnect(coachId: string) {
  const deps = makeDeps();
  const conn = await deps.connection(coachId);
  const links = await db<(EventLink & { source_type: SourceType })[]>(`calendar_event_links?coach_id=eq.${coachId}&select=*`);
  if (conn !== "none" && conn !== "reconnect") {
    // Upcoming events come off the calendar; past ones stay as a record.
    const upcoming = async (l: EventLink) => {
      const row = (await deps.loadSource(l.source_type, l.source_id)) as { ends_at: string } | null;
      return !row || row.ends_at > new Date().toISOString();
    };
    for (const l of links) {
      if (await upcoming(l)) await conn.remove(l.calendar_id, l.google_event_id).catch(() => undefined);
    }
  }
  const [tok] = await db<{ refresh_token: string }[]>(`coach_google_tokens?coach_id=eq.${coachId}&select=refresh_token`);
  if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.refresh_token)}`, { method: "POST" }).catch(() => undefined);
  await db(`calendar_event_links?coach_id=eq.${coachId}`, { method: "DELETE" });
  await db(`coach_google_tokens?coach_id=eq.${coachId}`, { method: "DELETE" });
  await db(`coach_calendars?coach_id=eq.${coachId}`, { method: "DELETE" });
}

// ───────────────────────── entry point ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      const coachId = await verifyState(CLIENT_SECRET, q.get("state") ?? "");
      if (!coachId) console.error("Google callback had an invalid or expired state");
      const result = !coachId ? "failed" : q.get("code") ? await finishConnect(q.get("code")!, coachId) : "denied";
      return Response.redirect(`${APP_URL}/#/coach?google=${result}`, 302);
    }
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    if (action === "sync" && req.headers.get("x-cron-secret") === CRON_SECRET) return json(await drainQueue());
    const coach = await currentCoach(req);
    if (!coach) return json({ error: "Coaches only." }, 403);
    if (action === "start") return json({ url: await startConnect(coach.id) });
    if (action === "disconnect") {
      await disconnect(coach.id);
      return json({ ok: true });
    }
    if (action === "sync") return json(await drainQueue());
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Calendar sync failed." }, 500);
  }
});
