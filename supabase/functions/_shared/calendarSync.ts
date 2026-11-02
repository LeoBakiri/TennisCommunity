// Platform → Google Calendar sync. Supabase is the source of truth: for one session or lesson,
// work out which events should exist and make Google match. Running it twice is harmless.
// This file has no runtime-specific code, so the tests can run it against a fake Google.

export type SourceType = "session" | "lesson";

export interface SessionRow {
  id: string;
  session_type: "group" | "performance_accelerator" | null;
  title: string;
  starts_at: string;
  ends_at: string;
  coach_ids: string[];
  location: string;
  court?: number | null;
  status: string;
  description: string;
  capacity: number;
}

export interface LessonRow {
  id: string;
  coach_id: string;
  kind: "private" | "semi_private";
  client_names: string[];
  starts_at: string;
  ends_at: string;
  location: string;
  court?: number | null;
  price_cents: number | null;
  notes: string;
}

export interface GoogleEvent {
  summary: string;
  location: string;
  description: string;
  status: "confirmed";
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: { ltc_source: SourceType; ltc_id: string } };
}

export interface EventLink {
  source_type: SourceType;
  source_id: string;
  coach_id: string;
  calendar_id: string;
  google_event_id: string;
  payload: string;
}

export class GoogleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** The coach revoked access or the token expired. Retrying won't help until they reconnect. */
export class ReconnectNeeded extends Error {}

export interface GoogleApi {
  insert(calendarId: string, id: string, event: GoogleEvent): Promise<{ id: string }>;
  update(calendarId: string, id: string, event: GoogleEvent): Promise<{ id: string }>;
  remove(calendarId: string, id: string): Promise<void>;
}

export interface SyncDeps {
  loadSource(type: SourceType, id: string): Promise<SessionRow | LessonRow | null>;
  listLinks(type: SourceType, id: string): Promise<EventLink[]>;
  saveLink(link: EventLink): Promise<void>;
  deleteLink(link: EventLink): Promise<void>;
  /** A Google client for a connected coach; "none" if never connected, "reconnect" if access lapsed. */
  connection(coachId: string): Promise<GoogleApi | "none" | "reconnect">;
  markSynced(coachId: string): Promise<void>;
  markReconnect(coachId: string, reason: string): Promise<void>;
}

const TIME_ZONE = "America/Los_Angeles";
const CALENDAR_ID = "primary";

const SESSION_LABEL = { group: "Group Session", performance_accelerator: "Performance Accelerator" };
const LESSON_LABEL = { private: "Private Lesson", semi_private: "Semi-Private Lesson" };

function baseEvent(type: SourceType, id: string, row: { starts_at: string; ends_at: string; location: string; court?: number | null }) {
  return {
    location: row.court ? `${row.location} · Court ${row.court}` : row.location,
    status: "confirmed" as const,
    start: { dateTime: row.starts_at, timeZone: TIME_ZONE },
    end: { dateTime: row.ends_at, timeZone: TIME_ZONE },
    extendedProperties: { private: { ltc_source: type, ltc_id: id } },
  };
}

/** The coaches who should have this on their calendar, and what the event should say. */
export function desiredEvents(type: SourceType, row: SessionRow | LessonRow | null): { coachIds: string[]; event: GoogleEvent } | null {
  if (!row) return null;
  if (type === "lesson") {
    const l = row as LessonRow;
    const price = l.price_cents === null ? "" : `Price: $${(l.price_cents / 100).toFixed(l.price_cents % 100 ? 2 : 0)}`;
    return {
      coachIds: [l.coach_id],
      event: {
        ...baseEvent(type, l.id, l),
        summary: `${LESSON_LABEL[l.kind]}: ${l.client_names.join(", ")}`,
        description: [price, l.notes].filter(Boolean).join("\n\n"),
      },
    };
  }
  const s = row as SessionRow;
  if (!s.session_type || s.status !== "published" || !s.coach_ids.length) return null;
  const label = SESSION_LABEL[s.session_type];
  return {
    coachIds: s.coach_ids,
    event: {
      ...baseEvent(type, s.id, s),
      summary: s.session_type === "performance_accelerator" && s.title ? `${label}: ${s.title}` : label,
      description: s.description,
    },
  };
}

