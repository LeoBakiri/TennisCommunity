// Read models: one loader per screen. Each returns plain JSON for the UI.
import type { Actor, Booking, CoachNote, Message, Profile, Program, Session, Settings } from "./types";
import type { Store } from "./store";
import { addDays, dateKey, isDateKey, startOfWeek, weekDays, zonedToUtc } from "./time";
import { coachesSession, getSettings, holdsSeat, isActive, isAdmin, isStaff, seatsUsed } from "./services";
import { by } from "./util";

export class NotFound extends Error {}
export class Forbidden extends Error {}

export interface LoadCtx {
  store: Store;
  actor: Actor;
  params: Record<string, string>;
  search: Record<string, string>;
  now: Date;
}

export type Person = Pick<Profile, "id" | "full_name" | "role" | "skill_level" | "ntrp" | "bio">;
export type ProgramLite = Pick<Program, "id" | "slug" | "name" | "kind" | "color" | "requires_approval" | "allow_requests" | "duration_min" | "summary">;

export interface SessionView extends Session {
  program: ProgramLite;
  coaches: Person[];
  booked: number;
  spots_left: number;
  waitlist: number;
  pending: number;
  my_booking: Pick<Booking, "id" | "status" | "waitlist_position" | "seats"> | null;
}

const person = (p: Profile): Person => ({ id: p.id, full_name: p.full_name, role: p.role, skill_level: p.skill_level, ntrp: p.ntrp, bio: p.bio });
const programLite = (p: Program): ProgramLite => ({
  id: p.id, slug: p.slug, name: p.name, kind: p.kind, color: p.color, requires_approval: p.requires_approval,
  allow_requests: p.allow_requests, duration_min: p.duration_min, summary: p.summary,
});
const UNKNOWN_PROGRAM: ProgramLite = { id: "", slug: "", name: "Session", kind: "group", color: "#1F3A2E", requires_approval: false, allow_requests: false, duration_min: 60, summary: "" };

