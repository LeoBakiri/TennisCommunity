// Each player's El Patio sessions as a calendar link that Apple Calendar, Google Calendar
// and Outlook subscribe to, so bookings show up on their own and cancellations disappear.
//   GET ?token=…              every session the player is booked into
//   GET ?token=…&session=…    one booked session, for a one-tap "Add to Apple Calendar"
// Deploy: Supabase → Edge Functions → new function "player-calendar", paste this file,
// then turn OFF "Verify JWT" in its settings: calendar apps can't sign in.
// It only uses the built-in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets (and APP_URL if set).

export interface FeedSession {
  id: string;
  session_type: "group" | "performance_accelerator" | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  court: number | null;
  status: string;
  description: string;
  coach_ids: string[];
}

const LABEL = { group: "Group Session", performance_accelerator: "Performance Accelerator" } as const;
/** How far back booked sessions stay on the calendar. */
const PAST_DAYS = 60;

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");
const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes continue on the next line after a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function sessionSummary(s: Pick<FeedSession, "session_type" | "title">, brand: string): string {
  const label = s.session_type ? LABEL[s.session_type] : "Session";
  return `${s.session_type === "performance_accelerator" && s.title ? `${label}: ${s.title}` : label} · ${brand}`;
}

/** An iCal file of the player's booked sessions: cancelled and draft sessions are left out. */
export function buildCalendar(opts: { sessions: FeedSession[]; coachNames: Record<string, string>; brand: string; appUrl: string; now: Date }): string {
  const { sessions, coachNames, brand, appUrl, now } = opts;
  const from = new Date(now.getTime() - PAST_DAYS * 86400000).toISOString();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//El Patio Tennis//Player calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escape(brand)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const s of [...sessions].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))) {
    if (s.status !== "published" || !s.session_type || s.ends_at < from) continue;
    const coaches = s.coach_ids.map((id) => coachNames[id]).filter(Boolean);
    const details = [coaches.length ? `Coach${coaches.length > 1 ? "es" : ""}: ${coaches.join(", ")}` : "", s.description.trim(), `Your sessions: ${appUrl}/#/my-sessions`].filter(Boolean).join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:session-${s.id}@elpatiotennis`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${stamp(s.starts_at)}`,
      `DTEND:${stamp(s.ends_at)}`,
      `SUMMARY:${escape(sessionSummary(s, brand))}`,
      `LOCATION:${escape(s.court ? `${s.location} · Court ${s.court}` : s.location)}`,
      `DESCRIPTION:${escape(details)}`,
      `URL:${appUrl}/#/my-sessions`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ───────────────────────── server ─────────────────────────

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): void } | undefined;

if (typeof Deno !== "undefined") {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const APP_URL = (Deno.env.get("APP_URL") || "https://leobakiri.github.io/TennisCommunity").replace(/\/+$/, "");

  const db = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!res.ok) throw new Error(`Database ${path.split("?")[0]}: ${res.status}`);
    return (await res.json()) as T;
  };
  const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const uuid = /^[0-9a-f-]{36}$/i;

  Deno.serve(async (req) => {
    if (req.method !== "GET" && req.method !== "HEAD") return text("Method not allowed", 405);
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    const one = url.searchParams.get("session");
    if (!/^[0-9a-f]{32}$/i.test(token) || (one && !uuid.test(one))) return text("Not found", 404);
    try {
      const [cal] = await db<{ id: string }[]>(`player_calendars?token=eq.${token}&select=id`);
      if (!cal) return text("Not found", 404);
      const booked = await db<{ session_id: string }[]>(`bookings?user_id=eq.${cal.id}&status=eq.confirmed&select=session_id`);
      const ids = booked.map((b) => b.session_id).filter((id) => !one || id === one);
      if (one && !ids.length) return text("Not found", 404);
      const sessions = ids.length ? await db<FeedSession[]>(`sessions?id=in.(${ids.join(",")})&select=id,session_type,title,starts_at,ends_at,location,court,status,description,coach_ids`) : [];
      const coachIds = [...new Set(sessions.flatMap((s) => s.coach_ids))];
      const [coaches, settings] = await Promise.all([
        coachIds.length ? db<{ id: string; full_name: string }[]>(`profiles?id=in.(${coachIds.join(",")})&select=id,full_name`) : Promise.resolve([]),
        db<{ brand_name: string }[]>("settings?select=brand_name&limit=1"),
      ]);
      const ics = buildCalendar({
        sessions,
        coachNames: Object.fromEntries(coaches.map((c) => [c.id, c.full_name.trim().split(/\s+/)[0]])),
        brand: settings[0]?.brand_name || "El Patio Tennis",
        appUrl: APP_URL,
        now: new Date(),
      });
      return new Response(req.method === "HEAD" ? null : ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `inline; filename="${one ? "el-patio-session" : "el-patio-tennis"}.ics"`,
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return text("Calendar unavailable, try again shortly", 503);
    }
  });
}
