// Read models: one loader per screen. Each returns plain JSON for the UI.
import type { Actor, Booking, Lesson, Profile, Session, SessionType } from "./types";
import type { Store } from "./store";
import { addDays, dateKey, isDateKey, startOfWeek, weekDays, zonedToUtc } from "./time";
import { coachesSession, getSettings, holdsSeat, isActive, isAdmin, isStaff } from "./services";
import { by, LESSON_META, lessonTitle, SESSION_META, sessionTitle } from "./util";

export class NotFound extends Error {}
export class Forbidden extends Error {}

export interface LoadCtx {
  store: Store;
  actor: Actor;
  params: Record<string, string>;
  search: Record<string, string>;
  now: Date;
}

export type Person = Pick<Profile, "id" | "full_name" | "role">;

export interface SessionView extends Session {
  coaches: Person[];
  booked: number;
  spots_left: number;
  waitlist: number;
  my_booking: Pick<Booking, "id" | "status" | "waitlist_position"> | null;
}

/** One entry on a coach's calendar: a community session or their own lesson. */
export interface ScheduleItem {
  id: string;
  title: string;
  label: string;
  color: string;
  session_type?: SessionType; // community sessions only; lessons have none
  starts_at: string;
  ends_at: string;
  href: string;
  detail: string;
  cancelled: boolean;
}

const person = (p: Profile): Person => ({ id: p.id, full_name: p.full_name, role: p.role });

async function profileMap(store: Store) {
  const profiles = await store.list("profiles");
  return { profiles, profile: new Map(profiles.map((p) => [p.id, p])) };
}
type Lookups = Awaited<ReturnType<typeof profileMap>>;

async function enrich(store: Store, sessions: Session[], L: Lookups, userId?: string | null): Promise<SessionView[]> {
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const [stats, mineAll] = await Promise.all([
    store.sessionStats(ids),
    userId ? store.list("bookings", { eq: { user_id: userId }, in: { field: "session_id", values: ids } }) : Promise.resolve([] as Booking[]),
  ]);
  return sessions.map((s) => {
    const st = stats[s.id] ?? { booked: 0, waitlist: 0 };
    const mine = mineAll.find((b) => b.session_id === s.id && isActive(b));
    return {
      ...s,
      coaches: s.coach_ids.map((id) => L.profile.get(id)).filter(Boolean).map((p) => person(p!)),
      booked: st.booked,
      spots_left: Math.max(0, s.capacity - st.booked),
      waitlist: st.waitlist,
      my_booking: mine ? { id: mine.id, status: mine.status, waitlist_position: mine.waitlist_position } : null,
    };
  });
}

function weekParam(ctx: LoadCtx) {
  const w = ctx.search.week;
  return startOfWeek(isDateKey(w) ? w : dateKey(ctx.now));
}
const startIso = (key: string) => zonedToUtc(key, "00:00").toISOString();

const isCommunity = (s: Session) => !!s.session_type;

async function communityBetween(store: Store, fromKey: string, toKey: string) {
  const rows = await store.list("sessions", {
    gte: { field: "starts_at", value: startIso(fromKey) },
    lt: { field: "starts_at", value: startIso(toKey) },
    order: { field: "starts_at" },
  });
  return rows.filter(isCommunity);
}

// ───────────────────────── player ─────────────────────────

export async function loadSchedule(ctx: LoadCtx) {
  const today = dateKey(ctx.now);
  const [L, settings] = await Promise.all([profileMap(ctx.store), getSettings(ctx.store)]);
  const now = ctx.now.toISOString();
  const rows = (await communityBetween(ctx.store, today, addDays(today, settings.booking_horizon_days + 1))).filter((s) => s.status === "published" && s.starts_at > now);
  const u = ctx.actor.user;
  const [sessions, stats] = await Promise.all([enrich(ctx.store, rows, L, u?.id), u ? playerStats(ctx, u.id) : null]);
  const days = [...new Set(sessions.map((s) => dateKey(s.starts_at)))].map((day) => ({ day, sessions: sessions.filter((s) => dateKey(s.starts_at) === day) }));
  const me = u && stats ? { first_name: u.full_name.split(" ")[0], next: sessions.find((s) => s.my_booking?.status === "confirmed") ?? null, ...stats } : null;
  const totals = {
    sessions: sessions.length,
    booked: sessions.reduce((n, s) => n + s.booked, 0),
    open: sessions.reduce((n, s) => n + s.spots_left, 0),
  };
  return { today, days, totals, me, horizon: settings.booking_horizon_days, window: settings.cancellation_window_hours, policy: settings.cancellation_policy };
}

