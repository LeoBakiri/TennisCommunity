// All state-changing operations. Every action validates its input with Zod
// and checks the actor's permissions before touching the store.
import { z, ZodError } from "zod";
import type {
  ActionResult,
  Actor,
  Booking,
  BookingStatus,
  LessonRequest,
  Profile,
  Program,
  ScheduleTemplate,
  Session,
  Settings,
} from "./types";
import type { Store } from "./store";
import { addDays, dateKey, fmtDateTime, startOfWeek, timeKey, weekdayOf, zonedToUtc } from "./time";
import { fmtMoney, isEmail, normalizePhone, nowIso, slugify, uid } from "./util";
import { DEFAULT_SETTINGS } from "./seed";

export class UserError extends Error {}

export interface OutgoingMessage {
  to: Profile;
  subject: string;
  body: string;
  /** Short version for SMS. */
  sms?: string;
}

export interface Ctx {
  store: Store;
  actor: Actor;
  now: Date;
  notify: (msg: OutgoingMessage) => Promise<void>;
}

// ───────────────────────── helpers ─────────────────────────

const ACTIVE: BookingStatus[] = ["confirmed", "pending", "waitlisted"];
export const isActive = (b: Booking) => ACTIVE.includes(b.status);
export const holdsSeat = (b: Booking) => b.status === "confirmed" || b.status === "pending";
export const seatsUsed = (bs: Booking[]) => bs.filter(holdsSeat).reduce((n, b) => n + (b.seats || 1), 0);

export const isStaff = (p: Profile | null | undefined) => !!p && (p.role === "coach" || p.role === "admin");
export const isAdmin = (p: Profile | null | undefined) => !!p && p.role === "admin";
export const coachesSession = (p: Profile | null | undefined, s: Session) =>
  !!p && (p.role === "admin" || (p.role === "coach" && s.coach_ids.includes(p.id)));

export function priceFor(s: Pick<Session, "price_cents" | "pricing" | "capacity">, seats: number): number {
  if (s.price_cents === null) return 0;
  if (s.pricing === "per_session") return Math.round((s.price_cents * seats) / Math.max(1, s.capacity));
  return s.price_cents * seats;
}

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
  return (await store.get("settings", "default")) ?? DEFAULT_SETTINGS;
}

async function must<T>(p: Promise<T | null>, what: string): Promise<T> {
  const v = await p;
  if (!v) throw new UserError(`${what} not found.`);
  return v;
}

async function programOf(ctx: Ctx, s: Session) {
  return must(ctx.store.get("programs", s.program_id), "Program");
}

export function sessionTitle(s: Session, p?: Program | null) {
  return s.title || p?.name || "Session";
}

async function notifyUser(ctx: Ctx, userId: string, subject: string, body: string, sms?: string) {
  const u = await ctx.store.get("profiles", userId);
  if (u) await ctx.notify({ to: u, subject, body, sms }).catch(() => undefined);
}

// Zod helpers that cope with FormData-shaped input.
const text = (max = 2000) => z.preprocess((v) => (v === undefined || v === null ? "" : String(v)), z.string().trim().max(max));
const req = (label: string, max = 200) =>
  z.preprocess((v) => (v === undefined || v === null ? "" : String(v)), z.string().trim().min(1, `${label} is required`).max(max));
