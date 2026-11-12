import type { LessonKind, SessionType } from "./types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // RFC4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

// The two community session types and the two coach lesson types.
export const SESSION_META: Record<SessionType, { label: string; color: string }> = {
  group: { label: "Group Session", color: "#7A8F3A" },
  performance_accelerator: { label: "Performance Accelerator", color: "#2F5D62" },
};
export const LESSON_META: Record<LessonKind, { label: string; color: string }> = {
  private: { label: "Private Lesson", color: "#1F3A2E" },
  semi_private: { label: "Semi-Private Lesson", color: "#B5672C" },
};

// One court takes 6 Group Session players or 4 Performance Accelerator players. A bigger session runs on
// two courts and only goes ahead with enough players; below that, a coach decides 12 hours before.
export const COURT_SIZE: Record<SessionType, number> = { group: 6, performance_accelerator: 4 };
const TWO_COURT_MINIMUM: Record<SessionType, number> = { group: 10, performance_accelerator: 6 };
export const DECIDE_HOURS = 12;
export function courtPlan(s: { session_type: SessionType | null; capacity: number }) {
  const size = COURT_SIZE[s.session_type ?? "group"];
  const courts = Math.ceil(s.capacity / size);
  return { size, courts, minimum: courts > 1 ? Math.min(TWO_COURT_MINIMUM[s.session_type ?? "group"], s.capacity) : 0 };
}
/** Under its minimum and nobody has decided yet: a coach must run it, drop to one court or cancel. */
export function needsDecision(s: { session_type: SessionType | null; capacity: number; booked: number; status: string; decided_at?: string | null }) {
  return s.status === "published" && !s.decided_at && s.booked < courtPlan(s).minimum;
}
/** 12 hours before the start, unless a coach moved it. */
export const decideBy = (s: { starts_at: string; decide_by?: string | null }) => s.decide_by ?? new Date(new Date(s.starts_at).getTime() - DECIDE_HOURS * 3600000).toISOString();

// Balboa has numbered courts; other locations don't get a court picker.
export const COURTS = [1, 2, 3, 4] as const;
export const isBalboa = (location: string) => /balboa/i.test(location);
/** Places coaches pick from. Emerald Hills has no commission rule, so it takes 0%. */
export const KNOWN_PLACES = ["Emerald Hills"] as const;
export const placeOptions = (...extra: (string | null | undefined)[]) => [...new Set([...extra, ...KNOWN_PLACES].filter((x): x is string => !!x))].sort();
export const placeLabel = (p: { location: string; court?: number | null }) => (p.court ? `${p.location} · Court ${p.court}` : p.location);

export const sessionTitle = (s: { session_type: SessionType | null; title: string }) => {
  const label = s.session_type ? SESSION_META[s.session_type].label : "Session";
  return s.session_type === "performance_accelerator" && s.title ? `${label}: ${s.title}` : label;
};
/** Round numbers of sessions played that a player's progress counts toward. */
export const MILESTONES = [1, 5, 10, 25, 50, 100, 200, 365, 500, 1000];
export const nextMilestone = (played: number) => MILESTONES.find((m) => m > played) ?? Math.ceil((played + 1) / 500) * 500;
export const lastMilestone = (played: number) => [0, ...MILESTONES].filter((m) => m <= played).pop() ?? 0;

export const lessonTitle = (l: { kind: LessonKind; client_names: string[] }) => l.client_names.join(", ") || LESSON_META[l.kind].label;

export function fmtMoney(cents: number | null | undefined, opts: { free?: string } = {}): string {
  if (cents === null || cents === undefined) return "Price TBA";
  if (cents === 0) return opts.free ?? "Free";
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars.toLocaleString("en-US")}` : `$${dollars.toFixed(2)}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "0 0 0";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function by<T>(key: (t: T) => string | number, dir: 1 | -1 = 1) {
  return (a: T, b: T) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -dir : x > y ? dir : 0;
  };
}

export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
}

export function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Normalise a US-centric phone number to E.164. Returns null if it doesn't look like one. */
export function normalizePhone(v: string): string | null {
  const digits = v.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 11) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