async function lookups(store: Store) {
  const [programs, profiles] = await Promise.all([store.list("programs"), store.list("profiles")]);
  return {
    programs,
    profiles,
    program: new Map(programs.map((p) => [p.id, p])),
    profile: new Map(profiles.map((p) => [p.id, p])),
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

async function enrich(store: Store, sessions: Session[], L: Lookups, userId?: string | null): Promise<SessionView[]> {
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const [stats, mineAll] = await Promise.all([
    store.sessionStats(ids),
    userId ? store.list("bookings", { eq: { user_id: userId }, in: { field: "session_id", values: ids } }) : Promise.resolve([] as Booking[]),
  ]);
  return sessions.map((s) => {
    const st = stats[s.id] ?? { booked: 0, waitlist: 0, pending: 0 };
    const used = st.booked;
    const mine = mineAll.find((b) => b.session_id === s.id && isActive(b));
    const prog = L.program.get(s.program_id);
    return {
      ...s,
      program: prog ? programLite(prog) : UNKNOWN_PROGRAM,
      coaches: s.coach_ids.map((id) => L.profile.get(id)).filter(Boolean).map((p) => person(p!)),
      booked: used,
      spots_left: Math.max(0, s.capacity - used),
      waitlist: st.waitlist,
      pending: st.pending,
      my_booking: mine ? { id: mine.id, status: mine.status, waitlist_position: mine.waitlist_position, seats: mine.seats } : null,
    };
  });
}

function weekParam(ctx: LoadCtx) {
  const w = ctx.search.week;
  return startOfWeek(isDateKey(w) ? w : dateKey(ctx.now));
}
const startIso = (key: string) => zonedToUtc(key, "00:00").toISOString();

async function sessionsBetween(store: Store, fromKey: string, toKey: string) {
  return store.list("sessions", {
    gte: { field: "starts_at", value: startIso(fromKey) },
    lt: { field: "starts_at", value: startIso(toKey) },
    order: { field: "starts_at" },
  });
}

const visibleToPublic = (s: Session) => s.status === "published" && s.visibility === "public";

// ───────────────────────── public ─────────────────────────

export async function loadHome(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const today = dateKey(ctx.now);
  const sessions = (await sessionsBetween(ctx.store, today, addDays(today, 15)))
    .filter(visibleToPublic)
    .filter((s) => new Date(s.starts_at) > ctx.now)
    .slice(0, 6);
  const coaches = L.profiles.filter((p) => isStaff(p) && p.status === "active").map(person);
  return {
    programs: L.programs.filter((p) => p.active).sort(by((p) => p.sort_order)),
    upcoming: await enrich(ctx.store, sessions, L, ctx.actor.user?.id),
    coaches,
  };
}

export async function loadPrograms(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const today = dateKey(ctx.now);
  const upcoming = (await sessionsBetween(ctx.store, today, addDays(today, 29))).filter(visibleToPublic);
  return {
    programs: L.programs
      .filter((p) => p.active)
      .sort(by((p) => p.sort_order))
      .map((p) => ({ ...p, upcoming: upcoming.filter((s) => s.program_id === p.id && new Date(s.starts_at) > ctx.now).length })),
  };
}

export async function loadProgram(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const program = L.programs.find((p) => p.slug === ctx.params.slug && p.active);
  if (!program) throw new NotFound();
  const today = dateKey(ctx.now);
  const sessions = (await sessionsBetween(ctx.store, today, addDays(today, 29)))
    .filter((s) => visibleToPublic(s) && s.program_id === program.id && new Date(s.starts_at) > ctx.now);
  return { program, sessions: await enrich(ctx.store, sessions, L, ctx.actor.user?.id) };
}

export async function loadSchedule(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const monday = weekParam(ctx);
  const filter = ctx.search.program ?? "";
  const sessions = (await sessionsBetween(ctx.store, monday, addDays(monday, 7))).filter(
    (s) => visibleToPublic(s) && (!filter || L.program.get(s.program_id)?.slug === filter),
  );
  const settings = await getSettings(ctx.store);
  return {
    monday,
    days: weekDays(monday),
    today: dateKey(ctx.now),
    horizon: addDays(dateKey(ctx.now), settings.booking_horizon_days),
    filter,
    programs: L.programs.filter((p) => p.active).sort(by((p) => p.sort_order)).map(programLite),
    sessions: await enrich(ctx.store, sessions, L, ctx.actor.user?.id),
    nowIso: ctx.now.toISOString(),
  };
}

export async function loadSessionDetail(ctx: LoadCtx) {
  const s = await ctx.store.get("sessions", ctx.params.id);
  if (!s || s.status === "draft") throw new NotFound();
  const u = ctx.actor.user;
  const L = await lookups(ctx.store);
  const [view] = await enrich(ctx.store, [s], L, u?.id);
  if (s.visibility === "private" && !view.my_booking && !isStaff(u)) throw new NotFound();
  const program = L.program.get(s.program_id) ?? null;
  const settings = await getSettings(ctx.store);
  const mineAll = u ? (await ctx.store.list("bookings", { eq: { session_id: s.id, user_id: u.id } })).sort(by((b) => b.created_at, -1))[0] ?? null : null;
  return {
    session: view,
    program,
    myBooking: mineAll,
    hoursUntil: (new Date(s.starts_at).getTime() - ctx.now.getTime()) / 3600000,
    policy: { window: settings.cancellation_window_hours, text: settings.cancellation_policy, payLater: settings.allow_pay_later },
  };
}

export async function loadOnboarding(ctx: LoadCtx) {
  const a = ctx.actor;
  const id = a.identifier ?? "";
  return {
    profile: a.user,
    prefill: { email: id.includes("@") ? id : a.user?.email ?? "", phone: id.startsWith("+") ? id : a.user?.phone ?? "" },
  };
}

// ───────────────────────── member ─────────────────────────

async function myBookingsWithSessions(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const L = await lookups(ctx.store);
  const bookings = await ctx.store.list("bookings", { eq: { user_id: u.id } });
  const sessions = await ctx.store.list("sessions", { in: { field: "id", values: bookings.map((b) => b.session_id) } });
  const views = await enrich(ctx.store, sessions, L, u.id);
  const sv = new Map(views.map((s) => [s.id, s]));
  const rows = bookings
    .map((b) => ({ booking: b, session: sv.get(b.session_id)! }))
    .filter((r) => r.session);
  return { u, L, rows };
}

export type BookingRow = { booking: Booking; session: SessionView };

export async function loadMemberDashboard(ctx: LoadCtx) {
  const { u, L, rows } = await myBookingsWithSessions(ctx);
  const now = ctx.now.toISOString();
  const upcoming = rows.filter((r) => r.session.starts_at > now && isActive(r.booking) && r.session.status !== "cancelled").sort(by((r) => r.session.starts_at));
  const today = dateKey(ctx.now);
  const open = (await sessionsBetween(ctx.store, today, addDays(today, 14)))
    .filter((s) => visibleToPublic(s) && s.starts_at > now && !rows.some((r) => r.session.id === s.id && isActive(r.booking)));
  const openViews = (await enrich(ctx.store, open, L, u.id)).filter((s) => s.spots_left > 0 && s.program.kind !== "private").slice(0, 3);
  const announcements = (await ctx.store.list("announcements")).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1)).slice(0, 3);
  const notes = (await ctx.store.list("coach_notes", { eq: { player_id: u.id, visibility: "shared" } })).sort(by((n) => n.created_at, -1)).slice(0, 3);
  const unread = (await ctx.store.list("messages", { eq: { member_id: u.id, read_by_member: false } })).length;
  const requests = (await ctx.store.list("lesson_requests", { eq: { user_id: u.id, status: "pending" } })).length;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const attended = rows.filter((r) => r.booking.attended && r.session.starts_at >= startIso(yearStart)).length;
  return {
    next: upcoming.find((r) => r.booking.status !== "waitlisted") ?? null,
    upcoming: upcoming.slice(0, 6),
    openSessions: openViews,
    announcements: announcements.map((a) => ({ ...a, author: L.profile.get(a.author_id)?.full_name ?? "" })),
    notes: notes.map((n) => ({ ...n, author: L.profile.get(n.author_id)?.full_name ?? "Coach" })),
    unread,
    pendingRequests: requests,
    attended,
  };
}

