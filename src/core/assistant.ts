// The coach assistant's hands: what it can look up and what it can change.
// The model runs in the coach-assistant server function; every tool it calls runs here, in the
// coach's own browser, through the same store and actions as the rest of the portal. So it can
// only ever see and change what that coach can, and nothing is saved until the coach confirms.
import type { Actor, Lesson } from "./types";
import type { Store } from "./store";
import { loadCoachEarnings } from "./queries";
import { getSettings } from "./services";
import { clientSummary, sameName } from "./clients";
import { PERIODS, type Period } from "./earnings";
import { addDays, dateKey, fmtDay, fmtTime, isDateKey, timeKey, zonedToUtc } from "./time";
import { LESSON_META, placeLabel, sessionTitle } from "./util";

/** A piece of a message, in the shape the Claude API uses. Kept loose: blocks pass through untouched. */
export interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  [k: string]: unknown;
}
export interface Msg {
  role: "user" | "assistant";
  content: string | Block[];
}
export interface AssistantReply {
  content: Block[];
  stop_reason: string | null;
}

export interface AssistantCtx {
  store: Store;
  actor: Actor;
  now: Date;
}

export const ASSISTANT_FN = "coach-assistant";

/** Tools that only read: they run straight away. */
export const READ_TOOLS: Record<string, string> = {
  get_schedule: "Checking your schedule",
  get_clients: "Looking at your clients",
  get_earnings: "Adding up your earnings",
};
/** Tools that change something: the coach sees what will happen and confirms first. */
export const WRITE_TOOLS = new Set(["book_lesson", "change_lesson", "cancel_lesson", "mark_lesson_paid", "save_client"]);
export const DRAFT_TOOL = "draft_message";

export class ToolError extends Error {}

/** Who gets the assistant. Each question costs money on the club's Claude account, so for now it is the admin's alone. */
export const canUseAssistant = (p: { role: string } | null | undefined) => p?.role === "admin";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const has = (input: Record<string, unknown>, k: string) => input[k] !== undefined && input[k] !== null;
const dollars = (cents: number | null | undefined) => (cents == null ? null : cents / 100);
const startIso = (key: string) => zonedToUtc(key, "00:00").toISOString();
const minutes = (l: { starts_at: string; ends_at: string }) => Math.round((new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()) / 60000);
const when = (iso: string) => ({ date: dateKey(iso), day: fmtDay(iso), time: timeKey(iso) });

function coach(ctx: AssistantCtx) {
  const u = ctx.actor.user;
  if (!u || !canUseAssistant(u)) throw new ToolError("The assistant isn't available on this account.");
  return u;
}

const lessonView = (l: Lesson) => ({
  lesson_id: l.id,
  kind: l.kind,
  clients: l.client_names,
  ...when(l.starts_at),
  minutes: minutes(l),
  location: l.location,
  court: l.court,
  price: dollars(l.price_cents),
  paid: !!l.paid_at,
  notes: l.notes,
});

// ───────────────────────── reading ─────────────────────────

const MAX_RANGE_DAYS = 120;

async function getSchedule(ctx: AssistantCtx, input: Record<string, unknown>) {
  const u = coach(ctx);
  const today = dateKey(ctx.now);
  const from = isDateKey(input.from) ? input.from : today;
  let to = isDateKey(input.to) && input.to >= from ? input.to : addDays(from, 6);
  if (to > addDays(from, MAX_RANGE_DAYS)) to = addDays(from, MAX_RANGE_DAYS);
  const range = { gte: { field: "starts_at" as const, value: startIso(from) }, lt: { field: "starts_at" as const, value: startIso(addDays(to, 1)) } };
  const [lessons, rows] = await Promise.all([ctx.store.list("lessons", { eq: { coach_id: u.id }, ...range, order: { field: "starts_at" } }), ctx.store.list("sessions", { contains: { field: "coach_ids", value: u.id }, ...range, order: { field: "starts_at" } })]);
  const sessions = rows.filter((s) => s.session_type && s.status !== "draft");
  const ids = sessions.map((s) => s.id);
  const [stats, bookings, profiles] = await Promise.all([ctx.store.sessionStats(ids), ids.length ? ctx.store.list("bookings", { in: { field: "session_id", values: ids } }) : [], ids.length ? ctx.store.list("profiles") : []]);
  const name = new Map(profiles.map((p) => [p.id, p.full_name]));
  return {
    from,
    to,
    community_sessions: sessions.map((s) => ({
      session_id: s.id,
      type: sessionTitle(s),
      ...when(s.starts_at),
      minutes: minutes(s),
      place: placeLabel(s),
      status: s.status,
      booked: stats[s.id]?.booked ?? 0,
      capacity: s.capacity,
      waitlist: stats[s.id]?.waitlist ?? 0,
      players: bookings.filter((b) => b.session_id === s.id && b.status === "confirmed").map((b) => name.get(b.user_id) ?? "A player"),
      coach_notes: s.internal_notes,
    })),
    lessons: lessons.map(lessonView),
  };
}

