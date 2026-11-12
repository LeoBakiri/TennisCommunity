// Coach earnings: club commission on lessons and community sessions, Balboa paydays, and the week / month / year totals
// behind the Earnings page. Pure functions, so the page and the tests share them.
import type { CommissionRule, Lesson, Session } from "./types";
import { addDays, dateKey, startOfWeek } from "./time";

export type Period = "week" | "month" | "year";
export const PERIODS: Period[] = ["week", "month", "year"];

/** How many club commission rows the admin settings form shows. */
export const COMMISSION_ROWS = 4;

type Priced = Pick<Lesson, "price_cents" | "starts_at" | "ends_at" | "location"> & { client_names?: string[] };

const minutes = (l: Pick<Lesson, "starts_at" | "ends_at">) => Math.max(0, Math.round((new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()) / 60000));

const charges = (r: CommissionRule) => r.percent > 0 || r.per_hour_cents > 0 || r.per_lesson_cents > 0;

/** Players on court for a lesson: one per client name. */
export const lessonPlayers = (l: { client_names?: string[] }) => Math.max(1, l.client_names?.length ?? 1);

/**
 * The rule for a place and group size: rules whose place name appears in the location, e.g. "Balboa",
 * and whose player limit fits. The tightest limit wins, so "up to 4 players" beats a rule with no limit.
 */
export function ruleFor(location: string, rules: CommissionRule[], players = 1): CommissionRule | null {
  const where = location.toLowerCase();
  const fits = rules.filter((r) => r.place.trim() && charges(r) && where.includes(r.place.trim().toLowerCase()) && (r.max_players == null || players <= r.max_players));
  return fits.sort((a, b) => (a.max_players ?? Infinity) - (b.max_players ?? Infinity))[0] ?? null;
}

/** What the club takes for one lesson or session under a rule, in cents. */
export function commissionUnder(rule: CommissionRule, l: Pick<Lesson, "price_cents" | "starts_at" | "ends_at">): number {
  const pct = Math.round(((l.price_cents ?? 0) * rule.percent) / 100);
  const hourly = Math.round((rule.per_hour_cents * minutes(l)) / 60);
  return pct + hourly + rule.per_lesson_cents;
}

/** Commission to store when a lesson is saved: null while no rule covers its place, so a rule set later still applies. */
export function commissionFor(l: Priced, rules: CommissionRule[]): number | null {
  const rule = ruleFor(l.location, rules, lessonPlayers(l));
  return rule ? commissionUnder(rule, l) : null;
}

export interface Money {
  gross: number; // what the player pays
  commission: number; // what the club takes
  net: number; // what the coach keeps
  priced: boolean;
}

/** A lesson's money. The commission saved with it wins; otherwise today's rule for its place. */
export function lessonMoney(l: Priced & Pick<Lesson, "commission_cents">, rules: CommissionRule[]): Money {
  const gross = l.price_cents ?? 0;
  const commission = l.commission_cents ?? commissionFor(l, rules) ?? 0;
  return { gross, commission, net: gross - commission, priced: l.price_cents !== null };
}

/** Players on each court, split as evenly as possible: 11 on 2 courts is 6 and 5. */
export function playersPerCourt(players: number, courts: number): number[] {
  const n = Math.max(1, Math.min(courts, players || 1));
  return Array.from({ length: n }, (_, i) => Math.floor(players / n) + (i < players % n ? 1 : 0));
}

/**
 * One coach's share of a community session: every booked player pays the session price, the club
 * takes its commission court by court (each court's group size picks the rate), and the coaches split the rest evenly.
 */
export function sessionShare(s: Pick<Session, "price_cents" | "starts_at" | "ends_at" | "location" | "coach_ids">, players: number, rules: CommissionRule[], courts = 1): Money {
  const price = s.price_cents ?? 0;
  const total = price * players;
  const cut =
    players > 0
      ? playersPerCourt(players, courts).reduce((n, p) => {
          const rule = ruleFor(s.location, rules, p);
          return n + (rule ? Math.min(price * p, commissionUnder(rule, { ...s, price_cents: price * p })) : 0);
        }, 0)
      : 0;
  const coaches = Math.max(1, s.coach_ids.length);
  const gross = Math.round(total / coaches);
  const commission = Math.round(cut / coaches);
  return { gross, commission, net: gross - commission, priced: s.price_cents !== null };
}