export async function loadMemberBook(ctx: LoadCtx) {
  return loadSchedule(ctx);
}

export async function loadRequestForm(ctx: LoadCtx) {
  const programs = (await ctx.store.list("programs")).filter((p) => p.active && p.allow_requests).sort(by((p) => p.sort_order));
  return { programs, selected: ctx.search.program ?? programs[0]?.id ?? "", today: dateKey(ctx.now) };
}

export async function loadMemberBookings(ctx: LoadCtx) {
  const { u, L, rows } = await myBookingsWithSessions(ctx);
  const now = ctx.now.toISOString();
  const tab = ["upcoming", "past", "requests", "cancelled"].includes(ctx.search.tab) ? ctx.search.tab : "upcoming";
  const requests = (await ctx.store.list("lesson_requests", { eq: { user_id: u.id } })).sort(by((r) => r.created_at, -1));
  const settings = await getSettings(ctx.store);
  return {
    tab,
    upcoming: rows.filter((r) => r.session.starts_at > now && isActive(r.booking)).sort(by((r) => r.session.starts_at)),
    past: rows.filter((r) => r.session.starts_at <= now && holdsSeat(r.booking)).sort(by((r) => r.session.starts_at, -1)),
    cancelled: rows.filter((r) => r.booking.status === "cancelled" || r.booking.status === "declined").sort(by((r) => r.booking.updated_at, -1)),
    requests: requests.map((r) => ({ ...r, program: L.program.get(r.program_id)?.name ?? "Lesson" })),
    window: settings.cancellation_window_hours,
    nowIso: now,
  };
}

async function thread(ctx: LoadCtx, memberId: string, as: "member" | "staff") {
  const L = await lookups(ctx.store);
  const msgs = (await ctx.store.list("messages", { eq: { member_id: memberId } })).sort(by((m) => m.created_at));
  for (const m of msgs) {
    if (as === "member" && !m.read_by_member) await ctx.store.update("messages", m.id, { read_by_member: true });
    if (as === "staff" && !m.read_by_staff) await ctx.store.update("messages", m.id, { read_by_staff: true });
  }
  return msgs.map((m) => ({ ...m, sender: L.profile.get(m.sender_id)?.full_name ?? "Unknown", from_staff: m.sender_id !== memberId }));
}
export type ThreadMessage = Message & { sender: string; from_staff: boolean };

export async function loadMemberMessages(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const L = await lookups(ctx.store);
  return { messages: await thread(ctx, u.id, "member"), coaches: L.profiles.filter((p) => isStaff(p)).map(person) };
}

