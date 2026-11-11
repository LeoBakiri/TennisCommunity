// Read models: one loader per screen. Each returns plain JSON for the UI.
import type { Actor, Booking, Client, Feedback, Lesson, Profile, Session, SessionType } from "./types";
import type { Store } from "./store";
import { addDays, dateKey, isDateKey, startOfWeek, timeKey, weekDays, zonedToUtc } from "./time";
import { coachesSession, getSettings, holdsSeat, isActive, isAdmin, isStaff } from "./services";
import { by, LESSON_META, lessonTitle, placeLabel, SESSION_META, sessionTitle } from "./util";
import { addMoney, buckets, inRange, lessonMoney, periodLabel, periodRange, PERIODS, ruleFor, type Period } from "./earnings";
import { clientSummary, hasClient, nameKey, nextSameWeekday, sameName, type ClientStatus } from "./clients";
import { goalOf, progress, streakWeeks, type Played } from "./progress";

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
  offered: number;
  my_booking: Pick<Booking, "id" | "status" | "waitlist_position" | "spot_offered_at"> | null;
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
  // Players only see their own profile, so coach names come separately, without contact details.
  const [rows, staff] = await Promise.all([store.list("profiles"), store.staffNames().catch(() => [])]);
  const profile = new Map(rows.map((p) => [p.id, p]));
  for (const s of staff)
    if (!profile.has(s.id)) profile.set(s.id, { ...s, email: null, phone: null, emergency_contact: "", status: "active", onboarded: true, created_at: "" });
  return { profiles: [...profile.values()], profile };
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
    const st = stats[s.id] ?? { booked: 0, waitlist: 0, offered: 0 };
    const mine = mineAll.find((b) => b.session_id === s.id && isActive(b));
    return {
      ...s,
      coaches: s.coach_ids.map((id) => L.profile.get(id)).filter(Boolean).map((p) => person(p!)),
      booked: st.booked,
      spots_left: Math.max(0, s.capacity - st.booked),
      waitlist: st.waitlist,
      offered: st.offered,
      my_booking: mine ? { id: mine.id, status: mine.status, waitlist_position: mine.waitlist_position, spot_offered_at: mine.spot_offered_at ?? null } : null,
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
  const [sessions, stats] = await Promise.all([enrich(ctx.store, rows, L, u?.id), u ? playerProgress(ctx, u) : null]);
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
  return { played: playedStarts.length, streak_weeks: streakWeeks(weeks, now).weeks };
}

/** Community sessions the player was on court for: booked, not marked a no-show, and already started. */
async function playedSessions(ctx: LoadCtx, userId: string) {
  const now = ctx.now.toISOString();
  const kept = (await ctx.store.list("bookings", { eq: { user_id: userId } })).filter((b) => holdsSeat(b) && b.attended !== false);
  const sessions = kept.length ? await ctx.store.list("sessions", { in: { field: "id", values: kept.map((b) => b.session_id) } }) : [];
  return sessions.filter((s) => isCommunity(s) && s.status !== "cancelled" && s.starts_at <= now);
}

/** Feedback is new; until its table reaches the live database, players simply have none. */
const myFeedback = (ctx: LoadCtx, userId: string) => ctx.store.list("feedback", { eq: { user_id: userId } }).catch(() => [] as Feedback[]);

async function playerProgress(ctx: LoadCtx, u: Profile, played?: Session[], feedback?: Feedback[]) {
  const [sessions, notes] = await Promise.all([played ?? playedSessions(ctx, u.id), feedback ?? myFeedback(ctx, u.id)]);
  return progress({ played: sessions.map((s) => ({ starts_at: s.starts_at, session_type: s.session_type! }) satisfies Played), feedback: notes, goal: goalOf(u), now: ctx.now });
}