const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const int = (min: number, max: number, label: string) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)), z.number({ invalid_type_error: `${label} must be a number`, required_error: `${label} is required` }).int().min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`));
const dollars = z.preprocess((v) => {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}, z.number().int().min(0, "Price can't be negative").nullable());
const ids = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string()));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time");
const id = z.string().min(1);

// ───────────────────────── booking engine ─────────────────────────

interface PlaceInput {
  session: Session;
  program: Program;
  user: Profile;
  seats: number;
  guest_name: string;
  guest_email: string;
  forceStatus?: BookingStatus;
}

/** Transaction-safe seat allocation. Uses a DB function on Supabase, a mutex in memory. */
export async function placeBooking(ctx: Ctx, input: PlaceInput): Promise<Booking> {
  const { session, program, user, seats } = input;

  if (ctx.store.rpc) {
    return ctx.store.rpc<Booking>("book_session", {
      p_session_id: session.id,
      p_user_id: user.id,
      p_seats: seats,
      p_guest_name: input.guest_name,
      p_guest_email: input.guest_email,
      p_requires_approval: program.requires_approval,
      p_force_status: input.forceStatus ?? null,
    });
  }

  return ctx.store.exclusive(`session:${session.id}`, async () => {
    const all = await ctx.store.list("bookings", { eq: { session_id: session.id } });
    const mine = all.find((b) => b.user_id === user.id && isActive(b));
    if (mine) {
      throw new UserError(
        mine.status === "waitlisted" ? "You're already on the waitlist for this session." : "You're already booked into this session.",
      );
    }
    let status: BookingStatus;
    let position: number | null = null;
    if (input.forceStatus) status = input.forceStatus;
    else if (seatsUsed(all) + seats <= session.capacity) status = program.requires_approval ? "pending" : "confirmed";
    else status = "waitlisted";
    if (status === "waitlisted") {
      position = Math.max(0, ...all.filter((b) => b.status === "waitlisted").map((b) => b.waitlist_position ?? 0)) + 1;
    }
    const ts = nowIso();
    const booking: Booking = {
      id: uid(),
      session_id: session.id,
      user_id: user.id,
      status,
      seats,
      waitlist_position: position,
      guest_name: input.guest_name,
      guest_email: input.guest_email,
      attended: null,
      late_cancel: false,
      cancel_reason: "",
      created_at: ts,
      updated_at: ts,
      cancelled_at: null,
    };
    await ctx.store.insert("bookings", booking);
    return booking;
  });
}

/** Cancel a booking and, if enabled, promote the next person from the waitlist. */
export async function cancelAndPromote(
  ctx: Ctx,
  booking: Booking,
  session: Session,
  reason: string,
  late: boolean,
): Promise<{ promoted: Booking[] }> {
  const settings = await getSettings(ctx.store);
  if (ctx.store.rpc) {
    // The database function cancels, promotes from the waitlist and queues notifications atomically.
    await ctx.store.rpc("cancel_booking", { p_booking_id: booking.id, p_reason: reason, p_late: late });
    return { promoted: [] };
  }
  return ctx.store.exclusive(`session:${session.id}`, async () => {
    const ts = nowIso();
    await ctx.store.update("bookings", booking.id, {
      status: "cancelled",
      cancelled_at: ts,
      updated_at: ts,
      cancel_reason: reason,
      late_cancel: late,
      waitlist_position: null,
    });
    const promoted = settings.waitlist_auto_promote ? await promoteWaitlist(ctx, session) : [];
    await reindexWaitlist(ctx, session.id);
    return { promoted };
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
    const upd = await ctx.store.update("bookings", b.id, {
      status: "confirmed",
      waitlist_position: null,
      updated_at: nowIso(),
    });
    promoted.push(upd);
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

async function announcePromotions(ctx: Ctx, promoted: Booking[], session: Session) {
  const prog = await ctx.store.get("programs", session.program_id);
  for (const p of promoted) {
    await notifyUser(
      ctx,
      p.user_id,
      `You're in: ${sessionTitle(session, prog)}`,
      `Good news — a spot opened up and you've been moved from the waitlist into ${sessionTitle(session, prog)} on ${fmtDateTime(session.starts_at)}. If you can no longer make it, please cancel from your dashboard so the next player can join.`,
      `You're off the waitlist for ${sessionTitle(session, prog)} ${fmtDateTime(session.starts_at)}.`,
    );
  }
}

// ───────────────────────── actions ─────────────────────────

type Handler = (ctx: Ctx, input: Record<string, unknown>) => Promise<ActionResult>;

function action<S extends z.ZodTypeAny>(schema: S, fn: (ctx: Ctx, input: z.infer<S>) => Promise<ActionResult>): Handler {
  return async (ctx, raw) => fn(ctx, schema.parse(raw));
}

const profileFields = {
  full_name: req("Full name", 120),
  phone: text(40),
  email: text(200),
  skill_level: text(60),
  ntrp: text(10),
  goals: text(1000),
  dominant_hand: text(20),
  emergency_contact: text(200),
  notify_email: bool,
  notify_sms: bool,
};

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

const sessionFields = {
  program_id: id,
  title: text(120),
  date,
  time,
  duration_min: int(15, 600, "Duration"),
  capacity: int(1, 200, "Capacity"),
  price: dollars,
  pricing: z.enum(["per_participant", "per_session"]),
  location: text(200),
  coach_ids: ids,
  status: z.enum(["draft", "published"]).default("draft"),
  visibility: z.enum(["public", "private"]).default("public"),
  description: text(2000),
  internal_notes: text(2000),
  skill_level: text(60),
};