export async function loadMemberProfile(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const L = await lookups(ctx.store);
  const notes = (await ctx.store.list("coach_notes", { eq: { player_id: u.id, visibility: "shared" } })).sort(by((n) => n.created_at, -1));
  return { profile: u, notes: notes.map((n) => ({ ...n, author: L.profile.get(n.author_id)?.full_name ?? "Coach" })) };
}

// ───────────────────────── coach ─────────────────────────

function coachScope(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const all = isAdmin(u) && ctx.search.all === "1";
  return { u, all, mine: (s: Session) => all || s.coach_ids.includes(u.id) };
}

export async function loadCoachToday(ctx: LoadCtx) {
  const { u, mine } = coachScope(ctx);
  const L = await lookups(ctx.store);
  const today = dateKey(ctx.now);
  const week = (await sessionsBetween(ctx.store, today, addDays(today, 7))).filter((s) => mine(s) && s.status !== "cancelled" && s.status !== "draft");
  const views = await enrich(ctx.store, week, L, null);
  const todays = views.filter((s) => dateKey(s.starts_at) === today);
  const bookings = await ctx.store.list("bookings", { in: { field: "session_id", values: todays.map((s) => s.id) } });
  const rosters: Record<string, { name: string; status: string; attended: boolean | null }[]> = {};
  for (const s of todays) {
    rosters[s.id] = bookings
      .filter((b) => b.session_id === s.id && holdsSeat(b))
      .map((b) => ({ name: L.profile.get(b.user_id)?.full_name ?? "Player", status: b.status, attended: b.attended }));
  }
  const unread = (await ctx.store.list("messages", { eq: { read_by_staff: false } })).length;
  const past = (await sessionsBetween(ctx.store, addDays(today, -14), today)).filter((s) => mine(s) && s.status === "published");
  const pastBookings = await ctx.store.list("bookings", { in: { field: "session_id", values: past.map((s) => s.id) } });
  const needsAttendance = past.filter((s) => pastBookings.some((b) => b.session_id === s.id && b.status === "confirmed" && b.attended === null));
  return {
    coach: person(u),
    today: todays,
    rosters,
    week: views,
    stats: {
      sessions: views.length,
      players: views.reduce((n, s) => n + s.booked, 0),
      hours: Math.round(views.reduce((n, s) => n + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000, 0) * 10) / 10,
      fill: views.length ? Math.round((views.reduce((n, s) => n + s.booked, 0) / Math.max(1, views.reduce((n, s) => n + s.capacity, 0))) * 100) : 0,
    },
    unread,
    needsAttendance: (await enrich(ctx.store, needsAttendance, L, null)).slice(-5).reverse(),
    nowIso: ctx.now.toISOString(),
  };
}

export async function loadCoachCalendar(ctx: LoadCtx) {
  const { mine, all } = coachScope(ctx);
  const L = await lookups(ctx.store);
  const monday = weekParam(ctx);
  const sessions = (await sessionsBetween(ctx.store, monday, addDays(monday, 7))).filter((s) => mine(s) && s.status !== "draft");
  return { monday, days: weekDays(monday), today: dateKey(ctx.now), all, sessions: await enrich(ctx.store, sessions, L, null) };
}

export async function loadCoachSession(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const s = await ctx.store.get("sessions", ctx.params.id);
  if (!s) throw new NotFound();
  if (!coachesSession(u, s)) throw new Forbidden();
  const L = await lookups(ctx.store);
  const [view] = await enrich(ctx.store, [s], L, null);
  const bookings = await ctx.store.list("bookings", { eq: { session_id: s.id } });
  const notes = await ctx.store.list("coach_notes", { in: { field: "player_id", values: bookings.map((b) => b.user_id) } });
  const roster = bookings
    .filter((b) => b.status !== "cancelled" && b.status !== "declined")
    .sort((a, b) => (a.status === "waitlisted" ? 1 : 0) - (b.status === "waitlisted" ? 1 : 0) || (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0) || (a.created_at < b.created_at ? -1 : 1))
    .map((b) => {
      const p = L.profile.get(b.user_id);
      return {
        booking: b,
        player: p
          ? { id: p.id, full_name: p.full_name, email: p.email, phone: p.phone, ntrp: p.ntrp, skill_level: p.skill_level, emergency_contact: p.emergency_contact, goals: p.goals }
          : null,
        notes: notes.filter((n) => n.player_id === b.user_id).length,
      };
    });
  const sessionNotes = notes.filter((n) => n.session_id === s.id).map((n) => ({ ...n, author: L.profile.get(n.author_id)?.full_name ?? "" }));
  return { session: view, roster, sessionNotes, isPast: new Date(s.starts_at) <= ctx.now, isAdmin: isAdmin(u) };
}