export async function loadMyGame(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const today = dateKey(ctx.now);
  const month = `${today.slice(0, 7)}-01`;
  const nextMonth = `${addDays(month, 32).slice(0, 7)}-01`;
  const [played, feedback, L, board] = await Promise.all([
    playedSessions(ctx, u.id),
    myFeedback(ctx, u.id),
    profileMap(ctx.store),
    ctx.store.leaderboard(startIso(month), startIso(nextMonth)).catch(() => []),
  ]);
  const me = await playerProgress(ctx, u, played, feedback);
  const sessionsById = new Map((await ctx.store.list("sessions", { in: { field: "id", values: [...new Set(feedback.map((f) => f.session_id))] } })).map((s) => [s.id, s]));
  const coachName = (id: string) => L.profile.get(id)?.full_name ?? "Your coach";
  const feed = [...feedback]
    .sort(by((f) => f.created_at, -1))
    .map((f) => {
      const s = sessionsById.get(f.session_id);
      return { id: f.id, coach: coachName(f.coach_id), skills: f.skills, tip: f.tip, at: s?.starts_at ?? f.created_at, session: s ? sessionTitle(s) : "Session" };
    })
    .filter((f) => f.skills.length || f.tip);
  const focusCutoff = new Date(ctx.now.getTime() - 28 * 86400000).toISOString();
  const focus = feed.find((f) => f.tip && f.at >= focusCutoff) ?? null;
  const ranked = board.map((r, i) => ({ ...r, rank: i + 1, me: r.user_id === u.id }));
  const mine = ranked.find((r) => r.me) ?? null;
  const ahead = mine && mine.rank > 1 ? ranked[mine.rank - 2] : null;
  const days = Math.round((zonedToUtc(nextMonth, "00:00").getTime() - zonedToUtc(today, "00:00").getTime()) / 86400000);
  return {
    first_name: u.full_name.split(" ")[0],
    me,
    feed: feed.slice(0, 6),
    focus,
    board: {
      month,
      top: ranked.slice(0, 5),
      mine: mine && mine.rank > 5 ? mine : null,
      chase: ahead ? { name: ahead.name, gap: ahead.played - mine!.played + 1 } : null,
      leading: mine?.rank === 1,
      resets_in: days,
      hidden: !!u.leaderboard_hidden,
    },
  };
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
      return { id: l.id, title: lessonTitle(l), label: meta.label, color: meta.color, starts_at: l.starts_at, ends_at: l.ends_at, href: `/coach/lessons/${l.id}`, detail: placeLabel(l), cancelled: false };
    }),
  ].sort(by((i) => i.starts_at));
  const active = items.filter((i) => !i.cancelled);
  const now = ctx.now.toISOString();
  const live = sessions.filter((s) => s.status !== "cancelled");
  return {
    first_name: u.full_name.split(" ")[0],
    next: active.find((i) => i.ends_at > now) ?? null,
    players: { booked: live.reduce((n, s) => n + s.booked, 0), capacity: live.reduce((n, s) => n + s.capacity, 0), waitlist: live.reduce((n, s) => n + s.waitlist, 0) },
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
  const [[view], bookings, notes] = await Promise.all([
    enrich(ctx.store, [s], L, null),
    ctx.store.list("bookings", { eq: { session_id: s.id } }),
    ctx.store.list("feedback", { eq: { session_id: s.id } }).catch(() => null),
  ]);
  // null until the My Game migration reaches the database, which hides the skill taps.
  const feedback = notes && Object.fromEntries(notes.map((f) => [f.user_id, { skills: f.skills, tip: f.tip }]));
  const roster = bookings
    .filter(isActive)
    .sort((a, b) => (a.status === "waitlisted" ? 1 : 0) - (b.status === "waitlisted" ? 1 : 0) || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0) || (a.created_at < b.created_at ? -1 : 1))
    .map((b) => {
      const p = L.profile.get(b.user_id);
      return { booking: b, player: p ? { id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, emergency_contact: p.emergency_contact } : null };
    });
  return { session: view, roster, isAdmin: isAdmin(u), feedback, started: s.starts_at <= ctx.now.toISOString() };
}

