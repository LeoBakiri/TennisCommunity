// Read models: one loader per screen. Each returns plain JSON for the UI.
import type { Actor, Booking, Client, CommissionRule, Feedback, Lesson, LessonKind, Profile, Session, SessionType, Skill } from "./types";
import type { Store } from "./store";
import { addDays, dateKey, fmtDateTime, isDateKey, startOfWeek, timeKey, weekDays, zonedToUtc } from "./time";
import { coachesSession, getSettings, holdsSeat, isActive, isAdmin, isStaff } from "./services";
import { by, courtPlan, decideBy, isBalboa, LESSON_META, lessonTitle, needsDecision, placeLabel, SESSION_META, sessionTitle, uid } from "./util";
import { addMoney, buckets, inRange, lessonMoney, lessonPlayers, payday, payWindow, periodLabel, periodRange, PERIODS, playersPerCourt, ruleFor, sessionShare, type Money, type Period } from "./earnings";
import { clientSummary, hasClient, nameKey, nextSameWeekday, sameName, type ClientStatus } from "./clients";
import { goalOf, POINTS, POINTS_PER_LEVEL, progress, streakWeeks, type Played } from "./progress";

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

/** The point in the previous period as far through it as `now` is through this one, so totals compare like with like. */
function sameShareOf(range: { from: string; to: string }, before: { from: string; to: string }, now: Date): string {
  const t = (key: string) => new Date(startIso(key)).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - t(range.from)) / (t(range.to) - t(range.from))));
  return new Date(t(before.from) + elapsed * (t(before.to) - t(before.from))).toISOString();
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

/** The player's community sessions with a seat held: the ones they've played (not marked a no-show) and the ones still to come. */
async function heldSessions(ctx: LoadCtx, userId: string) {
  const now = ctx.now.toISOString();
  const held = (await ctx.store.list("bookings", { eq: { user_id: userId } })).filter(holdsSeat);
  const noShow = new Set(held.filter((b) => b.attended === false).map((b) => b.session_id));
  const sessions = held.length ? (await ctx.store.list("sessions", { in: { field: "id", values: held.map((b) => b.session_id) } })).filter((s) => isCommunity(s) && s.status !== "cancelled") : [];
  return {
    played: sessions.filter((s) => s.starts_at <= now && !noShow.has(s.id)),
    upcoming: sessions.filter((s) => s.starts_at > now && s.status === "published").sort(by((s) => s.starts_at)),
  };
}

/** Feedback is new; until its table reaches the live database, players simply have none. */
const myFeedback = (ctx: LoadCtx, userId: string) => ctx.store.list("feedback", { eq: { user_id: userId } }).catch(() => [] as Feedback[]);

const asPlayed = (s: Session): Played => ({ id: s.id, starts_at: s.starts_at, session_type: s.session_type! });

async function playerProgress(ctx: LoadCtx, u: Profile, played?: Session[], feedback?: Feedback[]) {
  const [sessions, notes] = await Promise.all([played ?? heldSessions(ctx, u.id).then((h) => h.played), feedback ?? myFeedback(ctx, u.id)]);
  return progress({ played: sessions.map(asPlayed), feedback: notes, goal: goalOf(u), now: ctx.now });
}