/** Sessions a player has played, and how many weeks in a row (ending this week or last) they've been on court. */
export function playStats(playedStarts: string[], now: Date) {
  const weeks = new Set(playedStarts.map((iso) => startOfWeek(dateKey(iso))));
  let week = startOfWeek(dateKey(now));
  if (!weeks.has(week)) week = addDays(week, -7);
  let streak = 0;
  while (weeks.has(week)) {
    streak++;
    week = addDays(week, -7);
  }
  return { played: playedStarts.length, streak_weeks: streak };
}

async function playerStats(ctx: LoadCtx, userId: string) {
  const now = ctx.now.toISOString();
  const kept = (await ctx.store.list("bookings", { eq: { user_id: userId } })).filter((b) => holdsSeat(b) && b.attended !== false);
  const sessions = kept.length ? await ctx.store.list("sessions", { in: { field: "id", values: kept.map((b) => b.session_id) } }) : [];
  return playStats(sessions.filter((s) => isCommunity(s) && s.status !== "cancelled" && s.starts_at <= now).map((s) => s.starts_at), ctx.now);
}

export type BookingRow = { booking: Booking; session: SessionView };

export async function loadMySessions(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const [L, bookings, settings] = await Promise.all([profileMap(ctx.store), ctx.store.list("bookings", { eq: { user_id: u.id } }), getSettings(ctx.store)]);
  const sessions = (await ctx.store.list("sessions", { in: { field: "id", values: bookings.map((b) => b.session_id) } })).filter(isCommunity);
  const views = new Map((await enrich(ctx.store, sessions, L, u.id)).map((s) => [s.id, s]));
  const rows: BookingRow[] = bookings.flatMap((b) => {
    const session = views.get(b.session_id);
    return session ? [{ booking: b, session }] : [];
  });
  const now = ctx.now.toISOString();
  const stats = playStats(rows.filter((r) => holdsSeat(r.booking) && r.booking.attended !== false && r.session.status !== "cancelled" && r.session.starts_at <= now).map((r) => r.session.starts_at), ctx.now);
  const upcoming = rows.filter((r) => r.session.starts_at > now && isActive(r.booking)).sort(by((r) => r.session.starts_at));
  return {
    confirmed: upcoming.filter((r) => r.booking.status === "confirmed"),
    waitlisted: upcoming.filter((r) => r.booking.status === "waitlisted"),
    history: rows
      .filter((r) => r.booking.status === "cancelled" || (r.session.starts_at <= now && holdsSeat(r.booking)))
      .sort(by((r) => r.session.starts_at, -1))
      .slice(0, 30),
    stats,
    window: settings.cancellation_window_hours,
  };
}

export async function loadWelcome(ctx: LoadCtx) {
  const a = ctx.actor;
  const id = a.identifier ?? "";
  return {
    profile: a.user,
    prefill: { email: id.includes("@") ? id : a.user?.email ?? "", phone: id.startsWith("+") ? id : a.user?.phone ?? "" },
  };
}

export async function loadProfile(ctx: LoadCtx) {
  return { profile: ctx.actor.user! };
}

// ───────────────────────── coach ─────────────────────────

const hours = (from: string, to: string) => Math.round(((new Date(to).getTime() - new Date(from).getTime()) / 3600000) * 10) / 10;

export async function loadCoachSchedule(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const monday = weekParam(ctx);
  const nextMonday = addDays(monday, 7);
  const [L, rows, lessons, calendars] = await Promise.all([
    profileMap(ctx.store),
    communityBetween(ctx.store, monday, nextMonday),
    ctx.store.list("lessons", { eq: { coach_id: u.id }, gte: { field: "starts_at", value: startIso(monday) }, lt: { field: "starts_at", value: startIso(nextMonday) } }),
    ctx.store.list("coach_calendars", { eq: { coach_id: u.id } }),
  ]);
  const sessions = await enrich(ctx.store, rows.filter((s) => s.coach_ids.includes(u.id) && s.status !== "draft"), L, null);
  const items: ScheduleItem[] = [
    ...sessions.map((s) => {
      const meta = SESSION_META[s.session_type!];
      return { id: s.id, title: s.title || meta.label, label: meta.label, color: meta.color, session_type: s.session_type!, starts_at: s.starts_at, ends_at: s.ends_at, href: `/coach/sessions/${s.id}`, detail: `${s.booked}/${s.capacity} booked${s.waitlist ? ` · ${s.waitlist} waiting` : ""}`, cancelled: s.status === "cancelled" };
    }),
    ...lessons.map((l) => {
      const meta = LESSON_META[l.kind];
      return { id: l.id, title: lessonTitle(l), label: meta.label, color: meta.color, starts_at: l.starts_at, ends_at: l.ends_at, href: `/coach/lessons/${l.id}`, detail: l.location, cancelled: false };
    }),
  ].sort(by((i) => i.starts_at));
  const active = items.filter((i) => !i.cancelled);
  return {
    monday,
    days: weekDays(monday),
    today: dateKey(ctx.now),
    nowIso: ctx.now.toISOString(),
    items,
    summary: {
      community: sessions.filter((s) => s.status !== "cancelled").length,
      lessons: lessons.length,
      hours: Math.round(active.reduce((n, i) => n + hours(i.starts_at, i.ends_at), 0) * 10) / 10,
    },
    calendar: calendars[0] ?? null,
    live: ctx.store.kind === "supabase",
  };
}