const CLIENT_PAGE = /^\/coach\/clients\/[\w-]+$/;
const lessonMinutes = (l: Pick<Lesson, "starts_at" | "ends_at">) => Math.round((new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()) / 60000);

export async function loadLessonEditor(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const [settings, mine, rules, cards] = await Promise.all([getSettings(ctx.store), ctx.store.list("lessons", { eq: { coach_id: u.id } }), ctx.store.list("commission_rules"), ctx.store.list("clients", { eq: { coach_id: u.id } })]);
  const seen = new Set<string>();
  const clients = [...cards.map((c) => c.full_name), ...mine.flatMap((l) => l.client_names)].filter((n) => !seen.has(nameKey(n)) && !!seen.add(nameKey(n))).sort();
  const cardIds = Object.fromEntries(cards.map((c) => [nameKey(c.full_name), c.id]));
  const places = [...new Set([settings.default_location, ...mine.map((l) => l.location)].filter(Boolean))].sort();
  const back = CLIENT_PAGE.test(ctx.search.back ?? "") ? ctx.search.back : "";
  if (ctx.params.id === "new") {
    const s = ctx.search;
    // "Book a lesson" from a client card or a community player names who it's for.
    const member = s.member ? await ctx.store.get("profiles", s.member) : null;
    const client = cards.find((c) => c.id === s.client)?.full_name ?? member?.full_name ?? "";
    const duration = Number(s.duration);
    return {
      lesson: null as Lesson | null,
      clients,
      cardIds,
      places,
      rules,
      back,
      prefill: {
        kind: (s.kind === "semi_private" ? "semi_private" : "private") as Lesson["kind"],
        date: isDateKey(s.date) ? s.date : dateKey(ctx.now),
        time: /^\d{2}:\d{2}$/.test(s.time ?? "") ? s.time : "08:00",
        location: s.location?.trim() || settings.default_location,
        client,
        duration: Number.isInteger(duration) && duration >= 15 && duration <= 600 ? duration : 60,
        price: /^\d+(\.\d{1,2})?$/.test(s.price ?? "") ? s.price : "",
      },
    };
  }
  const lesson = await ctx.store.get("lessons", ctx.params.id);
  if (!lesson) throw new NotFound();
  if (lesson.coach_id !== u.id) throw new Forbidden();
  return { lesson: lesson as Lesson | null, clients, cardIds, places, rules, back, prefill: null };
}