async function coachedPlayerIds(ctx: LoadCtx, coachId: string, everyone: boolean) {
  const sessions = everyone ? await ctx.store.list("sessions") : await ctx.store.list("sessions", { contains: { field: "coach_ids", value: coachId } });
  const bookings = await ctx.store.list("bookings", { in: { field: "session_id", values: sessions.map((s) => s.id) } });
  const smap = new Map(sessions.map((s) => [s.id, s]));
  const stats = new Map<string, { count: number; last: string | null; next: string | null }>();
  const now = ctx.now.toISOString();
  for (const b of bookings) {
    if (!holdsSeat(b)) continue;
    const s = smap.get(b.session_id)!;
    const st = stats.get(b.user_id) ?? { count: 0, last: null, next: null };
    if (s.starts_at <= now) {
      st.count++;
      if (!st.last || s.starts_at > st.last) st.last = s.starts_at;
    } else if (!st.next || s.starts_at < st.next) st.next = s.starts_at;
    stats.set(b.user_id, st);
  }
  return stats;
}

export async function loadCoachPlayers(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const L = await lookups(ctx.store);
  const everyone = isAdmin(u);
  const stats = await coachedPlayerIds(ctx, u.id, everyone);
  const q = (ctx.search.q ?? "").toLowerCase();
  const players = L.profiles
    .filter((p) => p.role === "member" && (everyone || stats.has(p.id)))
    .filter((p) => !q || p.full_name.toLowerCase().includes(q) || (p.email ?? "").includes(q))
    .map((p) => ({ ...person(p), tags: p.tags, stats: stats.get(p.id) ?? { count: 0, last: null, next: null } }))
    .sort(by((p) => p.full_name));
  return { players, q, everyone };
}

export async function loadCoachPlayer(ctx: LoadCtx) {
  const u = ctx.actor.user!;
  const p = await ctx.store.get("profiles", ctx.params.id);
  if (!p) throw new NotFound();
  const everyone = isAdmin(u);
  const stats = await coachedPlayerIds(ctx, u.id, everyone);
  if (!everyone && !stats.has(p.id)) throw new Forbidden();
  const L = await lookups(ctx.store);
  const notes: (CoachNote & { author: string })[] = (await ctx.store.list("coach_notes", { eq: { player_id: p.id } }))
    .sort(by((n) => n.created_at, -1))
    .map((n) => ({ ...n, author: L.profile.get(n.author_id)?.full_name ?? "" }));
  const bookings = await ctx.store.list("bookings", { eq: { user_id: p.id } });
  const sessions = (await ctx.store.list("sessions", { in: { field: "id", values: bookings.map((b) => b.session_id) } })).filter(
    (s) => everyone || s.coach_ids.includes(u.id),
  );
  const views = await enrich(ctx.store, sessions, L, p.id);
  const history = views
    .map((s) => ({ session: s, booking: bookings.find((b) => b.session_id === s.id)! }))
    .filter((r) => r.booking && r.booking.status !== "declined")
    .sort(by((r) => r.session.starts_at, -1));
  return {
    player: { ...p, email: p.email, phone: p.phone },
    notes,
    history,
    stats: stats.get(p.id) ?? { count: 0, last: null, next: null },
    me: u.id,
    isAdmin: everyone,
  };
}