export async function loadCoachSession(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const s = await ctx.store.get("sessions", ctx.params.id);
  if (!s || !isCommunity(s)) throw new NotFound();
  if (!coachesSession(u, s)) throw new Forbidden();
  const L = await profileMap(ctx.store);
  const [[view], bookings] = await Promise.all([enrich(ctx.store, [s], L, null), ctx.store.list("bookings", { eq: { session_id: s.id } })]);
  const roster = bookings
    .filter(isActive)
    .sort((a, b) => (a.status === "waitlisted" ? 1 : 0) - (b.status === "waitlisted" ? 1 : 0) || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0) || (a.created_at < b.created_at ? -1 : 1))
    .map((b) => {
      const p = L.profile.get(b.user_id);
      return { booking: b, player: p ? { id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, emergency_contact: p.emergency_contact } : null };
    });
  return { session: view, roster, isAdmin: isAdmin(u) };
}

export async function loadLessonEditor(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const [settings, mine] = await Promise.all([getSettings(ctx.store), ctx.store.list("lessons", { eq: { coach_id: u.id } })]);
  const clients = [...new Set(mine.flatMap((l) => l.client_names))].sort();
  if (ctx.params.id === "new") {
    return {
      lesson: null as Lesson | null,
      clients,
      prefill: {
        kind: (ctx.search.kind === "semi_private" ? "semi_private" : "private") as Lesson["kind"],
        date: isDateKey(ctx.search.date) ? ctx.search.date : dateKey(ctx.now),
        time: /^\d{2}:\d{2}$/.test(ctx.search.time ?? "") ? ctx.search.time : "08:00",
        location: settings.default_location,
      },
    };
  }
  const lesson = await ctx.store.get("lessons", ctx.params.id);
  if (!lesson) throw new NotFound();
  if (lesson.coach_id !== u.id) throw new Forbidden();
  return { lesson: lesson as Lesson | null, clients, prefill: null };
}

// ───────────────────────── admin ─────────────────────────

export async function loadAdminSchedule(ctx: LoadCtx) {
  const tab = ["upcoming", "past", "draft", "cancelled"].includes(ctx.search.tab) ? ctx.search.tab : "upcoming";
  const now = ctx.now.toISOString();
  const [L, rows] = await Promise.all([profileMap(ctx.store), ctx.store.list("sessions", { order: { field: "starts_at" } })]);
  const all = rows.filter(isCommunity);
  const filtered = all.filter((s) =>
    tab === "draft" ? s.status === "draft" : tab === "cancelled" ? s.status === "cancelled" : tab === "past" ? s.status === "published" && s.starts_at <= now : s.status === "published" && s.starts_at > now,
  );
  const list = tab === "past" ? filtered.reverse().slice(0, 60) : filtered.slice(0, 80);
  return {
    tab,
    sessions: await enrich(ctx.store, list, L, null),
    counts: {
      upcoming: all.filter((s) => s.status === "published" && s.starts_at > now).length,
      draft: all.filter((s) => s.status === "draft").length,
    },
  };
}

export async function loadSessionEditor(ctx: LoadCtx) {
  const [L, settings, s] = await Promise.all([profileMap(ctx.store), getSettings(ctx.store), ctx.params.id === "new" ? null : ctx.store.get("sessions", ctx.params.id)]);
  const coaches = L.profiles.filter(isStaff).map(person).sort(by((p) => p.full_name));
  const members = L.profiles.filter((p) => p.status === "active").map(person).sort(by((p) => p.full_name));
  const defaults = {
    location: settings.default_location,
    group: { capacity: settings.default_group_capacity, price_cents: settings.default_group_price_cents, duration_min: settings.default_group_duration_min },
    performance_accelerator: { capacity: settings.default_pa_capacity, price_cents: settings.default_pa_price_cents, duration_min: settings.default_pa_duration_min },
  };
  if (ctx.params.id === "new") {
    return {
      session: null,
      roster: [],
      coaches,
      members,
      defaults,
      prefill: {
        session_type: ctx.search.type === "performance_accelerator" ? ("performance_accelerator" as const) : ("group" as const),
        date: isDateKey(ctx.search.date) ? ctx.search.date : addDays(dateKey(ctx.now), 1),
        time: /^\d{2}:\d{2}$/.test(ctx.search.time ?? "") ? ctx.search.time : "17:00",
        coach_ids: [ctx.actor.user!.id],
      },
    };
  }
  if (!s || !isCommunity(s)) throw new NotFound();
  const [[view], bookings] = await Promise.all([enrich(ctx.store, [s], L, null), ctx.store.list("bookings", { eq: { session_id: s.id } })]);
  const roster = bookings
    .sort(by((b) => `${["confirmed", "waitlisted", "cancelled"].indexOf(b.status)}-${String(b.waitlist_position ?? 0).padStart(3, "0")}-${b.created_at}`))
    .map((b) => {
      const p = L.profile.get(b.user_id);
      return { booking: b, player: p ? { ...person(p), email: p.email, phone: p.phone } : null };
    });
  return { session: view, roster, coaches, members, defaults, prefill: null };
}