/** One coach's lesson income for a week, month or year. Community sessions are counted, not priced. */
export async function loadCoachEarnings(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const period: Period = PERIODS.includes(ctx.search.period as Period) ? (ctx.search.period as Period) : "week";
  const today = dateKey(ctx.now);
  const at = isDateKey(ctx.search.at) ? ctx.search.at : today;
  const range = periodRange(period, at);
  const before = periodRange(period, range.prev);
  // A year back covers the previous period and any lesson still waiting to be paid.
  const since = [before.from, addDays(today, -400)].sort()[0];
  const [lessons, rules, community] = await Promise.all([
    ctx.store.list("lessons", { eq: { coach_id: u.id }, gte: { field: "starts_at", value: startIso(since) }, order: { field: "starts_at" } }),
    ctx.store.list("commission_rules"),
    communityBetween(ctx.store, range.from, range.to),
  ]);
  const now = ctx.now.toISOString();
  const rows = lessons.map((l) => ({ lesson: l, money: lessonMoney(l, rules), done: l.ends_at <= now, hours: hours(l.starts_at, l.ends_at), place: ruleFor(l.location, rules)?.place ?? null }));
  type R = (typeof rows)[number];
  const within = (from: string, to: string) => rows.filter((r) => inRange(r.lesson.starts_at, from, to));
  const inPeriod = within(range.from, range.to);
  const total = (rs: R[]) => ({ ...addMoney(rs.map((r) => r.money)), lessons: rs.length, hours: Math.round(rs.reduce((n, r) => n + r.hours, 0) * 10) / 10 });

  const earned = inPeriod.filter((r) => r.done);
  const t = total(earned);
  const scheduled = total(inPeriod.filter((r) => !r.done));
  // Compare like with like: the same share of the previous period that has passed in this one.
  const elapsed = Math.min(1, Math.max(0, (ctx.now.getTime() - new Date(startIso(range.from)).getTime()) / (new Date(startIso(range.to)).getTime() - new Date(startIso(range.from)).getTime())));
  const prevCut = new Date(new Date(startIso(before.from)).getTime() + elapsed * (new Date(startIso(before.to)).getTime() - new Date(startIso(before.from)).getTime())).toISOString();
  const previous = total(within(before.from, before.to).filter((r) => r.lesson.ends_at <= prevCut));

  const sumBy = (rs: R[], key: (r: R) => string[]) => {
    const m = new Map<string, { net: number; gross: number; commission: number; lessons: number }>();
    for (const r of rs) {
      const keys = key(r);
      for (const k of keys) {
        const e = m.get(k) ?? { net: 0, gross: 0, commission: 0, lessons: 0 };
        // Semi-private income is split evenly between its players.
        e.net += r.money.net / keys.length;
        e.gross += r.money.gross / keys.length;
        e.commission += r.money.commission / keys.length;
        e.lessons += 1;
        m.set(k, e);
      }
    }
    return [...m.entries()].map(([name, e]) => ({ name, ...e, net: Math.round(e.net), gross: Math.round(e.gross), commission: Math.round(e.commission) })).sort(by((e) => e.net, -1));
  };

  const owed = rows.filter((r) => r.done && !r.lesson.paid_at && r.money.gross > 0).map((r) => ({ lesson: r.lesson, money: r.money }));
  const view = (r: R) => ({ lesson: r.lesson, money: r.money, done: r.done, place: r.place });
  const communitySessions = community.filter((s) => s.coach_ids.includes(u.id) && s.status === "published");
  return {
    period,
    at,
    today,
    label: periodLabel(period, at),
    current: inRange(now, range.from, range.to),
    prev: range.prev,
    next: range.next,
    totals: { ...t, per_hour: t.hours ? Math.round(t.net / t.hours / 100) * 100 : 0, unpriced: inPeriod.filter((r) => !r.money.priced) },
    scheduled,
    previous,
    chart: buckets(period, at).map((b) => {
      const rs = within(b.from, b.to);
      return { key: b.key, label: b.label, earned: addMoney(rs.filter((r) => r.done).map((r) => r.money)).net, scheduled: addMoney(rs.filter((r) => !r.done).map((r) => r.money)).net, current: today >= b.from && today < b.to };
    }),
    byKind: (["private", "semi_private"] as const).map((k) => ({ kind: k, ...total(inPeriod.filter((r) => r.lesson.kind === k)) })),
    byPlace: sumBy(inPeriod, (r) => [r.place ?? (r.lesson.location || "No location")]).map((p) => ({ ...p, commissioned: rules.some((x) => x.place === p.name) })),
    clients: sumBy(inPeriod, (r) => (r.lesson.client_names.length ? r.lesson.client_names : ["Unnamed"])).slice(0, 6),
    lessons: inPeriod.map(view).sort(by((r) => r.lesson.starts_at, -1)),
    owed: { total: owed.reduce((n, r) => n + r.money.gross, 0), lessons: owed },
    community: { sessions: communitySessions.length, hours: Math.round(communitySessions.reduce((n, s) => n + hours(s.starts_at, s.ends_at), 0) * 10) / 10 },
    rules,
  };
}

// ───────────────────────── clients ─────────────────────────

