// All state-changing operations. Every action validates its input with Zod
// and checks the actor's permissions before touching the store.
import { z, ZodError } from "zod";
import type { ActionResult, Actor, Booking, BookingStatus, Client, CommissionRule, Feedback, Lesson, Profile, Session, SessionType, Settings } from "./types";
import type { Store } from "./store";
import { addDays, dateKey, fmtDay, fmtTime, timeKey, zonedToUtc } from "./time";
import { courtPlan, isBalboa, isEmail, normalizePhone, nowIso, uid } from "./util";
import { DEFAULT_SETTINGS } from "./seed";
import { COMMISSION_ROWS, commissionFor } from "./earnings";
import { hasClient, nameKey, overlaps, sameName, weeklyDates } from "./clients";
import { SKILLS } from "./progress";

export class UserError extends Error {}

export interface Ctx {
  store: Store;
  actor: Actor;
  now: Date;
}

// ───────────────────────── helpers ─────────────────────────

const ACTIVE: BookingStatus[] = ["confirmed", "waitlisted"];
export const isActive = (b: Booking) => ACTIVE.includes(b.status);
export const holdsSeat = (b: Booking) => b.status === "confirmed";
export const seatsUsed = (bs: Booking[]) => bs.filter(holdsSeat).reduce((n, b) => n + (b.seats || 1), 0);

export const isStaff = (p: Profile | null | undefined) => !!p && (p.role === "coach" || p.role === "admin");
export const isAdmin = (p: Profile | null | undefined) => !!p && p.role === "admin";
export const coachesSession = (p: Profile | null | undefined, s: Session) =>
  !!p && (p.role === "admin" || (p.role === "coach" && s.coach_ids.includes(p.id)));

function me(ctx: Ctx): Profile {
  const u = ctx.actor.user;
  if (!u) throw new UserError("Please sign in first.");
  if (u.status === "inactive") throw new UserError("Your account is inactive. Please contact the coach.");
  return u;
}
function staff(ctx: Ctx): Profile {
  const u = me(ctx);
  if (!isStaff(u)) throw new UserError("Coaches only.");
  return u;
}
function admin(ctx: Ctx): Profile {
  const u = me(ctx);
  if (!isAdmin(u)) throw new UserError("Administrators only.");
  return u;
}

export async function getSettings(store: Store): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await store.get("settings", "default")) };
}

async function must<T>(p: Promise<T | null>, what: string): Promise<T> {
  const v = await p;
  if (!v) throw new UserError(`${what} not found.`);
  return v;
}

// Zod helpers that cope with FormData-shaped input.
const text = (max = 2000) => z.preprocess((v) => (v === undefined || v === null ? "" : String(v)), z.string().trim().max(max));
const req = (label: string, max = 200) =>
  z.preprocess((v) => (v === undefined || v === null ? "" : String(v)), z.string().trim().min(1, `${label} is required`).max(max));