export async function loadAdminCoaches(ctx: LoadCtx) {
  const now = ctx.now.toISOString();
  const today = startIso(dateKey(ctx.now));
  const [L, sessions, allLessons, calendars] = await Promise.all([
    profileMap(ctx.store),
    ctx.store.list("sessions", { gte: { field: "starts_at", value: today }, order: { field: "starts_at" } }),
    ctx.store.list("lessons", { gte: { field: "starts_at", value: today } }),
    ctx.store.list("coach_calendars"),
  ]);
  const lessons = allLessons.filter((l) => l.starts_at >= now);
  const assigned = await enrich(ctx.store, sessions.filter((s) => s.starts_at >= now && isCommunity(s) && s.status === "published"), L, null);
  return {
    coaches: L.profiles
      .filter((p) => isStaff(p) && p.status === "active")
      .sort(by((p) => p.full_name))
      .map((p) => ({
        ...person(p),
        email: p.email,
        sessions: assigned.filter((s) => s.coach_ids.includes(p.id)),
        lessons: lessons.filter((l) => l.coach_id === p.id).length,
        calendar: calendars.find((c) => c.coach_id === p.id) ?? null,
      })),
    unassigned: assigned.filter((s) => !s.coach_ids.length),
  };
}

export async function loadAdminMembers(ctx: LoadCtx) {
  const q = (ctx.search.q ?? "").toLowerCase().trim();
  const role = ctx.search.role ?? "";
  const [L, bookings] = await Promise.all([profileMap(ctx.store), ctx.store.list("bookings")]);
  const count = new Map<string, number>();
  for (const b of bookings) if (holdsSeat(b)) count.set(b.user_id, (count.get(b.user_id) ?? 0) + 1);
  const members = L.profiles
    .filter((p) => !role || p.role === role)
    .filter((p) => !q || [p.full_name, p.email ?? "", p.phone ?? ""].some((v) => v.toLowerCase().includes(q)))
    .sort(by((p) => p.full_name))
    .map((p) => ({ ...p, bookings: count.get(p.id) ?? 0 }));
  return { members, q, role, total: L.profiles.length };
}

export async function loadAdminMember(ctx: LoadCtx) {
  const id = ctx.params.id;
  const now = ctx.now.toISOString();
  const today = startIso(dateKey(ctx.now));
  const [profile, L, bookings, coachSessions, coachLessons, calendars] = await Promise.all([
    ctx.store.get("profiles", id),
    profileMap(ctx.store),
    ctx.store.list("bookings", { eq: { user_id: id } }),
    ctx.store.list("sessions", { contains: { field: "coach_ids", value: id }, gte: { field: "starts_at", value: today } }),
    ctx.store.list("lessons", { eq: { coach_id: id }, gte: { field: "starts_at", value: today } }),
    ctx.store.list("coach_calendars"),
  ]);
  if (!profile) throw new NotFound();
  const sessions = (await ctx.store.list("sessions", { in: { field: "id", values: bookings.map((b) => b.session_id) } })).filter(isCommunity);
  const views = await enrich(ctx.store, sessions, L, null);
  const history = views.flatMap((session) => {
    const booking = bookings.find((b) => b.session_id === session.id);
    return booking ? [{ session, booking }] : [];
  });
  return {
    profile,
    history: history.sort(by((r) => r.session.starts_at, -1)),
    coaching: {
      sessions: coachSessions.filter((s) => s.starts_at >= now && isCommunity(s) && s.status === "published").length,
      lessons: coachLessons.filter((l) => l.starts_at >= now).length,
      calendar: calendars.find((c) => c.coach_id === profile.id) ?? null,
    },
  };
}

export async function loadSettingsPage(ctx: LoadCtx) {
  return { settings: await getSettings(ctx.store) };
}
