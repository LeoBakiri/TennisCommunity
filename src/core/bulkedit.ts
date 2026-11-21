// Editing ticked community sessions together. Shared by the server action and the dialog's live preview,
// so what the admin sees before saving is exactly what gets saved.
import type { Session, SessionStatus, SessionType } from "./types";
import { addDays, dateKey, minutesOfDay, startOfWeek, zonedToUtc } from "./time";
import { COURT_SIZE, isBalboa } from "./util";

export interface BulkEdit {
  /** "" keeps the date; "wd:N" moves to that day of the same week (0 = Monday); "days:N" shifts by N days. */
  move: string;
  /** "" keeps the time; "HH:MM" sets it; "+30" / "-60" shifts by minutes. */
  time: string;
  duration_min: number | null;
  session_type: "" | SessionType;
  status: "" | "published" | "draft";
  /** keep: unchanged, unless the number of coaches or the type changes (then one court per coach). */
  spots: "keep" | "set" | "coaches";
  capacity: number | null;
  price_mode: "keep" | "set" | "tba";
  price: number | null;
  location: string;
  court: "keep" | "none" | "1" | "2" | "3" | "4";
  coach_mode: "keep" | "replace" | "add" | "remove";
  coach_ids: string[];
  title_mode: "keep" | "set" | "clear";
  title: string;
  notes_mode: "keep" | "replace" | "append" | "clear";
  description: string;
  internal_mode: "keep" | "replace" | "append" | "clear";
  internal_notes: string;
}

export const BLANK_EDIT: BulkEdit = {
  move: "",
  time: "",
  duration_min: null,
  session_type: "",
  status: "",
  spots: "keep",
  capacity: null,
  price_mode: "keep",
  price: null,
  location: "",
  court: "keep",
  coach_mode: "keep",
  coach_ids: [],
  title_mode: "keep",
  title: "",
  notes_mode: "keep",
  description: "",
  internal_mode: "keep",
  internal_notes: "",
};

/** True when the form would change something (it may still leave some sessions exactly as they were). */
export function hasChanges(e: BulkEdit) {
  return !!(
    e.move ||
    e.time ||
    e.duration_min !== null ||
    e.session_type ||
    e.status ||
    e.spots !== "keep" ||
    e.price_mode !== "keep" ||
    e.location ||
    e.court !== "keep" ||
    e.coach_mode !== "keep" ||
    e.title_mode !== "keep" ||
    e.notes_mode !== "keep" ||
    e.internal_mode !== "keep"
  );
}

type Row = Pick<Session, "session_type" | "title" | "starts_at" | "ends_at" | "coach_ids" | "capacity" | "price_cents" | "location" | "court" | "status" | "description" | "internal_notes">;

const notes = (mode: BulkEdit["notes_mode"], old: string, text: string) =>
  mode === "replace" ? text : mode === "append" ? (old.trim() ? `${old.trimEnd()}\n${text}` : text) : mode === "clear" ? "" : old;

/** The session after the edit, or an error that applies to this session only. */
export function applyBulkEdit<T extends Row>(s: T, e: BulkEdit): { next: T; error?: string } {
  const oldDay = dateKey(s.starts_at);
  let day = oldDay;
  if (e.move.startsWith("wd:")) day = addDays(startOfWeek(oldDay), Number(e.move.slice(3)));
  else if (e.move.startsWith("days:")) day = addDays(oldDay, Number(e.move.slice(5)));

  let minutes = minutesOfDay(s.starts_at);
  let error: string | undefined;
  if (/^\d{2}:\d{2}$/.test(e.time)) minutes = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3));
  else if (/^[+-]\d+$/.test(e.time)) minutes += Number(e.time);
  if (minutes < 0 || minutes >= 24 * 60) {
    error = "would move past midnight";
    minutes = Math.min(Math.max(minutes, 0), 24 * 60 - 15);
  }
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const length = e.duration_min ?? Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
  const start = zonedToUtc(day, hhmm);

  const type: SessionType = e.session_type || s.session_type || "group";
  let coach_ids = s.coach_ids;
  if (e.coach_mode === "replace") coach_ids = e.coach_ids;
  else if (e.coach_mode === "add") coach_ids = [...coach_ids, ...e.coach_ids.filter((id) => !coach_ids.includes(id))];
  else if (e.coach_mode === "remove") coach_ids = coach_ids.filter((id) => !e.coach_ids.includes(id));

  // One court per coach. Spots follow when the number of coaches or the type changes, unless set by hand.
  const fromCoaches = Math.max(1, coach_ids.length) * COURT_SIZE[type];
  const capacity =
    e.spots === "set" && e.capacity !== null ? e.capacity : e.spots === "coaches" || coach_ids.length !== s.coach_ids.length || type !== s.session_type ? fromCoaches : s.capacity;

  const location = e.location || s.location;
  const court = e.court === "keep" ? s.court : e.court === "none" ? null : Number(e.court);
  const title = type !== "performance_accelerator" ? "" : e.title_mode === "set" ? e.title : e.title_mode === "clear" ? "" : s.title;

  const next: T = {
    ...s,
    session_type: type,
    title,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + length * 60000).toISOString(),
    coach_ids,
    capacity,
    price_cents: e.price_mode === "set" ? e.price : e.price_mode === "tba" ? null : s.price_cents,
    location,
    court: isBalboa(location) ? court : null,
    status: (e.status || s.status) as SessionStatus,
    description: notes(e.notes_mode, s.description, e.description),
    internal_notes: notes(e.internal_mode, s.internal_notes, e.internal_notes),
  };
  if (!coach_ids.length) error ??= "would have no coach";
  return { next, error };
}

/** Which parts of a session the edit changed, for the preview. */
export function changedParts(before: Row, after: Row) {
  return {
    when: before.starts_at !== after.starts_at || before.ends_at !== after.ends_at,
    type: before.session_type !== after.session_type || before.title !== after.title,
    coaches: before.coach_ids.join() !== after.coach_ids.join(),
    spots: before.capacity !== after.capacity,
    price: before.price_cents !== after.price_cents,
    place: before.location !== after.location || before.court !== after.court,
    status: before.status !== after.status,
    notes: before.description !== after.description || before.internal_notes !== after.internal_notes,
  };
}
