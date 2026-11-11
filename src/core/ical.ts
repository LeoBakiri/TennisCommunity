// Reads a player's CourtReserve calendar link (an iCal feed) so their club clinics
// and privates show next to their El Patio sessions.
import { BUSINESS_TZ, zonedToUtc } from "./time";

/** One reservation from the club's calendar, as shown on My Sessions. */
export interface ClubEvent {
  uid: string;
  title: string;
  starts_at: string; // ISO UTC
  ends_at: string;
  location: string;
  all_day: boolean;
}

export const FEED_FN = "courtreserve-feed";
/** How far ahead club events are shown. */
export const FEED_DAYS = 60;

// Kept in step with the database check and the courtreserve-feed function.
const FEED_PATH = /^https:\/\/app\.courtreserve\.com\/Online\/PublicIcal\/\S+$/i;

/** The link as CourtReserve gives it, or null when it isn't a CourtReserve calendar link. */
export function cleanFeedUrl(raw: string): string | null {
  const v = raw.trim().replace(/^webcals?:\/\//i, "https://");
  return FEED_PATH.test(v) ? v.replace(/\/$/, "") : null;
}

function unescape(v: string) {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/** "20261112T180000Z", "20261112T180000" with a TZID, or an all-day "20261112". */
function parseWhen(value: string, params: Record<string, string>): { iso: string; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  const day = `${y}-${mo}-${d}`;
  if (!hh) return { iso: zonedToUtc(day, "00:00").toISOString(), allDay: true };
  if (z) return { iso: new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi)).toISOString(), allDay: false };
  let tz = params.TZID?.replace(/^"|"$/g, "") || BUSINESS_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = BUSINESS_TZ; // Windows zone names like "Pacific Standard Time"
  }
  return { iso: zonedToUtc(day, `${hh}:${mi}`, tz).toISOString(), allDay: false };
}

/** Every event in an iCal file, earliest first. Cancelled events are left out. */
export function parseIcs(text: string): ClubEvent[] {
  // Long lines continue on the next line after a leading space or tab.
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: ClubEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      const start = cur.DTSTART && parseWhen(cur.DTSTART.value, cur.DTSTART.params);
      const end = cur.DTEND && parseWhen(cur.DTEND.value, cur.DTEND.params);
      if (start && cur.STATUS?.value.toUpperCase() !== "CANCELLED") {
        const ends = end?.iso ?? new Date(new Date(start.iso).getTime() + (start.allDay ? 86400000 : 3600000)).toISOString();
        out.push({
          uid: cur.UID?.value || `${start.iso}-${cur.SUMMARY?.value ?? ""}`,
          title: unescape(cur.SUMMARY?.value ?? "") || "Court reservation",
          starts_at: start.iso,
          ends_at: ends,
          location: unescape(cur.LOCATION?.value ?? ""),
          all_day: start.allDay,
        });
      }
      cur = null;
    } else if (cur) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...rest] = line.slice(0, colon).split(";");
      const params: Record<string, string> = {};
      for (const p of rest) {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      }
      cur[name.toUpperCase()] = { value: line.slice(colon + 1), params };
    }
  }
  return out.sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
}

/** Club events that haven't finished, up to FEED_DAYS ahead. */
export function upcomingClubEvents(events: ClubEvent[], now: Date): ClubEvent[] {
  const from = now.toISOString();
  const to = new Date(now.getTime() + FEED_DAYS * 86400000).toISOString();
  return events.filter((e) => e.ends_at > from && e.starts_at < to);
}
