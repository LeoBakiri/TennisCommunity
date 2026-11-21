// What the admin Members page shows about each person: their level and how much they play with the community.
import type { Booking, Session } from "./types";

/** Tennis levels a member picks at sign-up. Stored as the value on profiles.level; empty means not set yet. */
export const LEVELS = [
  { value: "beginner", label: "Beginner", hint: "New to tennis or just getting started" },
  { value: "advanced_beginner", label: "Advanced beginner", hint: "Can rally a bit, learning the strokes" },
  { value: "intermediate", label: "Intermediate", hint: "Steady rallies, plays points (about 3.0–3.5)" },
  { value: "advanced", label: "Advanced", hint: "Plays matches, solid all round (4.0+)" },
] as const;
export type Level = (typeof LEVELS)[number]["value"];
export const LEVEL_VALUES = LEVELS.map((l) => l.value) as string[];
export const levelLabel = (v: string | null | undefined) => LEVELS.find((l) => l.value === v)?.label ?? "";

export interface MemberStats {
  played: number; // community sessions they were on court for (ended, seat held, not marked a no-show)
  group: number;
  pa: number;
  upcoming: number;
  noShows: number;
  lateCancels: number;
  lastPlayed: string | null; // starts_at of the latest one played
  playedThisMonth: number;
}

export const emptyStats = (): MemberStats => ({ played: 0, group: 0, pa: 0, upcoming: 0, noShows: 0, lateCancels: 0, lastPlayed: null, playedThisMonth: 0 });

/**
 * Per-person community stats. Cancelled sessions and private lessons don't count.
 * A person with two rows for one session (cancelled, then booked again) counts once.
 */
export function memberStats(bookings: Booking[], sessions: Map<string, Session>, now: Date, monthStart: string): Map<string, MemberStats> {
  const out = new Map<string, MemberStats>();
  const seen = new Set<string>();
  const nowIso = now.toISOString();
  for (const b of bookings) {
    const s = sessions.get(b.session_id);
    if (!s || !s.session_type || s.status === "cancelled") continue;
    const st = out.get(b.user_id) ?? emptyStats();
    out.set(b.user_id, st);
    if (b.status === "cancelled") {
      if (b.late_cancel) st.lateCancels++;
      continue;
    }
    if (b.status !== "confirmed") continue;
    const key = `${b.user_id}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.starts_at > nowIso) {
      st.upcoming++;
      continue;
    }
    if (s.ends_at > nowIso) continue; // on court right now
    if (b.attended === false) {
      st.noShows++;
      continue;
    }
    st.played++;
    if (s.session_type === "performance_accelerator") st.pa++;
    else st.group++;
    if (s.starts_at >= monthStart) st.playedThisMonth++;
    if (!st.lastPlayed || s.starts_at > st.lastPlayed) st.lastPlayed = s.starts_at;
  }
  return out;
}