export async function loadStaffInbox(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const msgs = await ctx.store.list("messages");
  const byMember = new Map<string, Message[]>();
  for (const m of msgs) (byMember.get(m.member_id) ?? byMember.set(m.member_id, []).get(m.member_id)!).push(m);
  const threads = [...byMember.entries()]
    .map(([mid, ms]) => {
      const last = ms.sort(by((m) => m.created_at)).at(-1)!;
      return { member: L.profile.get(mid) ? person(L.profile.get(mid)!) : null, member_id: mid, last, unread: ms.filter((m) => !m.read_by_staff).length };
    })
    .sort(by((t) => t.last.created_at, -1));
  const selected = ctx.search.m ?? threads[0]?.member_id ?? "";
  const members = L.profiles.filter((p) => p.role === "member").map(person).sort(by((p) => p.full_name));
  return {
    threads,
    selected,
    selectedMember: selected ? (L.profile.get(selected) ? person(L.profile.get(selected)!) : null) : null,
    messages: selected ? await thread(ctx, selected, "staff") : [],
    members,
  };
}

// ───────────────────────── admin ─────────────────────────

export async function loadAdminOverview(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const today = dateKey(ctx.now);
  const monday = startOfWeek(today);
  const week = (await sessionsBetween(ctx.store, monday, addDays(monday, 7))).filter((s) => s.status === "published");
  const weekViews = await enrich(ctx.store, week, L, null);
  const todayViews = weekViews.filter((s) => dateKey(s.starts_at) === today);
  const allBookings = await ctx.store.list("bookings");
  const monthStart = startIso(`${today.slice(0, 7)}-01`);
  const allSessions = await ctx.store.list("sessions");
  const sessionStart = new Map(allSessions.map((s) => [s.id, s.starts_at]));
  const nowIso = ctx.now.toISOString();
  const pastConfirmed = allBookings.filter((b) => b.status === "confirmed" && (sessionStart.get(b.session_id) ?? "") < nowIso && (sessionStart.get(b.session_id) ?? "") >= addDaysIso(ctx.now, -30));
  const marked = pastConfirmed.filter((b) => b.attended !== null);
  const activePlayers = new Set(allBookings.filter((b) => holdsSeat(b) && (sessionStart.get(b.session_id) ?? "") >= monthStart).map((b) => b.user_id)).size;
  const requests = await ctx.store.list("lesson_requests", { eq: { status: "pending" } });
  const pendingBookings = allBookings.filter((b) => b.status === "pending");
  const recent = allBookings.sort(by((b) => b.created_at, -1)).slice(0, 8);
  const sessionsById = new Map((await ctx.store.list("sessions", { in: { field: "id", values: recent.map((b) => b.session_id) } })).map((s) => [s.id, s]));
  const newMembers = L.profiles.filter((p) => p.role === "member" && p.created_at >= addDaysIso(ctx.now, -30)).length;
  const cap = weekViews.reduce((n, s) => n + s.capacity, 0);
  const booked = weekViews.reduce((n, s) => n + s.booked, 0);
  // booked seats by week: four weeks back, this week and next week
  const trend = Array.from({ length: 6 }, (_, i) => {
    const wk = addDays(monday, -7 * (4 - i));
    const a = startIso(wk), b = startIso(addDays(wk, 7));
    return { week: wk, seats: allBookings.filter((x) => holdsSeat(x) && (sessionStart.get(x.session_id) ?? "") >= a && (sessionStart.get(x.session_id) ?? "") < b).reduce((n, x) => n + (x.seats || 1), 0) };
  });
  return {
    kpis: {
      weekSessions: weekViews.length,
      fill: cap ? Math.round((booked / cap) * 100) : 0,
      booked,
      attendance: marked.length ? Math.round((marked.filter((b) => b.attended).length / marked.length) * 100) : null,
      activePlayers,
      members: L.profiles.filter((p) => p.role === "member" && p.status === "active").length,
      newMembers,
      waitlisted: allBookings.filter((b) => b.status === "waitlisted").length,
    },
    today: todayViews,
    requests: requests.length,
    pendingBookings: pendingBookings.length,
    unread: (await ctx.store.list("messages", { eq: { read_by_staff: false } })).length,
    recent: recent.map((b) => {
      const s = sessionsById.get(b.session_id);
      return {
        id: b.id,
        status: b.status,
        created_at: b.created_at,
        player: L.profile.get(b.user_id)?.full_name ?? "Player",
        session: s ? s.title || L.program.get(s.program_id)?.name || "Session" : "Session",
        session_id: b.session_id,
        starts_at: s?.starts_at ?? "",
      };
    }),
    trend,
    drafts: (await ctx.store.list("sessions", { eq: { status: "draft" } })).length,
  };
}

