// Club clinics: the same class every week at a flat pay, e.g. a BTC Legacy Clinic. Pure functions shared by
// the schedule, the clinic page, Earnings and the tests.
import type { Clinic, ClinicCover } from "./types";
import { addDays, zonedToUtc } from "./time";
import { isBalboa } from "./util";
import { payday, type Money } from "./earnings";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const CLINIC_COLOR = "#3E6E8E";

/** Monday = 0 … Sunday = 6, for a date key. */
export const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/** The first date on or after `day` that falls on the clinic's weekday. */
export const firstOn = (day: string, weekday: number) => addDays(day, (weekday - weekdayOf(day) + 7) % 7);

/** One night of a clinic. */
export interface ClinicDate {
  clinic: Clinic;
  day: string;
  starts_at: string;
  ends_at: string;
  cover: ClinicCover | null; // someone else took it
}

/** Every night a clinic runs from `from` up to (not including) `to`. */
export function clinicDates(c: Clinic, from: string, to: string, covers: ClinicCover[] = []): ClinicDate[] {
  const out: ClinicDate[] = [];
  const start = firstOn(c.starts_on > from ? c.starts_on : from, c.weekday);
  for (let day = start; day < to && (!c.ends_on || day <= c.ends_on); day = addDays(day, 7)) {
    const s = zonedToUtc(day, c.start_time);
    out.push({ clinic: c, day, starts_at: s.toISOString(), ends_at: new Date(s.getTime() + c.duration_min * 60000).toISOString(), cover: covers.find((x) => x.clinic_id === c.id && x.day === day) ?? null });
  }
  return out;
}

/** All of a coach's clinic nights in a range, in time order. */
export const allClinicDates = (clinics: Clinic[], from: string, to: string, covers: ClinicCover[] = []) =>
  clinics.flatMap((c) => clinicDates(c, from, to, covers)).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));

/** A night's pay: the flat amount, nothing taken off, nothing when someone else covered it. */
export function clinicMoney(d: Pick<ClinicDate, "clinic" | "cover">): Money {
  const pay = d.cover ? 0 : d.clinic.pay_cents;
  return { gross: pay, commission: 0, net: pay, priced: true };
}

/** Club clinics are paid through the club's payroll: BTC's twice-a-month paydays. */
export const clinicPayday = (d: Pick<ClinicDate, "clinic" | "day">) => (isBalboa(d.clinic.location) ? payday(d.day) : null);

/** "Mondays · 6:30–8:00 PM"-style label pieces. */
export const weekdayPlural = (weekday: number) => `${WEEKDAYS[weekday]}s`;