export const CLIENT_TABS = ["all", "booked", "rebook", "lapsed", "owes", "community"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

/** Community players this coach has had on court in the last six months, with how often. */
async function communityRegulars(ctx: LoadCtx, coachId: string, L: Lookups) {
  const now = ctx.now.toISOString();
  const played = (await ctx.store.list("sessions", { contains: { field: "coach_ids", value: coachId }, gte: { field: "starts_at", value: startIso(addDays(dateKey(ctx.now), -180)) } })).filter(
    (s) => isCommunity(s) && s.status === "published" && s.starts_at <= now,
  );
  if (!played.length) return [];
  const when = new Map(played.map((s) => [s.id, s.starts_at]));
  const bookings = await ctx.store.list("bookings", { in: { field: "session_id", values: played.map((s) => s.id) } });
  const seen = new Map<string, { sessions: number; last: string }>();
  for (const b of bookings) {
    if (!holdsSeat(b) || b.attended === false || b.user_id === coachId) continue;
    const e = seen.get(b.user_id) ?? { sessions: 0, last: "" };
    e.sessions++;
    if (when.get(b.session_id)! > e.last) e.last = when.get(b.session_id)!;
    seen.set(b.user_id, e);
  }
  return [...seen.entries()].flatMap(([id, e]) => {
    const p = L.profile.get(id);
    return p ? [{ id: p.id, full_name: p.full_name, phone: p.phone, email: p.email, ...e }] : [];
  });
}

export async function loadCoachClients(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const tab: ClientTab = CLIENT_TABS.includes(ctx.search.tab as ClientTab) ? (ctx.search.tab as ClientTab) : "all";
  const q = (ctx.search.q ?? "").toLowerCase().trim();
  const [L, cards, lessons, rules] = await Promise.all([
    profileMap(ctx.store),
    ctx.store.list("clients", { eq: { coach_id: u.id } }),
    ctx.store.list("lessons", { eq: { coach_id: u.id } }),
    ctx.store.list("commission_rules"),
  ]);
  const all = cards.map((client) => ({ client, summary: clientSummary(client.full_name, lessons, rules, ctx.now) }));
  const regulars = (await communityRegulars(ctx, u.id, L)).map((p) => ({ ...p, client_id: cards.find((c) => sameName(c.full_name, p.full_name))?.id ?? null }));
  const is = (st: ClientStatus) => (r: (typeof all)[number]) => r.summary.status === st;
  const owes = (r: (typeof all)[number]) => r.summary.owed > 0;
  const match = (name: string, ...more: (string | null)[]) => !q || [name, ...more].some((v) => (v ?? "").toLowerCase().includes(q));
  const pick = { all: () => true, booked: is("booked"), rebook: is("rebook"), lapsed: is("lapsed"), owes, community: () => false }[tab];
  const order = {
    all: by((r: (typeof all)[number]) => r.client.full_name.toLowerCase()),
    booked: by((r: (typeof all)[number]) => r.summary.next?.starts_at ?? ""),
    rebook: by((r: (typeof all)[number]) => r.summary.days_since ?? 0),
    lapsed: by((r: (typeof all)[number]) => r.summary.days_since ?? 0),
    owes: by((r: (typeof all)[number]) => r.summary.owed, -1),
    community: by((r: (typeof all)[number]) => r.client.full_name),
  }[tab];
  const active = all.filter((r) => r.summary.status === "booked" || (r.summary.days_since ?? Infinity) <= 60);
  return {
    tab,
    q,
    clients: all.filter(pick).filter((r) => match(r.client.full_name, r.client.email, r.client.phone, r.client.level)).sort(order),
    community: tab === "community" ? regulars.filter((p) => match(p.full_name, p.email, p.phone)).sort(by((p) => p.sessions, -1)) : [],
    counts: { all: all.length, booked: all.filter(is("booked")).length, rebook: all.filter(is("rebook")).length, lapsed: all.filter(is("lapsed")).length, owes: all.filter(owes).length, community: regulars.filter((p) => !p.client_id).length },
    totals: {
      active: active.length,
      booked_ahead: all.reduce((n, r) => n + r.summary.upcoming, 0),
      owed: all.reduce((n, r) => n + r.summary.owed, 0),
      // Lessons taught in the last 30 days.
      lessons_30d: lessons.filter((l) => l.ends_at <= ctx.now.toISOString() && l.starts_at >= new Date(ctx.now.getTime() - 30 * 86400000).toISOString()).length,
    },
    today: dateKey(ctx.now),
  };
}

export async function loadCoachClient(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  if (ctx.params.id === "new") {
    // Adding a community player as a client starts from their profile.
    const member = ctx.search.member ? await ctx.store.get("profiles", ctx.search.member) : null;
    return { client: null as Client | null, prefill: { full_name: member?.full_name ?? "", phone: member?.phone ?? "", email: member?.email ?? "" }, summary: null, lessons: [], again: null, member: null, today: dateKey(ctx.now) };
  }
  const client = await ctx.store.get("clients", ctx.params.id);
  if (!client) throw new NotFound();
  if (client.coach_id !== u.id) throw new Forbidden();
  const [lessons, rules, L] = await Promise.all([ctx.store.list("lessons", { eq: { coach_id: u.id } }), ctx.store.list("commission_rules"), profileMap(ctx.store)]);
  const now = ctx.now.toISOString();
  const today = dateKey(ctx.now);
  const summary = clientSummary(client.full_name, lessons, rules, ctx.now);
  const mine = lessons.filter((l) => hasClient(l, client.full_name)).sort(by((l) => l.starts_at, -1));
  // Book again: the latest lesson's day, time, length, place and price, one week on (or next on that weekday).
  const ref = mine[0] ?? null;
  const again = ref
    ? {
        kind: ref.kind,
        date: ref.starts_at > now ? addDays(dateKey(ref.starts_at), 7) : nextSameWeekday(dateKey(ref.starts_at), today),
        time: timeKey(ref.starts_at),
        duration: lessonMinutes(ref),
        price: ref.price_cents == null ? "" : String(ref.price_cents / 100),
        location: ref.location,
      }
    : null;
  const profile = L.profiles.find((p) => sameName(p.full_name, client.full_name) && p.id !== u.id);
  const regular = profile ? (await communityRegulars(ctx, u.id, L)).find((p) => p.id === profile.id) : null;
  return {
    client: client as Client | null,
    prefill: null,
    summary,
    lessons: mine.map((l) => ({ lesson: l, money: lessonMoney(l, rules), done: l.ends_at <= now })),
    again,
    member: profile ? { id: profile.id, phone: profile.phone, email: profile.email, sessions: regular?.sessions ?? 0, last: regular?.last ?? null } : null,
    today,
  };
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
  const today = dateKey(ctx.now);
  const weekEnd = startIso(addDays(today, 7));
  const weekAgo = new Date(ctx.now.getTime() - 7 * 86400000).toISOString();
  const ahead = all.filter((s) => s.status === "published" && s.starts_at > now);
  const [sessions, soon, lastWeek, bookings] = await Promise.all([
    enrich(ctx.store, list, L, null),
    enrich(ctx.store, ahead.filter((s) => s.starts_at < weekEnd), L, null),
    enrich(ctx.store, all.filter((s) => s.status === "published" && s.starts_at <= now && s.starts_at > weekAgo), L, null),
    ahead.length ? ctx.store.list("bookings", { in: { field: "session_id", values: ahead.map((s) => s.id) } }) : Promise.resolve([] as Booking[]),
  ]);
  return {
    tab,
    sessions,
    pulse: weekPulse(soon, today, ctx.now, {
      players: lastWeek.reduce((n, s) => n + s.booked, 0),
      new_bookings: bookings.filter((b) => isActive(b) && b.created_at >= weekAgo).length,
    }),
    counts: {
      upcoming: all.filter((s) => s.status === "published" && s.starts_at > now).length,
      draft: all.filter((s) => s.status === "draft").length,
    },
  };
}

/** The next seven days at a glance, and the sessions that need a decision. */
function weekPulse(soon: SessionView[], today: string, now: Date, recent: { players: number; new_bookings: number }) {
  const sum = (f: (s: SessionView) => number) => soon.reduce((n, s) => n + f(s), 0);
  const in48h = new Date(now.getTime() + 48 * 3600000).toISOString();
  const priced = soon.filter((s) => s.price_cents);
  const attention = soon.flatMap((s) => {
    const why = !s.coach_ids.length
      ? { tone: "amber" as const, text: "No coach assigned" }
      : s.starts_at < in48h && s.booked <= 1 && s.capacity > 1
        ? { tone: "red" as const, text: s.booked ? "Only 1 player so far" : "No players yet" }
        : s.spots_left === 0 && s.waitlist > 0
          ? { tone: "green" as const, text: `Full with ${s.waitlist} waiting. Room for another?` }
          : null;
    return why ? [{ session: s, ...why }] : [];
  });
  return {
    sessions: soon.length,
    booked: sum((s) => s.booked),
    filled: sum((s) => Math.min(s.booked, s.capacity)),
    capacity: sum((s) => s.capacity),
    waitlist: sum((s) => s.waitlist),
    // Per-player price × confirmed players; sessions with no price yet are left out.
    revenue: { booked: priced.reduce((n, s) => n + s.booked * s.price_cents!, 0), full: priced.reduce((n, s) => n + Math.max(s.booked, s.capacity) * s.price_cents!, 0), unpriced: soon.length - priced.length },
    next: soon[0] ?? null,
    last_week: recent.players,
    new_bookings: recent.new_bookings,
    days: Array.from({ length: 7 }, (_, i) => {
      const day = addDays(today, i);
      const list = soon.filter((s) => dateKey(s.starts_at) === day);
      return { day, sessions: list.length, booked: list.reduce((n, s) => n + Math.min(s.booked, s.capacity), 0), capacity: list.reduce((n, s) => n + s.capacity, 0) };
    }),
    attention,
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
  const weekEnd = startIso(addDays(startOfWeek(dateKey(ctx.now)), 7));
  const monthEnd = startIso(addDays(dateKey(ctx.now), 28));
  const clientsSince = startIso(addDays(dateKey(ctx.now), -60));
  const [L, sessions, allLessons, calendars] = await Promise.all([
    profileMap(ctx.store),
    ctx.store.list("sessions", { gte: { field: "starts_at", value: today }, order: { field: "starts_at" } }),
    ctx.store.list("lessons", { gte: { field: "starts_at", value: clientsSince } }),
    ctx.store.list("coach_calendars"),
  ]);
  const lessons = allLessons.filter((l) => l.starts_at >= now);
  const assigned = await enrich(ctx.store, sessions.filter((s) => s.starts_at >= now && isCommunity(s) && s.status === "published"), L, null);
  return {
    coaches: L.profiles
      .filter((p) => isStaff(p) && p.status === "active")
      .sort(by((p) => p.full_name))
      .map((p) => {
        const mine = assigned.filter((s) => s.coach_ids.includes(p.id));
        const month = mine.filter((s) => s.starts_at < monthEnd);
        // Clients: anyone they taught or have booked in the last 60 days, matched by name like the Clients tab.
        const clients = new Set(allLessons.filter((l) => l.coach_id === p.id).flatMap((l) => l.client_names.map((n) => n.trim().toLowerCase())).filter(Boolean));
        return {
          ...person(p),
          email: p.email,
          sessions: mine,
          lessons: lessons.filter((l) => l.coach_id === p.id).length,
          calendar: calendars.find((c) => c.coach_id === p.id) ?? null,
          stats: {
            this_week: mine.filter((s) => s.starts_at < weekEnd).length,
            month: month.length,
            booked: month.reduce((n, s) => n + s.booked, 0),
            capacity: month.reduce((n, s) => n + s.capacity, 0),
            waitlist: month.reduce((n, s) => n + s.waitlist, 0),
            clients: clients.size,
          },
        };
      }),
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
  const [settings, rules] = await Promise.all([getSettings(ctx.store), ctx.store.list("commission_rules", { order: { field: "created_at" } })]);
  return { settings, rules };
}