const addDaysIso = (d: Date, n: number) => new Date(d.getTime() + n * 86400000).toISOString();

export async function loadAdminCalendar(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const monday = weekParam(ctx);
  const coach = ctx.search.coach ?? "";
  const sessions = (await sessionsBetween(ctx.store, monday, addDays(monday, 7))).filter((s) => !coach || s.coach_ids.includes(coach));
  return {
    monday,
    days: weekDays(monday),
    today: dateKey(ctx.now),
    coach,
    coaches: L.profiles.filter(isStaff).map(person),
    sessions: await enrich(ctx.store, sessions, L, null),
    programs: L.programs.map(programLite),
  };
}

export async function loadAdminSessions(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const tab = ["upcoming", "past", "draft", "cancelled"].includes(ctx.search.tab) ? ctx.search.tab : "upcoming";
  const now = ctx.now.toISOString();
  const all = await ctx.store.list("sessions", { order: { field: "starts_at" } });
  const program = ctx.search.program ?? "";
  const filtered = all
    .filter((s) => !program || s.program_id === program)
    .filter((s) =>
      tab === "draft" ? s.status === "draft" : tab === "cancelled" ? s.status === "cancelled" : tab === "past" ? s.status === "published" && s.starts_at <= now : s.status === "published" && s.starts_at > now,
    );
  const list = tab === "past" ? filtered.reverse().slice(0, 60) : filtered.slice(0, 80);
  return {
    tab,
    program,
    programs: L.programs.map(programLite),
    sessions: await enrich(ctx.store, list, L, null),
    counts: {
      upcoming: all.filter((s) => s.status === "published" && s.starts_at > now).length,
      draft: all.filter((s) => s.status === "draft").length,
    },
  };
}

export async function loadSessionEditor(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const settings = await getSettings(ctx.store);
  const coaches = L.profiles.filter(isStaff).map(person);
  const programs = L.programs.sort(by((p) => p.sort_order));
  const members = L.profiles.filter((p) => p.status === "active").map(person).sort(by((p) => p.full_name));
  if (ctx.params.id === "new" || !ctx.params.id) {
    const prog = programs.find((p) => p.id === ctx.search.program) ?? programs.find((p) => p.active) ?? programs[0];
    return {
      mode: "new" as const,
      session: null,
      roster: [],
      programs,
      coaches,
      members,
      settings: { default_location: settings.default_location },
      prefill: {
        program_id: prog?.id ?? "",
        date: isDateKey(ctx.search.date) ? ctx.search.date : addDays(dateKey(ctx.now), 1),
        time: /^\d{2}:\d{2}$/.test(ctx.search.time ?? "") ? ctx.search.time : "17:00",
        coach_ids: [ctx.actor.user!.id],
      },
    };
  }
  const s = await ctx.store.get("sessions", ctx.params.id);
  if (!s) throw new NotFound();
  const [view] = await enrich(ctx.store, [s], L, null);
  const bookings = await ctx.store.list("bookings", { eq: { session_id: s.id } });
  const roster = bookings
    .sort(by((b) => `${["confirmed", "pending", "waitlisted", "cancelled", "declined"].indexOf(b.status)}-${String(b.waitlist_position ?? 0).padStart(3, "0")}-${b.created_at}`))
    .map((b) => ({ booking: b, player: L.profile.get(b.user_id) ? { ...person(L.profile.get(b.user_id)!), email: L.profile.get(b.user_id)!.email, phone: L.profile.get(b.user_id)!.phone } : null }));
  return { mode: "edit" as const, session: view, roster, programs, coaches, members, settings: { default_location: settings.default_location }, prefill: null };
}

export async function loadAdminPrograms(ctx: LoadCtx) {
  const programs = (await ctx.store.list("programs")).sort(by((p) => p.sort_order));
  const sessions = await ctx.store.list("sessions", { gte: { field: "starts_at", value: ctx.now.toISOString() } });
  return { programs: programs.map((p) => ({ ...p, upcoming: sessions.filter((s) => s.program_id === p.id && s.status === "published").length })) };
}

export async function loadProgramEditor(ctx: LoadCtx) {
  const settings = await getSettings(ctx.store);
  if (ctx.params.id === "new") return { program: null, defaultLocation: settings.default_location };
  const p = await ctx.store.get("programs", ctx.params.id);
  if (!p) throw new NotFound();
  return { program: p, defaultLocation: settings.default_location };
}