async function getClients(ctx: AssistantCtx) {
  const u = coach(ctx);
  const [cards, lessons, rules] = await Promise.all([ctx.store.list("clients", { eq: { coach_id: u.id } }), ctx.store.list("lessons", { eq: { coach_id: u.id } }), ctx.store.list("commission_rules")]);
  return {
    today: dateKey(ctx.now),
    clients: cards
      .map((c) => {
        const s = clientSummary(c.full_name, lessons, rules, ctx.now);
        return {
          client_id: c.id,
          name: c.full_name,
          level: c.level,
          goals: c.goals,
          notes: c.notes,
          // Contact details stay in the portal; drafts get their WhatsApp button from the card.
          has_phone: !!c.phone,
          status: s.status,
          lessons_taught: s.lessons,
          lessons_booked: s.upcoming,
          comes_every_days: s.every_days,
          days_since_last: s.days_since,
          last_lesson: s.last ? { ...when(s.last.starts_at), kind: s.last.kind, minutes: minutes(s.last), location: s.last.location, price: dollars(s.last.price_cents) } : null,
          next_lesson: s.next ? { lesson_id: s.next.id, ...when(s.next.starts_at) } : null,
          owes: dollars(s.owed),
          unpaid_lessons: s.owed_lessons,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function getEarnings(ctx: AssistantCtx, input: Record<string, unknown>) {
  coach(ctx);
  const period: Period = PERIODS.includes(input.period as Period) ? (input.period as Period) : "month";
  const e = await loadCoachEarnings({ ...ctx, params: {}, search: { period, ...(isDateKey(input.date) ? { at: input.date } : {}) } });
  const sum = (t: { net: number; gross: number; commission: number; lessons: number; sessions?: number; hours: number }) => ({ take_home: dollars(t.net), charged: dollars(t.gross), club_cut: dollars(t.commission), lessons: t.lessons, community_sessions: t.sessions ?? 0, hours: t.hours });
  return {
    period: e.label,
    earned_so_far: sum(e.totals),
    still_scheduled: sum(e.scheduled),
    same_point_last_period: sum(e.previous),
    by_kind: e.byKind.map((k) => ({ kind: k.kind, ...sum(k) })),
    by_place: e.byPlace.map((p) => ({ place: p.name, take_home: dollars(p.net), club_cut: dollars(p.commission) })),
    top_clients: e.clients.map((c) => ({ name: c.name, take_home: dollars(c.net), lessons: c.lessons })),
    waiting_to_be_paid: { total: dollars(e.owed.total), lessons: e.owed.lessons.map((r) => ({ lesson_id: r.lesson.id, clients: r.lesson.client_names, ...when(r.lesson.starts_at), amount: dollars(r.money.gross) })) },
    next_paydays: e.paydays.map((p) => ({ date: p.date, covers: `${p.from} to ${p.to}`, earned: dollars(p.earned), still_to_play: dollars(p.booked) })),
  };
}

/** Run a look-up tool. The result goes back to the model as JSON. */
export async function runRead(ctx: AssistantCtx, name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === "get_schedule") return getSchedule(ctx, input);
  if (name === "get_clients") return getClients(ctx);
  if (name === "get_earnings") return getEarnings(ctx, input);
  throw new ToolError(`Unknown tool ${name}.`);
}

// ───────────────────────── changing ─────────────────────────

/** A change the assistant wants to make, in the coach's words, with the portal action that would do it. */
export interface Proposal {
  title: string;
  lines: string[];
  confirm: string;
  danger?: boolean;
  action: string;
  input: Record<string, unknown>;
}

async function ownLesson(ctx: AssistantCtx, id: unknown): Promise<Lesson> {
  const u = coach(ctx);
  const l = str(id) ? await ctx.store.get("lessons", str(id)) : null;
  if (!l || l.coach_id !== u.id) throw new ToolError("That lesson isn't on your schedule. Look it up with get_schedule first.");
  return l;
}

const money = (v: unknown) => (v === "" || v === null || v === undefined ? "No price" : `$${Number(v).toFixed(2).replace(/\.00$/, "")}`);

function lessonLines(f: { kind: string; client_names: string; date: string; time: string; duration_min: number; location: string; court: unknown; price: unknown; repeat_weeks?: number; notes?: string }) {
  const start = zonedToUtc(f.date, f.time);
  const weeks = f.repeat_weeks ?? 1;
  return [
    `${LESSON_META[f.kind as Lesson["kind"]]?.label ?? "Lesson"} with ${f.client_names}`,
    `${fmtDay(start)} at ${fmtTime(start)} · ${f.duration_min} min`,
    ...(weeks > 1 ? [`Every week for ${weeks} weeks, until ${fmtDay(zonedToUtc(addDays(f.date, (weeks - 1) * 7), f.time))}`] : []),
    `${f.location ? placeLabel({ location: f.location, court: f.court ? Number(f.court) : null }) : "No location"} · ${money(f.price)}`,
    ...(f.notes ? [`Notes: ${f.notes}`] : []),
  ];
}

/** Turn a change the model asked for into something the coach can read and confirm. Nothing is saved here. */
export async function propose(ctx: AssistantCtx, name: string, input: Record<string, unknown>): Promise<Proposal> {
  const u = coach(ctx);
  if (name === "book_lesson") {
    const names = (Array.isArray(input.clients) ? input.clients : [input.clients]).map(str).filter(Boolean);
    if (!names.length) throw new ToolError("Say who the lesson is for.");
    if (!isDateKey(input.date) || !/^\d{2}:\d{2}$/.test(str(input.time))) throw new ToolError("A lesson needs a date (YYYY-MM-DD) and a start time (HH:MM, 24-hour).");
    const settings = await getSettings(ctx.store);
    const fields = {
      id: "",
      kind: names.length > 1 ? "semi_private" : "private",
      client_names: names.join(", "),
      date: input.date,
      time: str(input.time),
      duration_min: Number(input.minutes) || 60,
      location: has(input, "location") ? str(input.location) : settings.default_location,
      court: has(input, "court") ? input.court : "",
      price: has(input, "price") ? input.price : "",
      notes: str(input.notes),
      repeat_weeks: Math.min(26, Math.max(1, Math.round(Number(input.weeks) || 1))),
    };
    return { title: fields.repeat_weeks > 1 ? "Book weekly lessons" : "Book a lesson", lines: lessonLines(fields), confirm: fields.repeat_weeks > 1 ? `Book ${fields.repeat_weeks} lessons` : "Book lesson", action: "saveLesson", input: fields };
  }
  if (name === "change_lesson") {
    const l = await ownLesson(ctx, input.lesson_id);
    const names = has(input, "clients") ? (Array.isArray(input.clients) ? input.clients : [input.clients]).map(str).filter(Boolean) : l.client_names;
    const fields = {
      id: l.id,
      kind: names.length > 1 ? "semi_private" : "private",
      client_names: names.join(", "),
      date: isDateKey(input.date) ? input.date : dateKey(l.starts_at),
      time: /^\d{2}:\d{2}$/.test(str(input.time)) ? str(input.time) : timeKey(l.starts_at),
      duration_min: Number(input.minutes) || minutes(l),
      location: has(input, "location") ? str(input.location) : l.location,
      court: has(input, "court") ? input.court : (l.court ?? ""),
      price: has(input, "price") ? input.price : (dollars(l.price_cents) ?? ""),
      paid: !!l.paid_at,
      notes: has(input, "notes") ? str(input.notes) : l.notes,
    };
    return { title: "Change a lesson", lines: [`Was: ${fmtDay(l.starts_at)} at ${fmtTime(l.starts_at)}`, ...lessonLines(fields)], confirm: "Save changes", action: "saveLesson", input: fields };
  }
  if (name === "cancel_lesson") {
    const l = await ownLesson(ctx, input.lesson_id);
    return { title: "Cancel a lesson", lines: [`${LESSON_META[l.kind].label} with ${l.client_names.join(", ")}`, `${fmtDay(l.starts_at)} at ${fmtTime(l.starts_at)}`, "It comes off your schedule and can't be brought back."], confirm: "Cancel lesson", danger: true, action: "deleteLesson", input: { lesson_id: l.id } };
  }
  if (name === "mark_lesson_paid") {
    const l = await ownLesson(ctx, input.lesson_id);
    const paid = input.paid !== false;
    return { title: paid ? "Mark a lesson paid" : "Mark a lesson unpaid", lines: [`${l.client_names.join(", ")} · ${fmtDay(l.starts_at)} at ${fmtTime(l.starts_at)}`, money(dollars(l.price_cents))], confirm: paid ? "Mark paid" : "Mark unpaid", action: "setLessonPaid", input: { lesson_id: l.id, paid: paid ? "yes" : "no" } };
  }
  if (name === "save_client") {
    const cards = await ctx.store.list("clients", { eq: { coach_id: u.id } });
    const prev = cards.find((c) => c.id === str(input.client_id)) ?? cards.find((c) => sameName(c.full_name, str(input.name))) ?? null;
    if (str(input.client_id) && !prev) throw new ToolError("That client isn't on your list. Look them up with get_clients first.");
    const pick = (k: "phone" | "email" | "level" | "goals" | "notes") => (has(input, k) ? str(input[k]) : (prev?.[k] ?? ""));
    const fields = { id: prev?.id ?? "", full_name: prev && (!str(input.name) || sameName(prev.full_name, str(input.name))) ? prev.full_name : str(input.name), phone: pick("phone"), email: pick("email"), level: pick("level"), goals: pick("goals"), notes: pick("notes") };
    if (!fields.full_name) throw new ToolError("A client needs a name.");
    const changed = (["phone", "email", "level", "goals", "notes"] as const).filter((k) => has(input, k)).map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${fields[k] || "(empty)"}`);
    return { title: prev ? `Update ${prev.full_name}` : "Add a client", lines: [fields.full_name, ...changed], confirm: prev ? "Save client" : "Add client", action: "saveClient", input: fields };
  }
  throw new ToolError(`Unknown tool ${name}.`);
}

/** The phone to open WhatsApp with for a drafted message: the coach's client card, else a community player of that name. */
export async function contactFor(ctx: AssistantCtx, name: string): Promise<string | null> {
  const u = coach(ctx);
  if (!name.trim()) return null;
  const card = (await ctx.store.list("clients", { eq: { coach_id: u.id } })).find((c) => sameName(c.full_name, name));
  if (card?.phone) return card.phone;
  return (await ctx.store.list("profiles")).find((p) => p.id !== u.id && sameName(p.full_name, name))?.phone ?? null;
}

// ───────────────────────── conversation ─────────────────────────

export const blocksOf = (m: Msg): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content);
export const toolCalls = (reply: AssistantReply) => reply.content.filter((b) => b.type === "tool_use" && b.id && b.name);
export const toolResult = (id: string, content: unknown, isError = false): Block => ({ type: "tool_result", tool_use_id: id, content: typeof content === "string" ? content : JSON.stringify(content), ...(isError ? { is_error: true } : {}) });
