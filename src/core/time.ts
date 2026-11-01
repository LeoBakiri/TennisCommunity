// Timezone helpers built on Intl so they behave identically on the server,
// in the browser and across daylight-saving transitions.

export const BUSINESS_TZ = "America/Los_Angeles";

const partsCache = new Map<string, Intl.DateTimeFormat>();

function wallParts(date: Date, tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour: Number(o.hour) % 24,
    minute: Number(o.minute),
    second: Number(o.second),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Offset (ms) between wall-clock time in `tz` and UTC at `date`. */
export function tzOffsetMs(date: Date, tz = BUSINESS_TZ): number {
  const p = wallParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a business-local date ("YYYY-MM-DD") and time ("HH:MM") to a UTC Date. */
export function zonedToUtc(dateKey: string, time: string, tz = BUSINESS_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let ts = guess - off1;
  const off2 = tzOffsetMs(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

/** Business-local calendar date of an instant, as "YYYY-MM-DD". */
export function dateKey(date: Date | string, tz = BUSINESS_TZ): string {
  const p = wallParts(new Date(date), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Business-local time of an instant, as "HH:MM". */
export function timeKey(date: Date | string, tz = BUSINESS_TZ): string {
  const p = wallParts(new Date(date), tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function minutesOfDay(date: Date | string, tz = BUSINESS_TZ): number {
  const p = wallParts(new Date(date), tz);
  return p.hour * 60 + p.minute;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the week containing `key`. */
export function startOfWeek(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7));
}

export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function fmt(date: Date | string, opts: Intl.DateTimeFormatOptions, tz = BUSINESS_TZ) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(date));
}

const noon = (key: string) => zonedToUtc(key, "12:00");

export const fmtTime = (d: Date | string) =>
  fmt(d, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
export const fmtDay = (d: Date | string) => fmt(d, { weekday: "short", month: "short", day: "numeric" });
export const fmtDayLong = (d: Date | string) => fmt(d, { weekday: "long", month: "long", day: "numeric" });
export const fmtDate = (d: Date | string) => fmt(d, { month: "short", day: "numeric", year: "numeric" });
export const fmtWeekday = (d: Date | string) => fmt(d, { weekday: "short" });
export const fmtDateTime = (d: Date | string) => `${fmtDay(d)} · ${fmtTime(d)}`;
export const fmtKeyDay = (key: string) => fmtDay(noon(key));
export const fmtKeyLong = (key: string) => fmtDayLong(noon(key));
export const fmtKeyWeekday = (key: string) => fmtWeekday(noon(key));
export const fmtKeyNum = (key: string) => String(Number(key.slice(8, 10)));
export const fmtKeyMonth = (key: string) => fmt(noon(key), { month: "long", year: "numeric" });

export function fmtRange(start: Date | string, end: Date | string): string {
  const a = fmt(start, { hour: "numeric", minute: "2-digit" });
  const b = fmt(end, { hour: "numeric", minute: "2-digit" });
  const [at, ap] = a.split(" ");
  const [bt, bp] = b.split(" ");
  const clean = (t: string) => t.replace(":00", "");
  return ap === bp ? `${clean(at)} – ${clean(bt)} ${bp}` : `${clean(at)} ${ap} – ${clean(bt)} ${bp}`;
}

export const fmtDayRange = (start: Date | string, end: Date | string) => `${fmtDay(start)} · ${fmtRange(start, end)}`;

export function fmtWeekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  const a = fmt(noon(monday), { month: "short", day: "numeric" });
  const b = fmt(noon(sunday), monday.slice(5, 7) === sunday.slice(5, 7) ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${a} – ${b}, ${sunday.slice(0, 4)}`;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${pad(m)} ${ap}` : `${hr} ${ap}`;
}

export function relativeFromNow(date: Date | string, now = new Date()): string {
  const diff = new Date(date).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const v = mins < 60 ? `${mins} min` : hours < 36 ? `${hours} hr` : `${days} days`;
  return diff >= 0 ? `in ${v}` : `${v} ago`;
}