/**
 * A stable event id per source and coach. Choosing the id ourselves means a crash between
 * creating the event and saving its link can't produce a duplicate: the retry hits a 409.
 * Google allows a–v and 0–9, which covers the hex digits of a UUID.
 */
export function eventIdFor(type: SourceType, sourceId: string, coachId: string): string {
  return `${type === "session" ? "s" : "l"}${sourceId.replace(/-/g, "")}${coachId.replace(/-/g, "")}`.toLowerCase();
}

async function upsert(api: GoogleApi, link: EventLink | undefined, id: string, event: GoogleEvent): Promise<string> {
  if (link) {
    try {
      return (await api.update(link.calendar_id, link.google_event_id, event)).id;
    } catch (e) {
      if (!(e instanceof GoogleError) || e.status !== 404) throw e;
    }
  }
  try {
    return (await api.insert(CALENDAR_ID, id, event)).id;
  } catch (e) {
    // Already exists, possibly deleted in Google. Updating it with status "confirmed" restores it.
    if (e instanceof GoogleError && e.status === 409) return (await api.update(CALENDAR_ID, id, event)).id;
    throw e;
  }
}

async function removeEvent(api: GoogleApi, link: EventLink) {
  try {
    await api.remove(link.calendar_id, link.google_event_id);
  } catch (e) {
    if (!(e instanceof GoogleError) || (e.status !== 404 && e.status !== 410)) throw e;
  }
}

/** Make Google match one source row. Returns the errors worth retrying; an empty list means done. */
export async function syncSource(deps: SyncDeps, type: SourceType, sourceId: string): Promise<string[]> {
  const desired = desiredEvents(type, await deps.loadSource(type, sourceId));
  const wanted = desired?.coachIds ?? [];
  const links = await deps.listLinks(type, sourceId);
  const errors: string[] = [];

  const forCoach = async (coachId: string, work: (api: GoogleApi | "none") => Promise<void>) => {
    try {
      const conn = await deps.connection(coachId);
      // Access lapsed: leave everything as is. Reconnecting queues this source again.
      if (conn === "reconnect") return;
      await work(conn);
    } catch (e) {
      if (e instanceof ReconnectNeeded) await deps.markReconnect(coachId, e.message);
      else errors.push(`${coachId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  for (const link of links.filter((l) => !wanted.includes(l.coach_id))) {
    await forCoach(link.coach_id, async (api) => {
      if (api !== "none") await removeEvent(api, link);
      await deps.deleteLink(link);
      if (api !== "none") await deps.markSynced(link.coach_id);
    });
  }

  for (const coachId of wanted) {
    await forCoach(coachId, async (api) => {
      if (api === "none") return;
      const link = links.find((l) => l.coach_id === coachId);
      const payload = JSON.stringify(desired!.event);
      if (link?.payload === payload) return;
      const googleId = await upsert(api, link, eventIdFor(type, sourceId, coachId), desired!.event);
      await deps.saveLink({ source_type: type, source_id: sourceId, coach_id: coachId, calendar_id: link?.calendar_id ?? CALENDAR_ID, google_event_id: googleId, payload });
      await deps.markSynced(coachId);
    });
  }
  return errors;
}

/** Minutes to wait before retry number `attempts`: 1, 2, 4 … capped at six hours. */
export function backoffMinutes(attempts: number): number {
  return Math.min(360, 2 ** Math.max(0, attempts - 1));
}

// ───────────────────────── OAuth state ─────────────────────────
// Signed so the Google callback can trust which coach started the connection.

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

export async function signState(secret: string, coachId: string, now = Date.now()): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ c: coachId, e: now + 15 * 60000 })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<string | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(secret, body)) !== sig) return null;
  const { c, e } = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { c: string; e: number };
  return e > now ? c : null;
}
