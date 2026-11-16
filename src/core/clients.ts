// A coach's private clients: who they are, how often they come, and what they owe.
// Lessons name their players, so a client is matched to lessons by name, ignoring case.
// Pure functions, so the pages and the tests share them.
import type { CommissionRule, Lesson } from "./types";
import { lessonMoney, payday } from "./earnings";
import { addDays, dateKey, weekdayOf } from "./time";
import { isBalboa } from "./util";

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
export const hasClient = (l: Pick<Lesson, "client_names">, name: string) => l.client_names.some((n) => sameName(n, name));

/** Balboa lessons are paid through CourtReserve on a payday, so they have no paid switch. Null for lessons elsewhere. */
export const lessonPayday = (l: Pick<Lesson, "location" | "starts_at">) => (isBalboa(l.location ?? "") ? payday(dateKey(l.starts_at)) : null);

/** No lesson booked, but one in the last month: worth a message to book the next one. */
export const REBOOK_DAYS = 30;

export type ClientStatus = "booked" | "rebook" | "lapsed" | "new";

export const CLIENT_STATUS: Record<ClientStatus, { label: string; tone: "green" | "amber" | "neutral" | "red" }> = {
  booked: { label: "Booked", tone: "green" },
  rebook: { label: "Not booked", tone: "amber" },
  lapsed: { label: "Lapsed", tone: "neutral" },
  new: { label: "No lessons yet", tone: "neutral" },
};

type Dated = Pick<Lesson, "id" | "kind" | "client_names" | "starts_at" | "ends_at" | "location" | "price_cents" | "commission_cents" | "paid_at">;

/** One client's history with a coach. Semi-private money is split evenly between its players. */
export function clientSummary<L extends Dated>(name: string, lessons: L[], rules: CommissionRule[], now: Date) {
  const iso = now.toISOString();
  const mine = lessons.filter((l) => hasClient(l, name)).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const past = mine.filter((l) => l.ends_at <= iso);
  const upcoming = mine.filter((l) => l.ends_at > iso);
  const share = (l: L) => lessonMoney(l, rules).gross / Math.max(1, l.client_names.length);
  const last = past.at(-1) ?? null;
  const days_since = last ? Math.floor((now.getTime() - new Date(last.starts_at).getTime()) / 86400000) : null;
  const status: ClientStatus = upcoming.length ? "booked" : days_since === null ? "new" : days_since <= REBOOK_DAYS ? "rebook" : "lapsed";
  const today = dateKey(now);
  // Balboa counts as paid once its payday passes and is never owed; elsewhere the coach marks it paid.
  const isPaid = (l: L) => { const pay = lessonPayday(l); return pay ? pay <= today : !!l.paid_at; };
  const owedLessons = past.filter((l) => !lessonPayday(l) && !l.paid_at && (l.price_cents ?? 0) > 0);
  return {
    lessons: past.length,
    upcoming: upcoming.length,
    hours: Math.round((past.reduce((n, l) => n + (new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()), 0) / 3600000) * 10) / 10,
    first: mine[0]?.starts_at ?? null,
    last,
    next: upcoming[0] ?? null,
    days_since,
    status,
    paid: Math.round(past.filter(isPaid).reduce((n, l) => n + share(l), 0)),
    owed: Math.round(owedLessons.reduce((n, l) => n + share(l), 0)),
    owed_lessons: owedLessons.length,
    // How often they come, from their last eight lessons: "every 7 days".
    every_days: past.length >= 3 ? Math.round((new Date(past.at(-1)!.starts_at).getTime() - new Date(past.at(-Math.min(8, past.length))!.starts_at).getTime()) / 86400000 / (Math.min(8, past.length) - 1)) : null,
  };
}
export type ClientSummary = ReturnType<typeof clientSummary>;

/** The next free date for a repeat of a lesson: its weekday, after today. */
export function nextSameWeekday(lessonDay: string, today: string): string {
  const gap = (weekdayOf(lessonDay) - weekdayOf(today) + 7) % 7 || 7;
  return addDays(today, gap);
}

/** The dates of a lesson booked every week for a number of weeks. */
export const weeklyDates = (first: string, weeks: number) => Array.from({ length: Math.max(1, weeks) }, (_, i) => addDays(first, i * 7));

/** Two time ranges overlap when each starts before the other ends. */
export const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) =>
  new Date(a.starts_at).getTime() < new Date(b.ends_at).getTime() && new Date(b.starts_at).getTime() < new Date(a.ends_at).getTime();

/** Digits for a WhatsApp link, from an E.164 phone. */
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