export async function loadTemplates(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const templates = (await ctx.store.list("schedule_templates")).sort(by((t) => `${(t.weekday + 6) % 7}-${t.start_time}`));
  return {
    templates: templates.map((t) => ({ ...t, program: L.program.get(t.program_id) ? programLite(L.program.get(t.program_id)!) : UNKNOWN_PROGRAM })),
    programs: L.programs.filter((p) => p.active).map(programLite),
    coaches: L.profiles.filter(isStaff).map(person),
    nextMonday: addDays(startOfWeek(dateKey(ctx.now)), 7),
  };
}

export async function loadAdminRequests(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const settings = await getSettings(ctx.store);
  const all = (await ctx.store.list("lesson_requests")).sort(by((r) => r.created_at, -1));
  const pendingBookings = (await ctx.store.list("bookings", { eq: { status: "pending" } }));
  const ps = await ctx.store.list("sessions", { in: { field: "id", values: pendingBookings.map((b) => b.session_id) } });
  const psv = new Map((await enrich(ctx.store, ps, L, null)).map((s) => [s.id, s]));
  const decorate = (r: (typeof all)[number]) => ({
    ...r,
    program: L.program.get(r.program_id) ?? null,
    player: L.profile.get(r.user_id) ? { ...person(L.profile.get(r.user_id)!), email: L.profile.get(r.user_id)!.email, phone: L.profile.get(r.user_id)!.phone } : null,
  });
  return {
    pending: all.filter((r) => r.status === "pending").map(decorate),
    handled: all.filter((r) => r.status !== "pending").slice(0, 20).map(decorate),
    pendingBookings: pendingBookings.map((b) => ({ booking: b, session: psv.get(b.session_id)!, player: L.profile.get(b.user_id)?.full_name ?? "Player" })).filter((r) => r.session),
    coaches: L.profiles.filter(isStaff).map(person),
    defaultLocation: settings.default_location,
    me: ctx.actor.user!.id,
  };
}

export async function loadAdminMembers(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const q = (ctx.search.q ?? "").toLowerCase().trim();
  const role = ctx.search.role ?? "";
  const tag = ctx.search.tag ?? "";
  const bookings = await ctx.store.list("bookings");
  const count = new Map<string, number>();
  for (const b of bookings) if (holdsSeat(b)) count.set(b.user_id, (count.get(b.user_id) ?? 0) + 1);
  const members = L.profiles
    .filter((p) => (!role || p.role === role) && (!tag || p.tags.includes(tag)))
    .filter((p) => !q || [p.full_name, p.email ?? "", p.phone ?? ""].some((v) => v.toLowerCase().includes(q)))
    .sort(by((p) => p.full_name))
    .map((p) => ({ ...p, bookings: count.get(p.id) ?? 0 }));
  const tags = [...new Set(L.profiles.flatMap((p) => p.tags))].sort();
  return { members, q, role, tag, tags, total: L.profiles.length };
}

export async function loadAdminMember(ctx: LoadCtx) {
  const base = await loadCoachPlayer(ctx);
  const L = await lookups(ctx.store);
  const requests = (await ctx.store.list("lesson_requests", { eq: { user_id: ctx.params.id } })).map((r) => ({ ...r, program: L.program.get(r.program_id)?.name ?? "" }));
  const p = await ctx.store.get("profiles", ctx.params.id);
  return { ...base, profile: p!, requests };
}

export async function loadAnnouncements(ctx: LoadCtx) {
  const L = await lookups(ctx.store);
  const list = (await ctx.store.list("announcements")).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.created_at < b.created_at ? 1 : -1));
  return { announcements: list.map((a) => ({ ...a, author: L.profile.get(a.author_id)?.full_name ?? "" })), audience: L.profiles.filter((p) => p.status === "active").length };
}

export async function loadNotifications(ctx: LoadCtx) {
  const list = (await ctx.store.list("notifications")).sort(by((n) => n.created_at, -1)).slice(0, 150);
  return { notifications: list };
}

export async function loadSettingsPage(ctx: LoadCtx): Promise<{ settings: Settings; storeKind: string }> {
  return { settings: await getSettings(ctx.store), storeKind: ctx.store.kind };
}