const int = (min: number, max: number, label: string) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)), z.number({ invalid_type_error: `${label} must be a number`, required_error: `${label} is required` }).int().min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`));
const dollars = z.preprocess((v) => {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}, z.number({ invalid_type_error: "Price must be a number" }).int().min(0, "Price can't be negative").nullable());
const ids = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string()));
const date = z.string({ required_error: "Choose a date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const time = z.string({ required_error: "Choose a time" }).regex(/^\d{2}:\d{2}$/, "Choose a time");
const id = z.string().min(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const court = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : Number(v)), z.number().int().min(1, "Choose court 1–4").max(4, "Choose court 1–4").nullable());
/** Courts only exist at Balboa; any other location clears it. */
const courtFor = (location: string, c: number | null) => (isBalboa(location) ? c : null);

const sessionTypes = z.enum(["group", "performance_accelerator"]);
const skills = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(SKILLS.map((s) => s.key) as [Feedback["skills"][number], ...Feedback["skills"]])));

// ───────────────────────── booking engine ─────────────────────────

/** Transaction-safe seat allocation. Uses a DB function on Supabase, a mutex in memory. */
export async function placeBooking(ctx: Ctx, session: Session, user: Profile, forceStatus?: BookingStatus): Promise<Booking> {
  if (ctx.store.rpc) {
    return ctx.store.rpc<Booking>("book_session", { p_session_id: session.id, p_user_id: user.id, p_force_status: forceStatus ?? null });
  }

  return ctx.store.exclusive(`session:${session.id}`, async () => {
    const all = await ctx.store.list("bookings", { eq: { session_id: session.id } });
    const mine = all.find((b) => b.user_id === user.id && isActive(b));
    if (mine) {
      throw new UserError(mine.status === "waitlisted" ? "You're already on the waitlist for this session." : "You're already booked into this session.");
    }
    const status: BookingStatus = forceStatus ?? (seatsUsed(all) + 1 <= session.capacity ? "confirmed" : "waitlisted");
    const position = status === "waitlisted" ? Math.max(0, ...all.filter((b) => b.status === "waitlisted").map((b) => b.waitlist_position ?? 0)) + 1 : null;
    return ctx.store.insert("bookings", newBooking(session.id, user.id, status, position));
  });
}

function newBooking(sessionId: string, userId: string, status: BookingStatus, position: number | null): Booking {
  const ts = nowIso();
  return {
    id: uid(),
    session_id: sessionId,
    user_id: userId,
    status,
    seats: 1,
    waitlist_position: position,
    attended: null,
    late_cancel: false,
    cancel_reason: "",
    created_at: ts,
    updated_at: ts,
    cancelled_at: null,
    spot_offered_at: null,
  };
}

/** Cancel a booking and move the next person in from the waitlist. */
async function cancelAndPromote(ctx: Ctx, booking: Booking, session: Session, reason: string, late: boolean): Promise<void> {
  if (ctx.store.rpc) {
    // The database function cancels and promotes from the waitlist atomically.
    await ctx.store.rpc("cancel_booking", { p_booking_id: booking.id, p_reason: reason, p_late: late });
    return;
  }
  await ctx.store.exclusive(`session:${session.id}`, async () => {
    const ts = nowIso();
    await ctx.store.update("bookings", booking.id, {
      status: "cancelled",
      cancelled_at: ts,
      updated_at: ts,
      cancel_reason: reason,
      late_cancel: late,
      waitlist_position: null,
    });
    await promoteWaitlist(ctx, session);
    await reindexWaitlist(ctx, session.id);
  });
}

async function promoteWaitlist(ctx: Ctx, session: Session): Promise<Booking[]> {
  const all = await ctx.store.list("bookings", { eq: { session_id: session.id } });
  let free = session.capacity - seatsUsed(all);
  const queue = all
    .filter((b) => b.status === "waitlisted")
    .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0));
  const promoted: Booking[] = [];
  for (const b of queue) {
    if (free <= 0) break;
    if ((b.seats || 1) > free) continue;
    promoted.push(await ctx.store.update("bookings", b.id, { status: "confirmed", waitlist_position: null, updated_at: nowIso() }));
    free -= b.seats || 1;
  }
  return promoted;
}

async function reindexWaitlist(ctx: Ctx, sessionId: string) {
  const wl = (await ctx.store.list("bookings", { eq: { session_id: sessionId, status: "waitlisted" } })).sort(
    (a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0),
  );
  for (let i = 0; i < wl.length; i++) {
    if (wl[i].waitlist_position !== i + 1) await ctx.store.update("bookings", wl[i].id, { waitlist_position: i + 1 });
  }
}

function decided(choice: "run" | "one_court" | "cancel", moved: number): ActionResult {
  const players = `${moved} player${moved === 1 ? "" : "s"}`;
  if (choice === "cancel") return { ok: true, message: moved ? `Session cancelled. Let the ${players} know on WhatsApp.` : "Session cancelled." };
  if (choice === "one_court") return { ok: true, message: moved ? `Now on one court. ${players} moved to the waitlist; let them know on WhatsApp.` : "Now on one court." };
  return { ok: true, message: "Going ahead on two courts." };
}

// ───────────────────────── actions ─────────────────────────

type Handler = (ctx: Ctx, input: Record<string, unknown>) => Promise<ActionResult>;

function action<S extends z.ZodTypeAny>(schema: S, fn: (ctx: Ctx, input: z.infer<S>) => Promise<ActionResult>): Handler {
  return async (ctx, raw) => fn(ctx, schema.parse(raw));
}

const profileFields = { full_name: req("Full name", 120), phone: text(40), email: text(200) };

function cleanContact(input: { email: string; phone: string }) {
  const email = input.email ? input.email.toLowerCase() : "";
  if (email && !isEmail(email)) throw new UserError("Please enter a valid email address.");
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new UserError("Please enter a valid phone number, e.g. (619) 555-0123.");
  }
  return { email: email || null, phone };
}

function lessonClients(kind: Lesson["kind"], raw: string): string[] {
  const names = kind === "private" ? [raw] : raw.split(/[,\n]/);
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) throw new UserError(kind === "private" ? "Add the client's name." : "Add the clients' names.");
  if (kind === "semi_private" && clean.length < 2) throw new UserError("A semi-private lesson needs at least two names, separated by commas.");
  return clean;
}

/** A client card for every lesson name the coach doesn't have one for yet. */
async function ensureClients(ctx: Ctx, coachId: string, names: string[]) {
  const have = new Set((await ctx.store.list("clients", { eq: { coach_id: coachId } })).map((c) => nameKey(c.full_name)));
  for (const name of names) {
    if (have.has(nameKey(name))) continue;
    have.add(nameKey(name));
    const at = nowIso();
    // Another tab may have just added the same name; the database keeps one card per name.
    await ctx.store.insert("clients", { id: uid(), coach_id: coachId, full_name: name, phone: null, email: null, level: "", goals: "", notes: "", created_at: at, updated_at: at }).catch(() => undefined);
  }
}

/** What the coach already has at that time: one of their lessons or a community session they coach. */
async function clashFor(ctx: Ctx, coachId: string, slot: { starts_at: string; ends_at: string }, skipLessonId?: string) {
  const day = { gte: { field: "starts_at" as const, value: new Date(new Date(slot.starts_at).getTime() - 86400000).toISOString() }, lt: { field: "starts_at" as const, value: slot.ends_at } };
  const [lessons, sessions] = await Promise.all([ctx.store.list("lessons", { eq: { coach_id: coachId }, ...day }), ctx.store.list("sessions", { contains: { field: "coach_ids", value: coachId }, ...day })]);
  const lesson = lessons.find((l) => l.id !== skipLessonId && overlaps(l, slot));
  if (lesson) return `${lesson.client_names.join(", ")}'s lesson`;
  const session = sessions.find((s) => s.session_type && s.status !== "cancelled" && overlaps(s, slot));
  return session ? (session.session_type === "group" ? "a Group Session" : "a Performance Accelerator") : null;
}

const clientFields = {
  id: text(80),
  full_name: req("Name", 120),
  phone: text(40),
  email: text(200),
  level: text(60),
  goals: text(1000),
  notes: text(4000),
};