/** Balboa pays through CourtReserve twice a month: work on the 1st–15th on the 20th, the 16th–end on the 5th of next month. */
export function payday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (d <= 15) return `${day.slice(0, 7)}-20`;
  return new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10);
}

/** The work days a payday covers, as [first, day after last]. */
export function payWindow(pay: string): { from: string; to: string } {
  const [y, m, d] = pay.split("-").map(Number);
  if (d === 20) return { from: `${pay.slice(0, 7)}-01`, to: `${pay.slice(0, 7)}-16` };
  const prev = new Date(Date.UTC(y, m - 2, 16)).toISOString().slice(0, 10);
  return { from: prev, to: `${pay.slice(0, 7)}-01` };
}

/** Dollars for money screens: "$0", "$1,240", "$12.50". */
export function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const d = Math.abs(cents) / 100;
  return `${sign}$${d.toLocaleString("en-US", { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Short dollars for chart labels: "$950", "$1.2k". */
export const usdShort = (cents: number) => (Math.abs(cents) >= 100000 ? `$${(cents / 100000).toFixed(1).replace(/\.0$/, "")}k` : usd(cents));

export function addMoney(items: Money[]) {
  return items.reduce((t, m) => ({ gross: t.gross + m.gross, commission: t.commission + m.commission, net: t.net + m.net }), { gross: 0, commission: 0, net: 0 });
}

// ───────────────────────── periods ─────────────────────────

const firstOfMonth = (key: string) => `${key.slice(0, 7)}-01`;
const addMonths = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PeriodRange {
  from: string; // first day (date key)
  to: string; // day after the last one
  prev: string; // a date inside the previous period
  next: string;
}

export function periodRange(period: Period, at: string): PeriodRange {
  if (period === "week") {
    const from = startOfWeek(at);
    return { from, to: addDays(from, 7), prev: addDays(from, -7), next: addDays(from, 7) };
  }
  if (period === "month") {
    const from = firstOfMonth(at);
    return { from, to: addMonths(from, 1), prev: addMonths(from, -1), next: addMonths(from, 1) };
  }
  const from = `${at.slice(0, 4)}-01-01`;
  const next = `${Number(at.slice(0, 4)) + 1}-01-01`;
  return { from, to: next, prev: `${Number(at.slice(0, 4)) - 1}-01-01`, next };
}

const short = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;

export function periodLabel(period: Period, at: string): string {
  const { from, to } = periodRange(period, at);
  if (period === "year") return from.slice(0, 4);
  if (period === "month") return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const last = addDays(to, -1);
  return `${short(from)} – ${from.slice(5, 7) === last.slice(5, 7) ? Number(last.slice(8, 10)) : short(last)}, ${last.slice(0, 4)}`;
}

/** The chart's columns: days of a week, weeks of a month, months of a year. */
export function buckets(period: Period, at: string): { key: string; label: string; from: string; to: string }[] {
  const { from, to } = periodRange(period, at);
  if (period === "week") {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { key: d, label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i], from: d, to: addDays(d, 1) };
    });
  }
  if (period === "month") {
    const out = [];
    for (let mon = startOfWeek(from); mon < to; mon = addDays(mon, 7)) {
      const a = mon < from ? from : mon;
      const b = addDays(mon, 7) > to ? to : addDays(mon, 7);
      out.push({ key: a, label: short(a), from: a, to: b });
    }
    return out;
  }
  return MONTHS.map((label, i) => {
    const a = addMonths(from, i);
    return { key: a, label, from: a, to: addMonths(a, 1) };
  });
}

export const inRange = (iso: string, from: string, to: string) => {
  const d = dateKey(iso);
  return d >= from && d < to;
};

/** "Nov 20" for a payday. */
export const fmtPayday = (key: string) => short(key);

/** "Nov 1 – 15" for the work days a payday covers (last day included). */
export const fmtPayWindow = (from: string, last: string) => `${short(from)} – ${Number(last.slice(8, 10))}`;