export async function loadMyGame(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const today = dateKey(ctx.now);
  const month = `${today.slice(0, 7)}-01`;
  const nextMonth = `${addDays(month, 32).slice(0, 7)}-01`;
  // Everything in one round of requests (plus the sessions behind the bookings), so the page opens quickly.
  const [held, feedback, L, board] = await Promise.all([
    heldSessions(ctx, u.id),
    myFeedback(ctx, u.id),
    profileMap(ctx.store),
    ctx.store.leaderboard(startIso(month), startIso(nextMonth)).catch(() => []),
  ]);
  const me = await playerProgress(ctx, u, held.played, feedback);
  const sessionsById = new Map(held.played.map((s) => [s.id, s]));
  const coachFirst = (id: string | null | undefined) => (id && L.profile.get(id)?.full_name.split(" ")[0]) || "Your coach";
  const titleOf = (id: string | null) => {
    const s = id ? sessionsById.get(id) : undefined;
    return s ? sessionTitle(s) : "Coach's note";
  };
  const log = me.log.slice(0, 40).map((e) => ({ ...e, title: titleOf(e.session_id), coach: e.coach_id ? coachFirst(e.coach_id) : null }));

  // Each skill's story: when a coach moved it up, and what they said.
  const history = Object.fromEntries(
    me.skills.map((s) => [
      s.key,
      feedback
        .filter((f) => f.skills.includes(s.key))
        .sort(by((f) => f.created_at, -1))
        .map((f) => ({ at: sessionsById.get(f.session_id)?.starts_at ?? f.created_at, coach: coachFirst(f.coach_id), tip: f.tip })),
    ]),
  ) as Record<Skill, { at: string; coach: string; tip: string }[]>;

  const focusCutoff = new Date(ctx.now.getTime() - 28 * 86400000).toISOString();
  const latestTip = [...feedback].filter((f) => f.tip).sort(by((f) => f.created_at, -1))[0];
  const focus = latestTip && latestTip.created_at >= focusCutoff ? { tip: latestTip.tip, coach: coachFirst(latestTip.coach_id), at: sessionsById.get(latestTip.session_id)?.starts_at ?? latestTip.created_at, skills: latestTip.skills } : null;

  // The next session they're booked on, and what playing it earns.
  const nextSession = held.upcoming[0];
  let next = null;
  if (nextSession) {
    const sameWeek = startOfWeek(dateKey(nextSession.starts_at)) === startOfWeek(today);
    const bookedThisWeek = held.upcoming.filter((s) => startOfWeek(dateKey(s.starts_at)) === startOfWeek(today) && s.starts_at <= nextSession.starts_at).length;
    const goalBonus = sameWeek && me.this_week + bookedThisWeek === me.goal ? POINTS.goal : 0;
    const earns = POINTS[nextSession.session_type!] + goalBonus;
    next = { id: nextSession.id, title: sessionTitle(nextSession), starts_at: nextSession.starts_at, session_type: nextSession.session_type!, earns, goal_bonus: goalBonus > 0, levels_up: me.into_level + earns >= POINTS_PER_LEVEL };
  }

  const ranked = board.map((r, i) => ({ ...r, rank: i + 1, me: r.user_id === u.id }));
  const mine = ranked.find((r) => r.me) ?? null;
  const ahead = mine && mine.rank > 1 ? ranked[mine.rank - 2] : null;
  const days = Math.round((zonedToUtc(nextMonth, "00:00").getTime() - zonedToUtc(today, "00:00").getTime()) / 86400000);
  return {
    first_name: u.full_name.split(" ")[0],
    me,
    log,
    history,
    focus,
    next,
    booked_ahead: held.upcoming.length,
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

export const PLAYER_CALENDAR_FN = "player-calendar";

/** Links to the player's own calendar feed; null in the demo, which has no server. */
export interface CalendarLinks {
  feed: string; // https, for Outlook and anything that asks for a link
  apple: string; // webcal, which Apple Calendar opens as a subscription
  google: string; // Google Calendar's "add by URL" page
  session: (id: string) => string; // one booked session, for "Add to Apple Calendar"
}

export function calendarLinks(functionsUrl: string, token: string): CalendarLinks {
  const feed = `${functionsUrl}/${PLAYER_CALENDAR_FN}?token=${token}`;
  const webcal = feed.replace(/^https?:/, "webcal:");
  return { feed, apple: webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, session: (id) => `${feed}&session=${id}` };
}

/** The player's calendar link, made the first time they open My Sessions. */
async function loadCalendarLinks(ctx: LoadCtx, userId: string): Promise<CalendarLinks | null> {
  const base = ctx.store.functionsUrl;
  if (!base) return null;
  try {
    let row = await ctx.store.get("player_calendars", userId);
    if (!row) {
      const token = uid().replace(/-/g, "");
      // Two tabs can race to make it; whichever lost reads the winner's.
      row = await ctx.store.insert("player_calendars", { id: userId, token, created_at: ctx.now.toISOString() }).catch(() => ctx.store.get("player_calendars", userId));
    }
    return row ? calendarLinks(base, row.token) : null;
  } catch {
    return null; // before the player_calendars migration runs, the table is missing
  }
}

export async function loadMySessions(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const [L, bookings, settings, calendar] = await Promise.all([profileMap(ctx.store), ctx.store.list("bookings", { eq: { user_id: u.id } }), getSettings(ctx.store), loadCalendarLinks(ctx, u.id)]);
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
    calendar,
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
  const today = dateKey(ctx.now);
  const [L, rows, lessons, calendars, soon] = await Promise.all([
    profileMap(ctx.store),
    communityBetween(ctx.store, monday, nextMonday),
    ctx.store.list("lessons", { eq: { coach_id: u.id }, gte: { field: "starts_at", value: startIso(monday) }, lt: { field: "starts_at", value: startIso(nextMonday) } }),
    ctx.store.list("coach_calendars", { eq: { coach_id: u.id } }),
    communityBetween(ctx.store, today, addDays(today, 8)),
  ]);
  const [sessions, twoCourt] = await Promise.all([
    enrich(ctx.store, rows.filter((s) => s.coach_ids.includes(u.id) && s.status !== "draft"), L, null),
    // Whatever week is on screen, the coach hears about two-court sessions in the next week that are still short.
    enrich(ctx.store, soon.filter((s) => s.coach_ids.includes(u.id) && s.status === "published" && s.starts_at > ctx.now.toISOString() && courtPlan(s).courts > 1), L, null),
  ]);
  const items: ScheduleItem[] = [
    ...sessions.map((s) => {
      const meta = SESSION_META[s.session_type!];
      return { id: s.id, title: s.title || meta.label, label: meta.label, color: meta.color, session_type: s.session_type!, starts_at: s.starts_at, ends_at: s.ends_at, href: `/coach/sessions/${s.id}`, detail: `${s.booked}/${s.capacity} booked${s.waitlist ? ` · ${s.waitlist} waiting` : ""}${needsDecision(s) ? ` · needs ${courtPlan(s).minimum} for 2 courts` : ""}`, cancelled: s.status === "cancelled" };
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
    today,
    nowIso: ctx.now.toISOString(),
    items,
    summary: {
      community: sessions.filter((s) => s.status !== "cancelled").length,
      lessons: lessons.length,
      hours: Math.round(active.reduce((n, i) => n + hours(i.starts_at, i.ends_at), 0) * 10) / 10,
    },
    calendar: calendars[0] ?? null,
    live: ctx.store.kind === "supabase",
    signups: await signupsFor(ctx, soon.filter((s) => s.coach_ids.includes(u.id) && s.status === "published" && s.starts_at > now), L),
    to_decide: twoCourt.filter(needsDecision).map((s) => ({ id: s.id, title: sessionTitle(s), session_type: s.session_type!, starts_at: s.starts_at, booked: s.booked, minimum: courtPlan(s).minimum, decide_by: decideBy(s) })),
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

/** The coach's community sessions over the next 8 days with who signed up and who's new in the last day. */
async function signupsFor(ctx: LoadCtx, upcoming: Session[], L: Lookups) {
  const views = await enrich(ctx.store, upcoming, L, null);
  if (!views.length) return { sessions: [], new_today: 0, booked: 0, capacity: 0, waitlist: 0 };
  const bookings = (await ctx.store.list("bookings", { in: { field: "session_id", values: views.map((v) => v.id) } })).filter(isActive);
  const dayAgo = new Date(ctx.now.getTime() - 86400000).toISOString();
  const sessions = views.map((v) => {
    const mine = bookings.filter((b) => b.session_id === v.id).sort(by((b) => b.created_at));
    const players = mine.filter((b) => b.status === "confirmed").map((b) => ({ name: L.profile.get(b.user_id)?.full_name ?? "Player", fresh: b.created_at >= dayAgo }));
    return {
      id: v.id,
      title: sessionTitle(v),
      session_type: v.session_type!,
      starts_at: v.starts_at,
      booked: v.booked,
      capacity: v.capacity,
      waitlist: v.waitlist,
      minimum: courtPlan(v).minimum,
      fresh: mine.filter((b) => b.created_at >= dayAgo).length,
      players,
    };
  });
  return {
    sessions,
    new_today: sessions.reduce((n, s) => n + s.fresh, 0),
    booked: sessions.reduce((n, s) => n + s.booked, 0),
    capacity: sessions.reduce((n, s) => n + s.capacity, 0),
    waitlist: sessions.reduce((n, s) => n + s.waitlist, 0),
  };
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
/** Community sessions that went ahead (or will), with how many players hold a spot. */
async function sessionsWithPlayers(store: Store, fromKey: string, toKey: string, coachId?: string) {
  const rows = (
    await store.list("sessions", {
      ...(coachId ? { contains: { field: "coach_ids", value: coachId } } : {}),
      gte: { field: "starts_at", value: startIso(fromKey) },
      lt: { field: "starts_at", value: startIso(toKey) },
      order: { field: "starts_at" },
    })
  ).filter((s) => isCommunity(s) && s.status === "published");
  const stats = await store.sessionStats(rows.map((s) => s.id));
  return rows.map((s) => ({ ...s, booked: stats[s.id]?.booked ?? 0 }));
}
type PlayedSession = Awaited<ReturnType<typeof sessionsWithPlayers>>[number];

/** Courts a session actually uses: the ones it was planned for, but no more than its players fill. */
const courtsInUse = (s: PlayedSession) => {
  const plan = courtPlan(s);
  return Math.max(1, Math.min(plan.courts, Math.ceil(s.booked / plan.size)));
};

/**
 * A coach's lessons and community sessions as money, the same way for their Earnings page and the admin Coaches page.
 * Work at Balboa is paid through CourtReserve on a payday; anything else the coach marks paid.
 */
function coachMoney(coachId: string, lessons: Lesson[], sessions: PlayedSession[], rules: CommissionRule[], now: string) {
  const lessonRows = lessons
    .filter((l) => l.coach_id === coachId)
    .map((l) => ({
      lesson: l,
      money: lessonMoney(l, rules),
      done: l.ends_at <= now,
      hours: hours(l.starts_at, l.ends_at),
      place: ruleFor(l.location, rules, lessonPlayers(l))?.place ?? null,
      payday: isBalboa(l.location) ? payday(dateKey(l.starts_at)) : null,
    }));
  const sessionRows = sessions
    .filter((s) => s.coach_ids.includes(coachId))
    .map((s) => ({
      session: { id: s.id, session_type: s.session_type, title: s.title, starts_at: s.starts_at, ends_at: s.ends_at, location: s.location, price_cents: s.price_cents, coaches: s.coach_ids.length, players: s.booked, courts: courtsInUse(s) },
      money: sessionShare(s, s.booked, rules, courtsInUse(s)),
      done: s.ends_at <= now,
      hours: hours(s.starts_at, s.ends_at),
      place: ruleFor(s.location, rules, playersPerCourt(s.booked, courtsInUse(s))[0])?.place ?? null,
      payday: isBalboa(s.location) ? payday(dateKey(s.starts_at)) : null,
    }));
  return { lessonRows, sessionRows };
}

type MoneyRow = { money: Money; done: boolean; hours: number; payday: string | null };

/** The next paydays from today, with what's already earned for each and what's still booked. */
function upcomingPaydays(rows: MoneyRow[], today: string, count = 2) {
  const dates = [...new Set(rows.map((r) => r.payday).filter((d): d is string => !!d && d >= today))].sort().slice(0, count);
  return dates.map((date) => {
    const mine = rows.filter((r) => r.payday === date);
    const window = payWindow(date);
    return { date, from: window.from, to: addDays(window.to, -1), earned: addMoney(mine.filter((r) => r.done).map((r) => r.money)).net, booked: addMoney(mine.filter((r) => !r.done).map((r) => r.money)).net, items: mine.length };
  });
}

/** How far back and ahead to load community sessions: the period, the one before it, and the open paydays. */
const sessionSpan = (before: { from: string }, range: { to: string }, today: string) => ({ from: [before.from, addDays(today, -35)].sort()[0], to: [range.to, addDays(today, 50)].sort()[1] });

export async function loadCoachEarnings(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const period: Period = PERIODS.includes(ctx.search.period as Period) ? (ctx.search.period as Period) : "week";
  const today = dateKey(ctx.now);
  const at = isDateKey(ctx.search.at) ? ctx.search.at : today;
  const range = periodRange(period, at);
  const before = periodRange(period, range.prev);
  // A year back covers the previous period and any lesson still waiting to be paid.
  const since = [before.from, addDays(today, -400)].sort()[0];
  const span = sessionSpan(before, range, today);
  const [lessons, rules, sessions] = await Promise.all([
    ctx.store.list("lessons", { eq: { coach_id: u.id }, gte: { field: "starts_at", value: startIso(since) }, order: { field: "starts_at" } }),
    ctx.store.list("commission_rules"),
    sessionsWithPlayers(ctx.store, span.from, span.to, u.id),
  ]);
  const now = ctx.now.toISOString();
  const { lessonRows: rows, sessionRows } = coachMoney(u.id, lessons, sessions, rules, now);
  type R = (typeof rows)[number];
  type S = (typeof sessionRows)[number];
  const within = <T extends { lesson: Lesson } | { session: { starts_at: string } }>(rs: T[], from: string, to: string) => rs.filter((r) => inRange("lesson" in r ? r.lesson.starts_at : r.session.starts_at, from, to));
  const inPeriod = within(rows, range.from, range.to);
  const sessionsIn = within(sessionRows, range.from, range.to);
  const total = (rs: R[], ss: S[] = []) => ({ ...addMoney([...rs, ...ss].map((r) => r.money)), lessons: rs.length, sessions: ss.length, hours: Math.round([...rs, ...ss].reduce((n, r) => n + r.hours, 0) * 10) / 10 });

  const t = total(
    inPeriod.filter((r) => r.done),
    sessionsIn.filter((r) => r.done),
  );
  const scheduled = total(
    inPeriod.filter((r) => !r.done),
    sessionsIn.filter((r) => !r.done),
  );
  // Compare like with like: the same share of the previous period that has passed in this one.
  const prevCut = sameShareOf(range, before, ctx.now);
  const previous = total(
    within(rows, before.from, before.to).filter((r) => r.lesson.ends_at <= prevCut),
    within(sessionRows, before.from, before.to).filter((r) => r.session.ends_at <= prevCut),
  );

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
  const placeOf = (r: { place: string | null }, location: string) => r.place ?? (location || "No location");
  const byPlace = new Map<string, { name: string; net: number; gross: number; commission: number; lessons: number }>();
  for (const r of [...inPeriod.map((r) => ({ name: placeOf(r, r.lesson.location), money: r.money })), ...sessionsIn.map((r) => ({ name: placeOf(r, r.session.location), money: r.money }))]) {
    const e = byPlace.get(r.name) ?? { name: r.name, net: 0, gross: 0, commission: 0, lessons: 0 };
    e.net += r.money.net;
    e.gross += r.money.gross;
    e.commission += r.money.commission;
    e.lessons += 1;
    byPlace.set(r.name, e);
  }

  // Balboa work is paid on a payday, so only lessons elsewhere wait for the coach to mark them paid.
  const owed = rows.filter((r) => r.done && !r.payday && !r.lesson.paid_at && r.money.gross > 0).map((r) => ({ lesson: r.lesson, money: r.money }));
  const view = (r: R) => ({ lesson: r.lesson, money: r.money, done: r.done, place: r.place, payday: r.payday });
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
      const rs = [...within(rows, b.from, b.to), ...within(sessionRows, b.from, b.to)];
      return { key: b.key, label: b.label, earned: addMoney(rs.filter((r) => r.done).map((r) => r.money)).net, scheduled: addMoney(rs.filter((r) => !r.done).map((r) => r.money)).net, current: today >= b.from && today < b.to };
    }),
    byKind: [
      ...(["private", "semi_private"] as const).map((k) => ({ kind: k as LessonKind | "community", ...total(inPeriod.filter((r) => r.lesson.kind === k)) })),
      { kind: "community" as const, ...total([], sessionsIn) },
    ],
    byPlace: [...byPlace.values()].sort(by((p) => p.net, -1)).map((p) => ({ ...p, commissioned: rules.some((x) => x.place === p.name) })),
    clients: sumBy(inPeriod, (r) => (r.lesson.client_names.length ? r.lesson.client_names : ["Unnamed"])).slice(0, 6),
    lessons: inPeriod.map(view).sort(by((r) => r.lesson.starts_at, -1)),
    sessions: sessionsIn.sort(by((r) => r.session.starts_at, -1)),
    owed: { total: owed.reduce((n, r) => n + r.money.gross, 0), lessons: owed },
    paydays: upcomingPaydays([...rows, ...sessionRows], today),
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
      : needsDecision(s) && s.starts_at < in48h
        ? { tone: "red" as const, text: `${s.booked} of ${courtPlan(s).minimum} for two courts. Decide by ${fmtDateTime(decideBy(s))}` }
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
  const period: Period = PERIODS.includes(ctx.search.period as Period) ? (ctx.search.period as Period) : "month";
  const today = dateKey(ctx.now);
  const at = isDateKey(ctx.search.at) ? ctx.search.at : today;
  const range = periodRange(period, at);
  const before = periodRange(period, range.prev);
  const now = ctx.now.toISOString();
  // A year back covers the previous period and any lesson still waiting to be paid, like the coach Earnings page.
  const since = [before.from, addDays(today, -400)].sort()[0];
  const span = sessionSpan(before, range, today);
  const clientsSince = startIso(addDays(today, -60));
  const [L, allLessons, rules, calendars, sessions, upcoming] = await Promise.all([
    profileMap(ctx.store),
    ctx.store.list("lessons", { gte: { field: "starts_at", value: startIso(since) } }),
    ctx.store.list("commission_rules"),
    ctx.store.list("coach_calendars"),
    sessionsWithPlayers(ctx.store, span.from, span.to),
    ctx.store.list("sessions", { gte: { field: "starts_at", value: now }, order: { field: "starts_at" } }),
  ]);
  const prevCut = sameShareOf(range, before, ctx.now);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const startOf = (r: { lesson: Lesson } | { session: { starts_at: string } }) => ("lesson" in r ? r.lesson.starts_at : r.session.starts_at);
  const endOf = (r: { lesson: Lesson } | { session: { ends_at: string } }) => ("lesson" in r ? r.lesson.ends_at : r.session.ends_at);

  const coaches = L.profiles
    .filter((p) => isStaff(p) && p.status === "active")
    .sort(by((p) => p.full_name))
    .map((p) => {
      const { lessonRows, sessionRows } = coachMoney(p.id, allLessons, sessions, rules, now);
      const all = [...lessonRows, ...sessionRows];
      const inP = all.filter((r) => inRange(startOf(r), range.from, range.to));
      const done = inP.filter((r) => r.done);
      const money = addMoney(done.map((r) => r.money));
      const workHours = round1(done.reduce((n, r) => n + r.hours, 0));
      const lessonsDone = lessonRows.filter((r) => r.done && inRange(r.lesson.starts_at, range.from, range.to));
      const sessionsIn = sessionRows.filter((r) => inRange(r.session.starts_at, range.from, range.to));
      const sessionsDone = sessionsIn.filter((r) => r.done);
      const ahead = inP.filter((r) => !r.done);
      // Balboa is paid on paydays, so "unpaid" is only lessons elsewhere not marked paid.
      const owed = lessonRows.filter((r) => r.done && !r.payday && !r.lesson.paid_at && r.money.gross > 0);
      // Clients: anyone they taught or have booked in the last 60 days, matched by name like the Clients tab. Only the count leaves here.
      const clients = new Set(allLessons.filter((l) => l.coach_id === p.id && l.starts_at >= clientsSince).flatMap((l) => l.client_names.map((n) => n.trim().toLowerCase())).filter(Boolean));
      return {
        ...person(p),
        email: p.email,
        calendar: calendars.find((c) => c.coach_id === p.id) ?? null,
        earned: { ...money, hours: workHours, per_hour: workHours ? Math.round(money.net / workHours / 100) * 100 : 0 },
        lessons: { count: lessonsDone.length, hours: round1(lessonsDone.reduce((n, r) => n + r.hours, 0)), ...addMoney(lessonsDone.map((r) => r.money)) },
        community: {
          count: sessionsDone.length,
          hours: round1(sessionsDone.reduce((n, r) => n + r.hours, 0)),
          players: sessionsDone.reduce((n, r) => n + r.session.players, 0),
          ahead: sessionsIn.length - sessionsDone.length,
          ...addMoney(sessionsDone.map((r) => r.money)),
        },
        booked: { net: addMoney(ahead.map((r) => r.money)).net, count: ahead.length },
        previous: addMoney(all.filter((r) => inRange(startOf(r), before.from, before.to) && endOf(r) <= prevCut).map((r) => r.money)).net,
        unpriced: inP.filter((r) => !r.money.priced).length,
        owed: { total: owed.reduce((n, r) => n + r.money.gross, 0), lessons: owed.length },
        payday: upcomingPaydays(all, today, 1)[0] ?? null,
        chart: buckets(period, at).map((b) => {
          const rs = inP.filter((r) => inRange(startOf(r), b.from, b.to));
          return { key: b.key, label: b.label, earned: addMoney(rs.filter((r) => r.done).map((r) => r.money)).net, booked: addMoney(rs.filter((r) => !r.done).map((r) => r.money)).net, current: today >= b.from && today < b.to };
        }),
        clients: clients.size,
      };
    });
  const sum = (f: (c: (typeof coaches)[number]) => number) => coaches.reduce((n, c) => n + f(c), 0);
  const nextPay = coaches.map((c) => c.payday?.date).filter((d): d is string => !!d).sort()[0] ?? null;
  return {
    period,
    at,
    label: periodLabel(period, at),
    current: inRange(now, range.from, range.to),
    prev: range.prev,
    next: range.next,
    coaches,
    totals: {
      net: sum((c) => c.earned.net),
      gross: sum((c) => c.earned.gross),
      commission: sum((c) => c.earned.commission),
      lessons: sum((c) => c.lessons.count),
      sessions: sum((c) => c.community.count),
      hours: round1(sum((c) => c.earned.hours)),
      booked: sum((c) => c.booked.net),
      previous: sum((c) => c.previous),
      owed: sum((c) => c.owed.total),
      owed_lessons: sum((c) => c.owed.lessons),
    },
    payday: nextPay ? { date: nextPay, ...payWindowDays(nextPay), earned: sum((c) => (c.payday?.date === nextPay ? c.payday.earned : 0)), booked: sum((c) => (c.payday?.date === nextPay ? c.payday.booked : 0)) } : null,
    has_rules: rules.some((r) => r.percent > 0 || r.per_hour_cents > 0 || r.per_lesson_cents > 0),
    unassigned: upcoming.filter((s) => isCommunity(s) && s.status === "published" && !s.coach_ids.length),
  };
}

const payWindowDays = (date: string) => {
  const w = payWindow(date);
  return { from: w.from, to: addDays(w.to, -1) };
};

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
    // A player who cancelled and booked again has two rows; the live one is what counts.
    const booking = bookings.find((b) => b.session_id === session.id && isActive(b)) ?? bookings.find((b) => b.session_id === session.id);
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