export const actions: Record<string, Handler> = {
  // ── Member: profile ──
  completeOnboarding: action(z.object(profileFields), async (ctx, input) => {
    const a = ctx.actor;
    if (!a.auth_id) throw new UserError("Please sign in first.");
    const contact = cleanContact(input);
    if (!contact.email && !contact.phone) throw new UserError("Add an email or phone number so we can confirm bookings.");
    const existing = a.user ?? (await ctx.store.get("profiles", a.auth_id));
    const base = {
      full_name: input.full_name,
      email: contact.email,
      phone: contact.phone,
      skill_level: input.skill_level || "Intermediate",
      ntrp: input.ntrp,
      goals: input.goals,
      dominant_hand: input.dominant_hand || "Right",
      emergency_contact: input.emergency_contact,
      notify_email: input.notify_email,
      notify_sms: input.notify_sms,
      onboarded: true,
    };
    if (existing) await ctx.store.update("profiles", existing.id, base);
    else
      await ctx.store.insert("profiles", {
        id: a.auth_id,
        role: "member",
        bio: "",
        tags: ["New"],
        status: "active",
        created_at: nowIso(),
        ...base,
      });
    return { ok: true, message: "Welcome to the community!", redirect: "/app" };
  }),

  updateMyProfile: action(z.object(profileFields), async (ctx, input) => {
    const u = me(ctx);
    const contact = cleanContact(input);
    await ctx.store.update("profiles", u.id, {
      full_name: input.full_name,
      email: contact.email ?? u.email,
      phone: contact.phone,
      skill_level: input.skill_level,
      ntrp: input.ntrp,
      goals: input.goals,
      dominant_hand: input.dominant_hand,
      emergency_contact: input.emergency_contact,
      notify_email: input.notify_email,
      notify_sms: input.notify_sms,
    });
    return { ok: true, message: "Profile saved." };
  }),

  // ── Member: booking ──
  bookSession: action(
    z.object({ session_id: id, guest_name: text(120), guest_email: text(200) }),
    async (ctx, input) => {
      const u = me(ctx);
      const settings = await getSettings(ctx.store);
      const session = await must(ctx.store.get("sessions", input.session_id), "Session");
      if (session.status !== "published") throw new UserError("This session isn't open for booking.");
      if (new Date(session.starts_at) <= ctx.now) throw new UserError("This session has already started.");
      const program = await programOf(ctx, session);
      if (input.guest_email && !isEmail(input.guest_email)) throw new UserError("Partner email looks invalid.");
      const seats = program.kind === "semi_private" && input.guest_name ? 2 : 1;
      const b = await placeBooking(ctx, {
        session,
        program,
        user: u,
        seats,
        guest_name: input.guest_name,
        guest_email: input.guest_email.toLowerCase(),
      });
      const title = sessionTitle(session, program);
      const when = fmtDateTime(session.starts_at);
      if (b.status === "waitlisted") {
        await ctx.notify({ to: u, subject: `Waitlist: ${title}`, body: `You're #${b.waitlist_position} on the waitlist for ${title} on ${when}. We'll let you know as soon as a spot opens.` });
        return { ok: true, message: `Session is full — you're #${b.waitlist_position} on the waitlist.` };
      }
      if (b.status === "pending") {
        await ctx.notify({ to: u, subject: `Request received: ${title}`, body: `Thanks! Your request for ${title} on ${when} is waiting for coach approval. We'll confirm shortly.` });
        await notifyStaff(ctx, `New booking awaiting approval`, `${u.full_name} requested ${title} on ${when}.`);
        return { ok: true, message: "Requested — the coach will confirm shortly." };
      }
      await ctx.notify({
        to: u,
        subject: `Confirmed: ${title}`,
        body: `You're booked for ${title} on ${when} at ${session.location}.${priceFor(session, b.seats) ? ` Price: ${fmtMoney(priceFor(session, b.seats))}, payable to your coach.` : ""}\n\n${settings.cancellation_policy}`,
        sms: `Booked: ${title} ${when}.`,
      });
      return { ok: true, message: "You're booked! A confirmation is on its way." };
    },
  ),

  cancelBooking: action(z.object({ booking_id: id, reason: text(300) }), async (ctx, input) => {
    const u = me(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    const session = await must(ctx.store.get("sessions", b.session_id), "Session");
    const staffCancel = isAdmin(u) || coachesSession(u, session);
    if (b.user_id !== u.id && !staffCancel) throw new UserError("You can only cancel your own bookings.");
    if (!isActive(b)) throw new UserError("This booking is already cancelled.");
    if (new Date(session.starts_at) <= ctx.now && !staffCancel) throw new UserError("This session has already started.");
    const settings = await getSettings(ctx.store);
    const hoursLeft = (new Date(session.starts_at).getTime() - ctx.now.getTime()) / 3600000;
    const late = !staffCancel && b.status !== "waitlisted" && hoursLeft < settings.cancellation_window_hours;
    const { promoted } = await cancelAndPromote(ctx, b, session, input.reason || (staffCancel && b.user_id !== u.id ? "Cancelled by coach" : "Cancelled by player"), late);
    await announcePromotions(ctx, promoted, session);
    const prog = await ctx.store.get("programs", session.program_id);
    if (b.user_id !== u.id) {
      await notifyUser(ctx, b.user_id, `Cancelled: ${sessionTitle(session, prog)}`, `Your booking for ${sessionTitle(session, prog)} on ${fmtDateTime(session.starts_at)} was cancelled by the coach.`);
    }
    return {
      ok: true,
      message: late
        ? `Cancelled. This was inside the ${settings.cancellation_window_hours}-hour window, so the late-cancellation policy may apply.`
        : b.status === "waitlisted"
          ? "You've left the waitlist."
          : "Booking cancelled.",
    };
  }),

  // ── Member: requests ──
  createRequest: action(
    z.object({
      program_id: id,
      preferred_date: date,
      preferred_time: time,
      alternatives: text(500),
      partner_name: text(120),
      partner_email: text(200),
      message: text(1000),
    }),
    async (ctx, input) => {
      const u = me(ctx);
      const program = await must(ctx.store.get("programs", input.program_id), "Program");
      if (!program.allow_requests || !program.active) throw new UserError("This program doesn't take lesson requests.");
      if (input.preferred_date < dateKey(ctx.now)) throw new UserError("Pick a date in the future.");
      if (program.kind === "semi_private" && !input.partner_name) throw new UserError("Add your partner's name for a semi-private lesson.");
      if (input.partner_email && !isEmail(input.partner_email)) throw new UserError("Partner email looks invalid.");
      const r: LessonRequest = {
        id: uid(),
        user_id: u.id,
        program_id: program.id,
        preferred_date: input.preferred_date,
        preferred_time: input.preferred_time,
        alternatives: input.alternatives,
        partner_name: input.partner_name,
        partner_email: input.partner_email.toLowerCase(),
        message: input.message,
        status: "pending",
        coach_id: null,
        session_id: null,
        admin_note: "",
        created_at: nowIso(),
      };
      await ctx.store.insert("lesson_requests", r);
      await notifyStaff(ctx, `New ${program.name} request`, `${u.full_name} requested a ${program.name} around ${input.preferred_date} ${input.preferred_time}.`);
      return { ok: true, message: "Request sent — you'll hear back soon.", redirect: "/app/bookings?tab=requests" };
    },
  ),

  withdrawRequest: action(z.object({ request_id: id }), async (ctx, input) => {
    const u = me(ctx);
    const r = await must(ctx.store.get("lesson_requests", input.request_id), "Request");
    if (r.user_id !== u.id) throw new UserError("Not your request.");
    if (r.status !== "pending") throw new UserError("This request has already been handled.");
    await ctx.store.update("lesson_requests", r.id, { status: "withdrawn" });
    return { ok: true, message: "Request withdrawn." };
  }),

  // ── Messaging ──
  sendMessage: action(z.object({ body: req("Message", 4000), member_id: text(80) }), async (ctx, input) => {
    const u = me(ctx);
    const staffSender = isStaff(u) && input.member_id && input.member_id !== u.id;
    const memberId = staffSender ? input.member_id : u.id;
    if (staffSender) await must(ctx.store.get("profiles", memberId), "Player");
    await ctx.store.insert("messages", {
      id: uid(),
      member_id: memberId,
      sender_id: u.id,
      body: input.body,
      read_by_staff: !!staffSender,
      read_by_member: !staffSender,
      created_at: nowIso(),
    });
    if (staffSender) await notifyUser(ctx, memberId, `New message from ${u.full_name}`, input.body);
    else await notifyStaff(ctx, `Message from ${u.full_name}`, input.body);
    return { ok: true, message: "Message sent." };
  }),

  // ── Coach ──
  setAttendance: action(z.object({ booking_id: id, attended: z.enum(["yes", "no", "clear"]) }), async (ctx, input) => {
    const u = staff(ctx);
    const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
    const s = await must(ctx.store.get("sessions", b.session_id), "Session");
    if (!coachesSession(u, s)) throw new UserError("You can only take attendance for your own sessions.");
    await ctx.store.update("bookings", b.id, { attended: input.attended === "clear" ? null : input.attended === "yes", updated_at: nowIso() });
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

  addNote: action(
    z.object({ player_id: id, body: req("Note", 4000), visibility: z.enum(["staff", "shared"]), session_id: text(80) }),
    async (ctx, input) => {
      const u = staff(ctx);
      await must(ctx.store.get("profiles", input.player_id), "Player");
      if (!isAdmin(u) && !(await coachHasPlayer(ctx, u.id, input.player_id))) {
        throw new UserError("You can add notes for players in your sessions.");
      }
      await ctx.store.insert("coach_notes", {
        id: uid(),
        player_id: input.player_id,
        author_id: u.id,
        session_id: input.session_id || null,
        body: input.body,
        visibility: input.visibility,
        created_at: nowIso(),
      });
      if (input.visibility === "shared") await notifyUser(ctx, input.player_id, `New feedback from ${u.full_name}`, input.body);
      return { ok: true, message: input.visibility === "shared" ? "Feedback shared with the player." : "Private note saved." };
    },
  ),

  deleteNote: action(z.object({ note_id: id }), async (ctx, input) => {
    const u = staff(ctx);
    const n = await must(ctx.store.get("coach_notes", input.note_id), "Note");
    if (n.author_id !== u.id && !isAdmin(u)) throw new UserError("You can only delete your own notes.");
    await ctx.store.remove("coach_notes", n.id);
    return { ok: true, message: "Note deleted." };
  }),

  // ── Admin: sessions ──
  saveSession: action(z.object({ id: text(80), repeat_weeks: int(0, 26, "Repeat").default(0), notify: bool, ...sessionFields }), async (ctx, input) => {
    admin(ctx);
    const program = await must(ctx.store.get("programs", input.program_id), "Program");
    const start = zonedToUtc(input.date, input.time);
    const end = new Date(start.getTime() + input.duration_min * 60000);
    const coachIds = input.coach_ids.length ? input.coach_ids : [];
    const fields = {
      program_id: program.id,
      title: input.title,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      coach_ids: coachIds,
      capacity: input.capacity,
      price_cents: input.price,
      pricing: input.pricing,
      location: input.location || program.location,
      status: input.status,
      visibility: input.visibility,
      description: input.description,
      internal_notes: input.internal_notes,
      skill_level: input.skill_level,
    } satisfies Partial<Session>;

    if (input.id) {
      const prev = await must(ctx.store.get("sessions", input.id), "Session");
      if (prev.status === "cancelled") throw new UserError("This session was cancelled. Duplicate it instead.");
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
        await announcePromotions(ctx, promoted, s);
      }
      if (input.notify && (prev.starts_at !== s.starts_at || prev.location !== s.location)) {
        for (const b of bookings.filter(isActive)) {
          await notifyUser(ctx, b.user_id, `Updated: ${sessionTitle(s, program)}`, `Heads up — ${sessionTitle(s, program)} is now ${fmtDateTime(s.starts_at)} at ${s.location}.`);
        }
      }
      return { ok: true, message: promoted.length ? `Saved. ${promoted.length} player(s) moved off the waitlist.` : "Session saved." };
    }

    let first: Session | null = null;
    for (let w = 0; w <= input.repeat_weeks; w++) {
      const s: Session = {
        id: uid(),
        ...fields,
        starts_at: zonedToUtc(addDays(input.date, w * 7), input.time).toISOString(),
        ends_at: new Date(zonedToUtc(addDays(input.date, w * 7), input.time).getTime() + input.duration_min * 60000).toISOString(),
        template_id: null,
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
  }),

  setSessionStatus: action(z.object({ session_id: id, status: z.enum(["draft", "published", "cancelled"]), reason: text(300) }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const prog = await ctx.store.get("programs", s.program_id);
    if (input.status === "cancelled") {
      const active = (await ctx.store.list("bookings", { eq: { session_id: s.id } })).filter(isActive);
      for (const b of active) {
        await ctx.store.update("bookings", b.id, {
          status: "cancelled",
          cancelled_at: nowIso(),
          cancel_reason: input.reason || "Session cancelled by coach",
          waitlist_position: null,
        });
        await notifyUser(
          ctx,
          b.user_id,
          `Cancelled: ${sessionTitle(s, prog)}`,
          `Sorry — ${sessionTitle(s, prog)} on ${fmtDateTime(s.starts_at)} has been cancelled.${input.reason ? ` Reason: ${input.reason}.` : ""}`,
          `Cancelled: ${sessionTitle(s, prog)} ${fmtDateTime(s.starts_at)}.`,
        );
      }
      await ctx.store.update("sessions", s.id, { status: "cancelled" });
      return { ok: true, message: `Session cancelled and ${active.length} player(s) notified.` };
    }
    if (s.status === "cancelled") throw new UserError("Cancelled sessions can't be reopened. Duplicate it instead.");
    await ctx.store.update("sessions", s.id, { status: input.status });
    return { ok: true, message: input.status === "published" ? "Published — players can book now." : "Moved back to draft." };
  }),

  duplicateSession: action(z.object({ session_id: id, days: int(0, 365, "Days").default(7) }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const shift = (iso: string) => zonedToUtc(addDays(dateKey(iso), input.days), timeKey(iso)).toISOString();
    const copy: Session = { ...s, id: uid(), starts_at: shift(s.starts_at), ends_at: shift(s.ends_at), status: "draft", template_id: null, created_at: nowIso() };
    await ctx.store.insert("sessions", copy);
    return { ok: true, message: "Draft copy created.", redirect: `/admin/sessions/${copy.id}` };
  }),

  deleteSession: action(z.object({ session_id: id }), async (ctx, input) => {
    admin(ctx);
    const s = await must(ctx.store.get("sessions", input.session_id), "Session");
    const bookings = await ctx.store.list("bookings", { eq: { session_id: s.id } });
    if (bookings.length) throw new UserError("This session has bookings — cancel it instead so players are notified.");
    await ctx.store.remove("sessions", s.id);
    return { ok: true, message: "Session deleted.", redirect: "/admin/sessions" };
  }),

  adminAddBooking: action(
    z.object({ session_id: id, user_id: id, mode: z.enum(["auto", "confirmed", "waitlisted"]).default("auto"), guest_name: text(120) }),
    async (ctx, input) => {
      admin(ctx);
      const s = await must(ctx.store.get("sessions", input.session_id), "Session");
      const program = await programOf(ctx, s);
      const user = await must(ctx.store.get("profiles", input.user_id), "Player");
      const seats = program.kind === "semi_private" && input.guest_name ? 2 : 1;
      const b = await placeBooking(ctx, {
        session: s,
        program,
        user,
        seats,
        guest_name: input.guest_name,
        guest_email: "",
        forceStatus: input.mode === "auto" ? undefined : input.mode,
      });
      if (b.status === "confirmed") {
        await ctx.notify({ to: user, subject: `Booked: ${sessionTitle(s, program)}`, body: `Coach added you to ${sessionTitle(s, program)} on ${fmtDateTime(s.starts_at)}.` });
      }
      return { ok: true, message: `${user.full_name} added (${b.status}).` };
    },
  ),

  adminBookingOp: action(
    z.object({ booking_id: id, op: z.enum(["approve", "decline", "promote"]) }),
    async (ctx, input) => {
      admin(ctx);
      const b = await must(ctx.store.get("bookings", input.booking_id), "Booking");
      const s = await must(ctx.store.get("sessions", b.session_id), "Session");
      const prog = await ctx.store.get("programs", s.program_id);
      const title = sessionTitle(s, prog);
      switch (input.op) {
        case "approve": {
          if (b.status !== "pending") throw new UserError("Only pending bookings can be approved.");
          await ctx.store.update("bookings", b.id, { status: "confirmed", updated_at: nowIso() });
          await notifyUser(ctx, b.user_id, `Confirmed: ${title}`, `Your ${title} on ${fmtDateTime(s.starts_at)} is confirmed. See you on court!`, `Confirmed: ${title} ${fmtDateTime(s.starts_at)}.`);
          return { ok: true, message: "Booking approved." };
        }
        case "decline": {
          if (b.status !== "pending") throw new UserError("Only pending bookings can be declined.");
          await ctx.store.update("bookings", b.id, { status: "declined", updated_at: nowIso() });
          await notifyUser(ctx, b.user_id, `Update on ${title}`, `Sorry, ${title} on ${fmtDateTime(s.starts_at)} isn't available. Reply in Messages and we'll find another time.`);
          const promoted = await ctx.store.exclusive(`session:${s.id}`, () => promoteWaitlist(ctx, s));
          await announcePromotions(ctx, promoted, s);
          return { ok: true, message: "Booking declined." };
        }
        case "promote": {
          if (b.status !== "waitlisted") throw new UserError("Only waitlisted players can be promoted.");
          await ctx.store.exclusive(`session:${s.id}`, async () => {
            await ctx.store.update("bookings", b.id, { status: "confirmed", waitlist_position: null });
            await reindexWaitlist(ctx, s.id);
          });
          await announcePromotions(ctx, [b], s);
          return { ok: true, message: "Moved into the session." };
        }
      }
    },
  ),

  // ── Admin: requests ──
  approveRequest: action(
    z.object({ request_id: id, date, time, duration_min: int(15, 300, "Duration"), coach_id: id, location: text(200), admin_note: text(500) }),
    async (ctx, input) => {
      admin(ctx);
      const r = await must(ctx.store.get("lesson_requests", input.request_id), "Request");
      if (r.status !== "pending") throw new UserError("This request has already been handled.");
      const program = await must(ctx.store.get("programs", r.program_id), "Program");
      const user = await must(ctx.store.get("profiles", r.user_id), "Player");
      const start = zonedToUtc(input.date, input.time);
      const s: Session = {
        id: uid(),
        program_id: program.id,
        title: `${program.name} · ${user.full_name}`,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + input.duration_min * 60000).toISOString(),
        coach_ids: [input.coach_id],
        capacity: program.capacity,
        price_cents: program.price_cents,
        pricing: program.pricing,
        location: input.location || program.location,
        status: "published",
        visibility: "private",
        description: r.message,
        internal_notes: input.admin_note,
        skill_level: user.skill_level,
        template_id: null,
        created_at: nowIso(),
      };
      await ctx.store.insert("sessions", s);
      const seats = program.kind === "semi_private" && r.partner_name ? Math.min(2, s.capacity) : 1;
      await placeBooking(ctx, { session: s, program, user, seats, guest_name: r.partner_name, guest_email: r.partner_email, forceStatus: "confirmed" });
      await ctx.store.update("lesson_requests", r.id, { status: "approved", session_id: s.id, coach_id: input.coach_id, admin_note: input.admin_note });
      await ctx.notify({
        to: user,
        subject: `Confirmed: ${program.name}`,
        body: `Your ${program.name} is confirmed for ${fmtDateTime(s.starts_at)} at ${s.location}.${input.admin_note ? `\n\nNote from the coach: ${input.admin_note}` : ""}`,
        sms: `Confirmed: ${program.name} ${fmtDateTime(s.starts_at)}.`,
      });
      return { ok: true, message: "Approved — lesson scheduled and player notified." };
    },
  ),

  declineRequest: action(z.object({ request_id: id, admin_note: text(500) }), async (ctx, input) => {
    admin(ctx);
    const r = await must(ctx.store.get("lesson_requests", input.request_id), "Request");
    if (r.status !== "pending") throw new UserError("This request has already been handled.");
    await ctx.store.update("lesson_requests", r.id, { status: "declined", admin_note: input.admin_note });
    await notifyUser(ctx, r.user_id, "About your lesson request", `Sorry, that time doesn't work.${input.admin_note ? ` ${input.admin_note}` : ""} Message us and we'll find another slot.`);
    return { ok: true, message: "Request declined and player notified." };
  }),

  // ── Admin: programs ──
  saveProgram: action(
    z.object({
      id: text(80),
      name: req("Name", 120),
      kind: z.enum(["private", "semi_private", "group", "event"]),
      summary: text(300),
      description: text(4000),
      duration_min: int(15, 600, "Duration"),
      capacity: int(1, 200, "Capacity"),
      price: dollars,
      pricing: z.enum(["per_participant", "per_session"]),
      requires_approval: bool,
      allow_requests: bool,
      skill_level: text(60),
      location: text(200),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color").default("#1F3A2E"),
      coaches_count: int(1, 20, "Coaches").default(1),
      active: bool,
      sort_order: int(0, 999, "Order").default(10),
    }),
    async (ctx, input) => {
      admin(ctx);
      const { price, id: pid, ...rest } = input;
      if (pid) {
        await must(ctx.store.get("programs", pid), "Program");
        await ctx.store.update("programs", pid, { ...rest, price_cents: price });
        return { ok: true, message: "Program saved." };
      }
      const all = await ctx.store.list("programs");
      let slug = slugify(input.name) || "program";
      if (all.some((p) => p.slug === slug)) slug = `${slug}-${all.length + 1}`;
      const p: Program = { id: uid(), slug, ...rest, price_cents: price, created_at: nowIso() };
      await ctx.store.insert("programs", p);
      return { ok: true, message: "Program created.", redirect: `/admin/programs/${p.id}` };
    },
  ),

  // ── Admin: templates ──
  saveTemplate: action(
    z.object({
      id: text(80),
      program_id: id,
      weekday: int(0, 6, "Day"),
      start_time: time,
      duration_min: int(15, 600, "Duration"),
      capacity: z.preprocess((v) => (v === "" ? null : v), int(1, 200, "Capacity").nullable()),
      coach_ids: ids,
      location: text(200),
      notes: text(300),
      published: bool,
    }),
    async (ctx, input) => {
      admin(ctx);
      await must(ctx.store.get("programs", input.program_id), "Program");
      const { id: tid, ...rest } = input;
      if (tid) {
        await ctx.store.update("schedule_templates", tid, rest);
        return { ok: true, message: "Recurring slot saved." };
      }
      const t: ScheduleTemplate = { id: uid(), ...rest, created_at: nowIso() };
      await ctx.store.insert("schedule_templates", t);
      return { ok: true, message: "Recurring slot added (unpublished until you publish it)." };
    },
  ),

  deleteTemplate: action(z.object({ template_id: id }), async (ctx, input) => {
    admin(ctx);
    await ctx.store.remove("schedule_templates", input.template_id);
    return { ok: true, message: "Recurring slot removed. Existing sessions were kept." };
  }),

  generateFromTemplates: action(z.object({ weeks: int(1, 12, "Weeks"), publish: bool, start: date.optional() }), async (ctx, input) => {
    admin(ctx);
    const templates = (await ctx.store.list("schedule_templates")).filter((t) => t.published);
    if (!templates.length) throw new UserError("Publish at least one recurring slot first.");
    const programs = await ctx.store.list("programs");
    const today = dateKey(ctx.now);
    const from = input.start && input.start > today ? input.start : today;
    const existing = await ctx.store.list("sessions", { gte: { field: "starts_at", value: zonedToUtc(from, "00:00").toISOString() } });
    let created = 0;
    let skipped = 0;
    for (let d = 0; d < input.weeks * 7; d++) {
      const day = addDays(from, d);
      for (const t of templates.filter((t) => t.weekday === weekdayOf(day))) {
        const prog = programs.find((p) => p.id === t.program_id);
        if (!prog) continue;
        const start = zonedToUtc(day, t.start_time);
        if (start <= ctx.now) continue;
        if (existing.some((s) => s.template_id === t.id && s.starts_at === start.toISOString())) {
          skipped++;
          continue;
        }
        await ctx.store.insert("sessions", {
          id: uid(),
          program_id: prog.id,
          title: t.notes || prog.name,
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + t.duration_min * 60000).toISOString(),
          coach_ids: t.coach_ids,
          capacity: t.capacity ?? prog.capacity,
          price_cents: prog.price_cents,
          pricing: prog.pricing,
          location: t.location || prog.location,
          status: input.publish ? "published" : "draft",
          visibility: "public",
          description: "",
          internal_notes: "",
          skill_level: prog.skill_level,
          template_id: t.id,
          created_at: nowIso(),
        });
        created++;
      }
    }
    return {
      ok: true,
      message: `${created} session(s) created as ${input.publish ? "published" : "drafts"}${skipped ? `, ${skipped} already existed` : ""}.`,
      redirect: `/admin/calendar?week=${startOfWeek(from)}`,
    };
  }),

  // ── Admin: members ──
  adminCreateMember: action(z.object({ full_name: req("Name", 120), email: text(200), phone: text(40), tags: text(300) }), async (ctx, input) => {
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
      skill_level: "Intermediate",
      ntrp: "",
      goals: "",
      dominant_hand: "Right",
      emergency_contact: "",
      bio: "",
      notify_email: true,
      notify_sms: false,
      tags: input.tags.split(",").map((t) => t.trim()).filter(Boolean),
      status: "active",
      onboarded: false,
      created_at: nowIso(),
    };
    await ctx.store.insert("profiles", p);
    return { ok: true, message: `${p.full_name} added. They can sign in with the same email or phone to claim the account.`, redirect: `/admin/members/${p.id}` };
  }),

  adminUpdateMember: action(
    z.object({ user_id: id, role: z.enum(["member", "coach", "admin"]), status: z.enum(["active", "inactive"]), tags: text(300), skill_level: text(60), ntrp: text(10), bio: text(1000) }),
    async (ctx, input) => {
      const a = admin(ctx);
      const p = await must(ctx.store.get("profiles", input.user_id), "Player");
      if (p.id === a.id && input.role !== "admin") throw new UserError("You can't remove your own admin access.");
      await ctx.store.update("profiles", p.id, {
        role: input.role,
        status: input.status,
        tags: input.tags.split(",").map((t) => t.trim()).filter(Boolean),
        skill_level: input.skill_level,
        ntrp: input.ntrp,
        bio: input.bio,
      });
      return { ok: true, message: "Member updated." };
    },
  ),

  // ── Admin: community ──
  createAnnouncement: action(z.object({ title: req("Title", 160), body: req("Message", 4000), pinned: bool, notify: bool }), async (ctx, input) => {
    const a = admin(ctx);
    await ctx.store.insert("announcements", { id: uid(), title: input.title, body: input.body, pinned: input.pinned, author_id: a.id, created_at: nowIso() });
    let sent = 0;
    if (input.notify) {
      for (const p of await ctx.store.list("profiles", { eq: { status: "active" } })) {
        if (p.id === a.id) continue;
        await ctx.notify({ to: p, subject: input.title, body: input.body }).catch(() => undefined);
        sent++;
      }
    }
    return { ok: true, message: input.notify ? `Posted and sent to ${sent} members.` : "Announcement posted." };
  }),

  updateAnnouncement: action(z.object({ announcement_id: id, op: z.enum(["pin", "unpin", "delete"]) }), async (ctx, input) => {
    admin(ctx);
    if (input.op === "delete") await ctx.store.remove("announcements", input.announcement_id);
    else await ctx.store.update("announcements", input.announcement_id, { pinned: input.op === "pin" });
    return { ok: true, message: input.op === "delete" ? "Announcement deleted." : "Updated." };
  }),

  updateSettings: action(
    z.object({
      brand_name: req("Business name", 80),
      tagline: text(160),
      logo_mark: req("Logo monogram", 4),
      color_primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color_accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color_background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color_ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color_sage: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      hero_headline: text(160),
      hero_subtext: text(500),
      coach_bio: text(2000),
      contact_email: text(200),
      contact_phone: text(40),
      community_url: text(300),
      default_location: text(200),
      cancellation_window_hours: int(0, 168, "Cancellation window"),
      cancellation_policy: text(1000),
      waitlist_auto_promote: bool,
      booking_horizon_days: int(1, 365, "Booking horizon"),
      club_disclaimer: text(1000),
    }),
    async (ctx, input) => {
      admin(ctx);
      const existing = await ctx.store.get("settings", "default");
      if (existing) await ctx.store.update("settings", "default", { ...input, updated_at: nowIso() });
      else await ctx.store.insert("settings", { ...DEFAULT_SETTINGS, ...input, updated_at: nowIso() });
      return { ok: true, message: "Settings saved." };
    },
  ),
};

export type ActionName = keyof typeof actions;

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

// ───────────────────────── internals ─────────────────────────

async function notifyStaff(ctx: Ctx, subject: string, body: string) {
  for (const p of await ctx.store.list("profiles", { eq: { role: "admin" } })) {
    await ctx.notify({ to: p, subject, body }).catch(() => undefined);
  }
}

export async function coachHasPlayer(ctx: { store: Store }, coachId: string, playerId: string): Promise<boolean> {
  const sessions = await ctx.store.list("sessions", { contains: { field: "coach_ids", value: coachId } });
  if (!sessions.length) return false;
  const bookings = await ctx.store.list("bookings", { eq: { user_id: playerId } });
  const sids = new Set(sessions.map((s) => s.id));
  return bookings.some((b) => sids.has(b.session_id) && b.status !== "declined");
}