export const actions: Record<string, Handler> = {
  // ── Player: account ──
  completeOnboarding: action(z.object(profileFields), async (ctx, input) => {
    const a = ctx.actor;
    if (!a.auth_id) throw new UserError("Please sign in first.");
    const contact = cleanContact(input);
    if (!contact.email && !contact.phone) throw new UserError("Add an email or phone number.");
    const existing = a.user ?? (await ctx.store.get("profiles", a.auth_id));
    const base = { full_name: input.full_name, email: contact.email, phone: contact.phone, onboarded: true };
    if (existing) await ctx.store.update("profiles", existing.id, base);
    else await ctx.store.insert("profiles", { id: a.auth_id, role: "member", emergency_contact: "", status: "active", created_at: nowIso(), ...base });
    return { ok: true, redirect: "/schedule" };
  }),

  updateMyProfile: action(z.object(profileFields), async (ctx, input) => {
    const u = me(ctx);
    const contact = cleanContact(input);
    await ctx.store.update("profiles", u.id, { full_name: input.full_name, email: contact.email ?? u.email, phone: contact.phone });
    return { ok: true, message: "Profile saved." };
  }),

  setWeeklyGoal: action(z.object({ goal: z.coerce.number().int().min(1).max(3) }), async (ctx, input) => {
    const u = me(ctx);
    await ctx.store.update("profiles", u.id, { weekly_goal: input.goal });
    return { ok: true, message: `Goal set: ${input.goal === 1 ? "1 session" : `${input.goal} sessions`} a week.` };
  }),

  setLeaderboardHidden: action(z.object({ hidden: z.boolean() }), async (ctx, input) => {
    const u = me(ctx);
    await ctx.store.update("profiles", u.id, { leaderboard_hidden: input.hidden });
    return { ok: true, message: input.hidden ? "You're off the leaderboard." : "You're back on the leaderboard." };
  }),

  // ── Player: booking ──
  bookSession: action(z.object({ session_id: id }), async (ctx, input) => {
    const u = me(ctx);
    const book = async () => {
      // The live database makes these same checks inside book_session, so looking first would only add a trip.
      if (ctx.store.rpc) return ctx.store.rpc<Booking>("book_session", { p_session_id: input.session_id, p_user_id: u.id, p_force_status: null });
      const session = await must(ctx.store.get("sessions", input.session_id), "Session");
      if (session.status !== "published" || !session.session_type) throw new UserError("This session isn't open for booking.");
      if (new Date(session.starts_at) <= ctx.now) throw new UserError("This session has already started.");
      return placeBooking(ctx, session, u);
    };
    const b = await book();
    // The page shows what really happened, which can differ from what it showed before the tap.
    const data = { status: b.status, waitlist_position: b.waitlist_position };
    return b.status === "waitlisted" ? { ok: true, data, message: b.waitlist_position === 1 ? "You're next in line. The first spot that opens is yours." : `You're #${b.waitlist_position} in line. We'll move you in the moment a spot opens.` } : { ok: true, data, message: "You're booked!" };
  }),

  cancelBooking: action(z.object({ booking_id: id, reason: text(300) }), async (ctx, input) => {
    const u = me(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    const session = await must(ctx.store.get("sessions", b.session_id), "Session");
    const staffCancel = coachesSession(u, session);
    if (b.user_id !== u.id && !staffCancel) throw new UserError("You can only cancel your own bookings.");
    if (!isActive(b)) throw new UserError("This booking is already cancelled.");
    if (new Date(session.starts_at) <= ctx.now && !staffCancel) throw new UserError("This session has already started.");
    const { cancellation_window_hours: window } = await getSettings(ctx.store);
    const hoursLeft = (new Date(session.starts_at).getTime() - ctx.now.getTime()) / 3600000;
    if (!staffCancel && b.status === "confirmed" && hoursLeft < window) {
      throw new UserError(`It's less than ${window} hours to the session, so you can't cancel. Offer your spot instead.`);
    }
    const forSomeoneElse = b.user_id !== u.id;
    await cancelAndPromote(ctx, b, session, input.reason || (forSomeoneElse ? "Cancelled by coach" : "Cancelled by player"), false);
    if (forSomeoneElse) return { ok: true, message: b.status === "waitlisted" ? "Taken off the waitlist." : "Player removed. The waitlist moves up." };
    return { ok: true, message: b.status === "waitlisted" ? "You've left the waitlist." : "Booking cancelled." };
  }),

  // Inside the cancellation window a booked player offers their spot instead of cancelling.
  // They stay booked (and pay) until someone takes it.
  offerSpot: action(z.object({ booking_id: id }), async (ctx, input) => {
    const u = me(ctx);
    if (ctx.store.rpc) await ctx.store.rpc("offer_spot", { p_booking_id: input.booking_id });
    else {
      const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
      if (b.user_id !== u.id) throw new UserError("Booking not found.");
      if (b.status !== "confirmed") throw new UserError("Only a booked spot can be offered.");
      const session = await must(ctx.store.get("sessions", b.session_id), "Session");
      if (session.status !== "published" || new Date(session.starts_at) <= ctx.now) throw new UserError("This session has already started.");
      if (!b.spot_offered_at) await ctx.store.update("bookings", b.id, { spot_offered_at: nowIso(), updated_at: nowIso() });
    }
    return { ok: true, message: "Your spot is on offer. You're still booked until someone takes it." };
  }),

  withdrawOffer: action(z.object({ booking_id: id }), async (ctx, input) => {
    const u = me(ctx);
    if (ctx.store.rpc) await ctx.store.rpc("withdraw_offer", { p_booking_id: input.booking_id });
    else {
      const first = await must(ctx.store.get("bookings", input.booking_id), "Booking");
      if (first.user_id !== u.id) throw new UserError("Booking not found.");
      await ctx.store.exclusive(`session:${first.session_id}`, async () => {
        const b = await must(ctx.store.get("bookings", first.id), "Booking");
        if (b.status !== "confirmed") throw new UserError("Someone has already taken your spot.");
        await ctx.store.update("bookings", b.id, { spot_offered_at: null, updated_at: nowIso() });
      });
    }
    return { ok: true, message: "Offer taken back. The spot is yours." };
  }),

  takeSpot: action(z.object({ session_id: id }), async (ctx, input) => {
    const u = me(ctx);
    if (ctx.store.rpc) await ctx.store.rpc<Booking>("take_offered_spot", { p_session_id: input.session_id });
    else {
      const session = await must(ctx.store.get("sessions", input.session_id), "Session");
      if (!session.session_type) throw new UserError("Session not found.");
      if (session.status !== "published" || new Date(session.starts_at) <= ctx.now) throw new UserError("This session has already started.");
      await ctx.store.exclusive(`session:${session.id}`, async () => {
        const all = await ctx.store.list("bookings", { eq: { session_id: session.id } });
        const mine = all.find((b) => b.user_id === u.id && isActive(b));
        if (mine?.status === "confirmed") throw new UserError("You're already booked into this session.");
        const offer = all
          .filter((b) => b.status === "confirmed" && b.spot_offered_at && b.user_id !== u.id)
          .sort((a, b) => (a.spot_offered_at! < b.spot_offered_at! ? -1 : 1))[0];
        if (!offer) throw new UserError("Someone else just took this spot.");
        const ts = nowIso();
        await ctx.store.update("bookings", offer.id, {
          status: "cancelled",
          cancelled_at: ts,
          updated_at: ts,
          cancel_reason: `Handed over to ${u.full_name}`,
          late_cancel: false,
          waitlist_position: null,
        });
        if (mine) await ctx.store.update("bookings", mine.id, { status: "confirmed", waitlist_position: null, updated_at: ts });
        else await ctx.store.insert("bookings", newBooking(session.id, u.id, "confirmed", null));
        await reindexWaitlist(ctx, session.id);
      });
    }
    return { ok: true, message: "The spot is yours. You're booked!" };
  }),

  // ── Coach: community sessions ──
  setAttendance: action(z.object({ booking_id: id, attended: z.enum(["yes", "no", "clear"]) }), async (ctx, input) => {
    const u = staff(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    const s = await must(ctx.store.get("sessions", b.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only take attendance for your own sessions.");
    await ctx.store.update("bookings", b.id, { attended: input.attended === "clear" ? null : input.attended === "yes", updated_at: nowIso() });
    // Skill taps only stand for players who were there.
    if (input.attended !== "yes") {
      const notes = await ctx.store.list("feedback", { eq: { session_id: s.id, user_id: b.user_id } }).catch(() => []);
      for (const f of notes) await ctx.store.remove("feedback", f.id);
    }
    return { ok: true };
  }),

  saveFeedback: action(z.object({ booking_id: id, skills, tip: text(300) }), async (ctx, input) => {
    const u = staff(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    const s = await must(ctx.store.get("sessions", b.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only give feedback for your own sessions.");
    if (b.status !== "confirmed" || b.attended !== true) throw new UserError("Mark them present first.");
    const [existing] = await ctx.store.list("feedback", { eq: { session_id: s.id, user_id: b.user_id } });
    const picked = [...new Set(input.skills)];
    const ts = nowIso();
    if (!picked.length && !input.tip) {
      if (existing) await ctx.store.remove("feedback", existing.id);
    } else if (existing) {
      await ctx.store.update("feedback", existing.id, { skills: picked, tip: input.tip, coach_id: u.id, updated_at: ts });
    } else {
      await ctx.store.insert("feedback", { id: uid(), session_id: s.id, user_id: b.user_id, coach_id: u.id, skills: picked, tip: input.tip, created_at: ts, updated_at: ts });
    }
    return { ok: true };
  }),

  markAllPresent: action(z.object({ session_id: id }), async (ctx, input) => {
    const u = staff(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only take attendance for your own sessions.");
    for (const b of await ctx.store.list("bookings", { eq: { session_id: s.id, status: "confirmed" } })) {
      if (b.attended === null) await ctx.store.update("bookings", b.id, { attended: true });
    }
    return { ok: true, message: "Everyone marked present." };
  }),

  saveSessionNotes: action(z.object({ session_id: id, internal_notes: text(4000) }), async (ctx, input) => {
    const u = staff(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only edit notes for your own sessions.");
    if (ctx.store.rpc) await ctx.store.rpc("set_session_notes", { p_session_id: s.id, p_notes: input.internal_notes });
    else await ctx.store.update("sessions", s.id, { internal_notes: input.internal_notes });
    return { ok: true, message: "Notes saved." };
  }),

  // Move when a short two-court session gets decided, so players see the new time.
  setDecideBy: action(z.object({ session_id: id, at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time") }), async (ctx, input) => {
    const u = staff(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only change your own sessions.");
    const [day, hhmm] = input.at.split("T");
    const at = zonedToUtc(day, hhmm);
    if (at.getTime() <= ctx.now.getTime()) throw new UserError("Pick a time that hasn't passed yet.");
    if (at.toISOString() >= s.starts_at) throw new UserError("Pick a time before the session starts.");
    if (ctx.store.rpc) await ctx.store.rpc("set_decide_by", { p_session_id: s.id, p_at: at.toISOString() });
    else await ctx.store.update("sessions", s.id, { decide_by: at.toISOString() });
    return { ok: true, message: `Players now see it's decided by ${fmtDay(at)} at ${fmtTime(at)}.` };
  }),

  // A two-court session under its minimum: run it anyway, drop to one court, or cancel it.
  decideSession: action(z.object({ session_id: id, choice: z.enum(["run", "one_court", "cancel"]) }), async (ctx, input) => {
    const u = staff(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only decide on your own sessions.");
    if (s.status !== "published") throw new UserError("This session isn't open.");
    const { size, courts } = courtPlan(s);
    if (courts < 2) throw new UserError("This session is already on one court.");
    if (ctx.store.rpc) {
      const moved = await ctx.store.rpc<number>("decide_session", { p_session_id: s.id, p_choice: input.choice });
      return decided(input.choice, moved ?? 0);
    }
    const moved = await ctx.store.exclusive(`session:${s.id}`, async () => {
      const active = (await ctx.store.list("bookings", { eq: { session_id: s.id } })).filter(isActive);
      const ts = nowIso();
      if (input.choice === "cancel") {
        for (const b of active) {
          await ctx.store.update("bookings", b.id, { status: "cancelled", cancelled_at: ts, updated_at: ts, cancel_reason: "Not enough players for two courts", waitlist_position: null });
        }
        await ctx.store.update("sessions", s.id, { status: "cancelled", decided_at: ts });
        return active.length;
      }
      if (input.choice === "run") {
        await ctx.store.update("sessions", s.id, { decided_at: ts });
        return 0;
      }
      // One court: the earliest sign-ups keep their spots; the rest go to the front of the waitlist.
      const booked = active.filter((b) => b.status === "confirmed").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const bumped = booked.slice(size);
      const queue = [...bumped, ...active.filter((b) => b.status === "waitlisted").sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0))];
      for (let i = 0; i < queue.length; i++) {
        await ctx.store.update("bookings", queue[i].id, { status: "waitlisted", waitlist_position: i + 1, spot_offered_at: null, updated_at: ts });
      }
      await ctx.store.update("sessions", s.id, { capacity: size, decided_at: ts });
      return bumped.length;
    });
    return decided(input.choice, moved);
  }),

  // ── Coach: private and semi-private lessons ──
  saveLesson: action(
    z.object({
      id: text(80),
      kind: z.enum(["private", "semi_private"]),
      client_names: text(1000),
      date,
      time,
      duration_min: int(15, 600, "Duration"),
      location: text(200),
      court,
      price: dollars,
      paid: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
      notes: text(4000),
      repeat_weeks: z.preprocess((v) => (v === "" || v === undefined ? 1 : Number(v)), z.number().int().min(1).max(26)),
      back: text(200),
    }),
    async (ctx, input) => {
      const u = staff(ctx);
      const rules = await ctx.store.list("commission_rules");
      const clients = lessonClients(input.kind, input.client_names);
      const prev = input.id ? await must(ctx.store.get("lessons", input.id), "Lesson") : null;
      if (prev && prev.coach_id !== u.id) throw new UserError("Only the lesson's coach can change it.");
      // Pages that send the coach here can ask to come back after saving; anything else goes to the schedule.
      const back = (week: string) => (/^\/coach\/clients\/[\w-]+$/.test(input.back) ? input.back : `/coach?week=${week}`);
      const fieldsFor = (day: string) => {
        const start = zonedToUtc(day, input.time);
        const money = {
          price_cents: input.price,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + input.duration_min * 60000).toISOString(),
          location: input.location,
        };
        // The commission stays as saved unless something it depends on changed, so new club rates don't rewrite old lessons.
        const same = prev && prev.commission_cents !== null && prev.price_cents === money.price_cents && prev.location === money.location && prev.ends_at === money.ends_at && prev.starts_at === money.starts_at;
        return {
          kind: input.kind,
          client_names: clients,
          ...money,
          court: courtFor(input.location, input.court),
          commission_cents: same ? prev.commission_cents : commissionFor(money, rules),
          paid_at: input.paid ? (prev?.paid_at ?? nowIso()) : null,
          notes: input.notes,
          updated_at: nowIso(),
        };
      };
      await ensureClients(ctx, u.id, clients);
      if (prev) {
        const fields = fieldsFor(input.date);
        // Only a new time is checked, so an old double booking can still have its notes or payment saved.
        const moved = fields.starts_at !== prev.starts_at || fields.ends_at !== prev.ends_at;
        const clash = moved ? await clashFor(ctx, u.id, fields, prev.id) : null;
        if (clash) throw new UserError(`That time overlaps ${clash}. Pick another time.`);
        await ctx.store.update("lessons", prev.id, fields);
        return { ok: true, message: "Lesson saved.", redirect: back(input.date) };
      }
      // Booking ahead: the same lesson every week. Weeks that clash are skipped and named.
      const skipped: string[] = [];
      let added = 0;
      for (const day of weeklyDates(input.date, input.repeat_weeks)) {
        const fields = fieldsFor(day);
        const clash = await clashFor(ctx, u.id, fields);
        if (clash) {
          if (input.repeat_weeks === 1) throw new UserError(`That time overlaps ${clash}. Pick another time.`);
          skipped.push(fmtDay(fields.starts_at));
          continue;
        }
        await ctx.store.insert("lessons", { id: uid(), coach_id: u.id, created_at: nowIso(), ...fields, paid_at: added === 0 ? fields.paid_at : null });
        added++;
      }
      if (!added) throw new UserError(`Every week clashes with something else at ${fmtTime(fieldsFor(input.date).starts_at)}. Pick another time.`);
      const message = input.repeat_weeks === 1 ? "Lesson added." : `${added} weekly lessons added.${skipped.length ? ` Skipped ${skipped.join(", ")}: you're busy then.` : ""}`;
      return { ok: true, message, redirect: back(input.date) };
    },
  ),

  deleteLesson: action(z.object({ lesson_id: id }), async (ctx, input) => {
    const u = staff(ctx);
    const l = await must(ctx.store.get("lessons", input.lesson_id), "Lesson");
    if (l.coach_id !== u.id) throw new UserError("Only the lesson's coach can delete it.");
    await ctx.store.remove("lessons", l.id);
    return { ok: true, message: "Lesson deleted.", redirect: "/coach" };
  }),

  setLessonPaid: action(z.object({ lesson_id: id, paid: z.enum(["yes", "no"]) }), async (ctx, input) => {
    const u = staff(ctx);
    const l = await must(ctx.store.get("lessons", input.lesson_id), "Lesson");
    if (l.coach_id !== u.id) throw new UserError("Only the lesson's coach can change it.");
    await ctx.store.update("lessons", l.id, { paid_at: input.paid === "yes" ? nowIso() : null });
    return { ok: true, message: input.paid === "yes" ? "Marked paid." : "Marked unpaid." };
  }),

  // ── Coach: clients ──
  saveClient: action(z.object(clientFields), async (ctx, input) => {
    const u = staff(ctx);
    const contact = cleanContact(input);
    const mine = await ctx.store.list("clients", { eq: { coach_id: u.id } });
    const prev = input.id ? mine.find((c) => c.id === input.id) : null;
    if (input.id && !prev) throw new UserError("Client not found.");
    const name = input.full_name.replace(/\s+/g, " ");
    if (mine.some((c) => c.id !== prev?.id && sameName(c.full_name, name))) throw new UserError(`You already have a client called ${name}.`);
    const fields = { full_name: name, ...contact, level: input.level, goals: input.goals, notes: input.notes, updated_at: nowIso() };
    if (!prev) {
      const id = uid();
      await ctx.store.insert("clients", { id, coach_id: u.id, created_at: nowIso(), ...fields } satisfies Client);
      return { ok: true, message: `${name} added.`, redirect: `/coach/clients/${id}` };
    }
    // A new name carries over to their lessons, so their history follows them.
    if (prev.full_name !== name) {
      for (const l of await ctx.store.list("lessons", { eq: { coach_id: u.id } })) {
        if (hasClient(l, prev.full_name)) await ctx.store.update("lessons", l.id, { client_names: l.client_names.map((n) => (sameName(n, prev.full_name) ? name : n)), updated_at: nowIso() });
      }
    }
    await ctx.store.update("clients", prev.id, fields);
    return { ok: true, message: "Client saved." };
  }),

  deleteClient: action(z.object({ client_id: id }), async (ctx, input) => {
    const u = staff(ctx);
    const c = await must(ctx.store.get("clients", input.client_id), "Client");
    if (c.coach_id !== u.id) throw new UserError("Only the client's coach can remove them.");
    await ctx.store.remove("clients", c.id);
    return { ok: true, message: `${c.full_name} removed from your clients. Their lessons stay on your schedule.`, redirect: "/coach/clients" };
  }),

  // ── Admin: community schedule ──
  saveSession: action(
    z.object({
      id: text(80),
      session_type: sessionTypes,
      title: text(120),
      date,
      time,
      duration_min: int(15, 600, "Duration"),
      capacity: int(1, 200, "Capacity"),
      price: dollars,
      location: text(200),
      court,
      coach_ids: ids,
      status: z.enum(["draft", "published"]).default("draft"),
      description: text(2000),
      internal_notes: text(2000),
      repeat_weeks: int(0, 26, "Repeat").default(0),
    }),
    async (ctx, input) => {
      admin(ctx);
      const settings = await getSettings(ctx.store);
      const start = zonedToUtc(input.date, input.time);
      const location = input.location || settings.default_location;
      const fields = {
        session_type: input.session_type as SessionType,
        title: input.session_type === "performance_accelerator" ? input.title : "",
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + input.duration_min * 60000).toISOString(),
        coach_ids: input.coach_ids,
        capacity: input.capacity,
        price_cents: input.price,
        location,
        court: courtFor(location, input.court),
        status: input.status,
        description: input.description,
        internal_notes: input.internal_notes,
      } satisfies Partial<Session>;

      if (input.id) {
        const prev = await must(ctx.store.get("sessions", input.id), "Session");
        if (prev.status === "cancelled") throw new UserError("This session was cancelled. Copy it instead.");
        const bookings = await ctx.store.list("bookings", { eq: { session_id: prev.id } });
        if (input.capacity < seatsUsed(bookings)) throw new UserError(`Capacity can't be lower than the ${seatsUsed(bookings)} seats already booked.`);
        const s = await ctx.store.update("sessions", prev.id, fields);
        let promoted: Booking[] = [];
        if (input.capacity > prev.capacity) {
          promoted = await ctx.store.exclusive(`session:${s.id}`, async () => {
            const p = await promoteWaitlist(ctx, s);
            await reindexWaitlist(ctx, s.id);
            return p;
          });
        }
        return { ok: true, message: promoted.length ? `Saved. ${promoted.length} player(s) moved off the waitlist.` : "Session saved." };
      }

      let first: Session | null = null;
      for (let w = 0; w <= input.repeat_weeks; w++) {
        const at = zonedToUtc(addDays(input.date, w * 7), input.time);
        const s: Session = {
          id: uid(),
          ...fields,
          starts_at: at.toISOString(),
          ends_at: new Date(at.getTime() + input.duration_min * 60000).toISOString(),
          created_at: nowIso(),
        };
        await ctx.store.insert("sessions", s);
        first ??= s;
      }
      return {
        ok: true,
        message: input.repeat_weeks ? `Created ${input.repeat_weeks + 1} weekly sessions.` : "Session created.",
        redirect: `/admin/sessions/${first!.id}`,
      };
    },
  ),

  setSessionStatus: action(z.object({ session_id: id, status: z.enum(["draft", "published", "cancelled"]), reason: text(300) }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    if (input.status === "cancelled") {
      const active = (await ctx.store.list("bookings", { eq: { session_id: s.id } })).filter(isActive);
      for (const b of active) {
        await ctx.store.update("bookings", b.id, {
          status: "cancelled",
          cancelled_at: nowIso(),
          updated_at: nowIso(),
          cancel_reason: input.reason || "Session cancelled by coach",
          waitlist_position: null,
        });
      }
      await ctx.store.update("sessions", s.id, { status: "cancelled" });
      return { ok: true, message: active.length ? `Session cancelled. Let the ${active.length} affected player(s) know on WhatsApp.` : "Session cancelled." };
    }
    if (s.status === "cancelled") throw new UserError("Cancelled sessions can't be reopened. Copy it instead.");
    await ctx.store.update("sessions", s.id, { status: input.status });
    return { ok: true, message: input.status === "published" ? "Published — players can book now." : "Moved back to draft." };
  }),

  duplicateSession: action(z.object({ session_id: id, days: int(0, 365, "Days").default(7) }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const shift = (iso: string) => zonedToUtc(addDays(dateKey(iso), input.days), timeKey(iso)).toISOString();
    const copy: Session = { ...s, id: uid(), starts_at: shift(s.starts_at), ends_at: shift(s.ends_at), status: "draft", created_at: nowIso() };
    await ctx.store.insert("sessions", copy);
    return { ok: true, message: "Draft copy created.", redirect: `/admin/sessions/${copy.id}` };
  }),

  deleteSession: action(z.object({ session_id: id }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const bookings = await ctx.store.list("bookings", { eq: { session_id: s.id } });
    if (bookings.length) throw new UserError("This session has bookings — cancel it instead.");
    await ctx.store.remove("sessions", s.id);
    return { ok: true, message: "Session deleted.", redirect: "/admin" };
  }),

  adminAddBooking: action(z.object({ session_id: id, user_id: id, mode: z.enum(["auto", "confirmed", "waitlisted"]).default("auto") }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const user = await must(ctx.store.get("profiles", input.user_id), "Player");
    const b = await placeBooking(ctx, s, user, input.mode === "auto" ? undefined : input.mode);
    return { ok: true, message: `${user.full_name} added (${b.status}).` };
  }),

  promoteBooking: action(z.object({ booking_id: id }), async (ctx, input) => {
    admin(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    if (b.status !== "waitlisted") throw new UserError("Only waitlisted players can be moved in.");
    await ctx.store.exclusive(`session:${b.session_id}`, async () => {
      await ctx.store.update("bookings", b.id, { status: "confirmed", waitlist_position: null, updated_at: nowIso() });
      await reindexWaitlist(ctx, b.session_id);
    });
    return { ok: true, message: "Moved into the session." };
  }),

  // ── Admin: members ──
  adminCreateMember: action(z.object({ full_name: req("Name", 120), email: text(200), phone: text(40) }), async (ctx, input) => {
    admin(ctx);
    const contact = cleanContact(input);
    if (!contact.email && !contact.phone) throw new UserError("Add an email or phone number.");
    const all = await ctx.store.list("profiles");
    if (all.some((p) => (contact.email && p.email === contact.email) || (contact.phone && p.phone === contact.phone))) {
      throw new UserError("A player with that email or phone already exists.");
    }
    const p: Profile = {
      id: uid(),
      email: contact.email,
      phone: contact.phone,
      full_name: input.full_name,
      role: "member",
      emergency_contact: "",
      status: "active",
      onboarded: false,
      created_at: nowIso(),
    };
    await ctx.store.insert("profiles", p);
    return { ok: true, message: `${p.full_name} added. They can sign in with the same email to claim the account.`, redirect: `/admin/members/${p.id}` };
  }),

  adminUpdateMember: action(
    z.object({ user_id: id, ...profileFields, emergency_contact: text(200), role: z.enum(["member", "coach", "admin"]), status: z.enum(["active", "inactive"]) }),
    async (ctx, input) => {
      const a = admin(ctx);
      const p = await must(ctx.store.get("profiles", input.user_id), "Player");
      if (p.id === a.id && input.role !== "admin") throw new UserError("You can't remove your own admin access.");
      if (p.id === a.id && input.status !== "active") throw new UserError("You can't make your own account inactive.");
      const contact = cleanContact(input);
      if (!contact.email && !contact.phone) throw new UserError("Add an email or phone number.");
      const all = await ctx.store.list("profiles");
      if (all.some((o) => o.id !== p.id && ((contact.email && o.email === contact.email) || (contact.phone && o.phone === contact.phone)))) {
        throw new UserError("Someone else already has that email or phone.");
      }
      await ctx.store.update("profiles", p.id, {
        full_name: input.full_name,
        email: contact.email,
        phone: contact.phone,
        emergency_contact: input.emergency_contact,
        role: input.role,
        status: input.status,
      });
      return { ok: true, message: "Member updated." };
    },
  ),

  adminRemoveMember: action(z.object({ user_id: id }), async (ctx, input) => {
    const a = admin(ctx);
    if (input.user_id === a.id) throw new UserError("You can't remove your own account.");
    const p = await must(ctx.store.get("profiles", input.user_id), "Player");
    if (ctx.store.rpc) {
      // The database function also deletes the login, which the browser can't reach.
      await ctx.store.rpc("admin_remove_member", { p_user_id: p.id });
    } else {
      const bookings = await ctx.store.list("bookings", { eq: { user_id: p.id } });
      for (const b of bookings.filter(isActive)) {
        const s = await ctx.store.get("sessions", b.session_id);
        if (s && new Date(s.starts_at) > ctx.now) await cancelAndPromote(ctx, b, s, "Member removed", false);
      }
      for (const b of bookings) await ctx.store.remove("bookings", b.id);
      for (const l of await ctx.store.list("lessons", { eq: { coach_id: p.id } })) await ctx.store.remove("lessons", l.id);
      for (const c of await ctx.store.list("clients", { eq: { coach_id: p.id } })) await ctx.store.remove("clients", c.id);
      for (const s of await ctx.store.list("sessions", { contains: { field: "coach_ids", value: p.id } })) {
        await ctx.store.update("sessions", s.id, { coach_ids: s.coach_ids.filter((c) => c !== p.id) });
      }
      await ctx.store.remove("profiles", p.id);
    }
    return { ok: true, message: `${p.full_name} removed.`, redirect: "/admin/members" };
  }),

  // ── Admin: settings ──
  saveCommissionRules: action(z.record(z.unknown()), async (ctx, raw) => {
    admin(ctx);
    // The form sends rows as place_0, percent_0, per_hour_0, per_lesson_0, … Rows without a place are dropped.
    const rows = z
      .array(z.object({ id: text(80), place: text(80), percent: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number({ invalid_type_error: "Commission % must be a number" }).min(0, "Commission % can't be negative").max(100, "Commission % must be at most 100")), per_hour: dollars, per_lesson: dollars }))
      .parse(Array.from({ length: COMMISSION_ROWS }, (_, i) => ({ id: raw[`id_${i}`], place: raw[`place_${i}`], percent: raw[`percent_${i}`], per_hour: raw[`per_hour_${i}`], per_lesson: raw[`per_lesson_${i}`] })))
      .filter((r) => r.place);
    const existing = await ctx.store.list("commission_rules");
    for (const r of existing) if (!rows.some((x) => x.id === r.id)) await ctx.store.remove("commission_rules", r.id);
    for (const r of rows) {
      const fields = { place: r.place, percent: Math.round(r.percent * 100) / 100, per_hour_cents: r.per_hour ?? 0, per_lesson_cents: r.per_lesson ?? 0 };
      if (existing.some((x) => x.id === r.id)) await ctx.store.update("commission_rules", r.id, fields);
      else await ctx.store.insert("commission_rules", { id: uid(), created_at: nowIso(), ...fields } satisfies CommissionRule);
    }
    return { ok: true, message: "Commission saved. It applies to lessons saved from now on, and to earlier ones at places that had none." };
  }),

  updateSettings: action(
    z.object({
      brand_name: req("Business name", 80),
      logo_mark: req("Logo letters", 4),
      color_primary: color,
      color_accent: color,
      color_background: color,
      color_ink: color,
      color_sage: color,
      community_url: text(300),
      default_location: text(200),
      cancellation_window_hours: int(0, 168, "Cancellation window"),
      cancellation_policy: text(1000),
      club_disclaimer: text(1000),
      default_group_capacity: int(1, 200, "Group Session capacity"),
      default_group_price: dollars,
      default_group_duration_min: int(15, 600, "Group Session duration"),
      default_pa_capacity: int(1, 200, "Performance Accelerator capacity"),
      default_pa_price: dollars,
      default_pa_duration_min: int(15, 600, "Performance Accelerator duration"),
    }),
    async (ctx, input) => {
      admin(ctx);
      const { default_group_price, default_pa_price, ...rest } = input;
      const patch = { ...rest, default_group_price_cents: default_group_price, default_pa_price_cents: default_pa_price, updated_at: nowIso() };
      const existing = await ctx.store.get("settings", "default");
      if (existing) await ctx.store.update("settings", "default", patch);
      else await ctx.store.insert("settings", { ...DEFAULT_SETTINGS, ...patch });
      return { ok: true, message: "Settings saved." };
    },
  ),
};

export type ActionName = keyof typeof actions;

/** Actions that can change what belongs on a coach's Google Calendar. */
export const CALENDAR_ACTIONS = new Set(["saveLesson", "deleteLesson", "saveClient", "saveSession", "setSessionStatus", "deleteSession", "adminRemoveMember"]);

export async function runAction(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<ActionResult> {
  const handler = actions[name];
  if (!handler) return { ok: false, error: "Unknown action." };
  try {
    return await handler(ctx, input ?? {});
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    if (e && typeof e === "object" && "message" in e && typeof (e as Error).message === "string" && /already|full|not open/i.test((e as Error).message)) {
      return { ok: false, error: (e as Error).message };
    }
    console.error(`[action:${name}]`, e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
