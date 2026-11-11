import type { Booking, Client, DB, Feedback, Lesson, Profile, Session, SessionType, Settings } from "./types";
import { addDays, dateKey, startOfWeek, zonedToUtc } from "./time";

const BALBOA = "Balboa Tennis Club, San Diego";

export const DEFAULT_SETTINGS: Settings = {
  id: "default",
  brand_name: "El Patio Tennis",
  logo_mark: "EP",
  color_primary: "#1F3A2E",
  color_accent: "#C9DC4B",
  color_background: "#F7F4EC",
  color_ink: "#1E2420",
  color_sage: "#DCE3D3",
  community_url: "",
  default_location: BALBOA,
  timezone: "America/Los_Angeles",
  currency: "USD",
  cancellation_window_hours: 24,
  cancellation_policy:
    "Less than 24 hours before a session you can't cancel, but you can offer your spot. If someone takes it, you won't be charged. If nobody does, you pay as normal.",
  booking_horizon_days: 28,
  club_disclaimer:
    "El Patio Tennis is an independent coaching business run by coach Leo Bakiri and co-run by coach Kaan Ayman. It is not affiliated with or operated by Balboa Tennis Club, and booking a lesson here does not reserve club courts.",
  default_group_capacity: 6,
  default_group_price_cents: 4000,
  default_group_duration_min: 90,
  default_pa_capacity: 8,
  default_pa_price_cents: 4000,
  default_pa_duration_min: 60,
  updated_at: new Date(0).toISOString(),
};

export const DEMO_IDS = {
  leo: "00000000-0000-4000-8000-000000000001",
  kaan: "00000000-0000-4000-8000-000000000002",
  sam: "00000000-0000-4000-8000-000000000003",
  maya: "00000000-0000-4000-8000-000000000004",
};

function profile(p: Partial<Profile> & Pick<Profile, "id" | "full_name">): Profile {
  return {
    email: null,
    phone: null,
    role: "member",
    emergency_contact: "",
    status: "active",
    onboarded: true,
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    ...p,
  };
}

/** Date-relative demo data so every screen has something real to show. */
export function demoSeed(now = new Date()): DB {
  const created = new Date(now.getTime() - 120 * 86400000).toISOString();
  const monday = startOfWeek(dateKey(now));

  const profiles: Profile[] = [
    profile({ id: DEMO_IDS.leo, full_name: "Leo Bakiri", email: "leo@leobakiritennis.com", role: "admin" }),
    profile({ id: DEMO_IDS.kaan, full_name: "Kaan Ayman", email: "kaan@example.com", role: "admin" }),
    profile({ id: DEMO_IDS.maya, full_name: "Maya Chen", email: "maya@example.com", role: "coach" }),
    profile({ id: DEMO_IDS.sam, full_name: "Sam Rivera", email: "sam@example.com", phone: "+16195550101" }),
  ];
  ["Priya Patel", "Jordan Lee", "Ava Thompson", "Marcus Johnson", "Elena Rossi", "Noah Kim", "Sofia Garcia", "Ethan Brooks", "Lily Nguyen", "Diego Alvarez", "Hannah Wright", "Omar Haddad"].forEach((name, i) => {
    profiles.push(
      profile({
        id: `00000000-0000-4000-8000-0000000010${String(i + 10).padStart(2, "0")}`,
        full_name: name,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        phone: `+1619555${String(1100 + i).padStart(4, "0")}`,
        created_at: new Date(now.getTime() - (100 - i * 7) * 86400000).toISOString(),
      }),
    );
  });
  const members = profiles.filter((p) => p.role === "member");

  const sessions: Session[] = [];
  const bookings: Booking[] = [];
  const lessons: Lesson[] = [];
  let n = 0;
  const sid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
  let bn = 0;
  const bid = () => `00000000-0000-4000-a000-${String(++bn).padStart(12, "0")}`;
  let ln = 0;
  const lid = () => `00000000-0000-4000-b000-${String(++ln).padStart(12, "0")}`;

  const mk = (session_type: SessionType, day: string, time: string, extra: Partial<Session> = {}): Session => {
    const pa = session_type === "performance_accelerator";
    const start = zonedToUtc(day, time);
    const s: Session = {
      id: sid(),
      session_type,
      title: "",
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + (pa ? DEFAULT_SETTINGS.default_pa_duration_min : DEFAULT_SETTINGS.default_group_duration_min) * 60000).toISOString(),
      coach_ids: [DEMO_IDS.leo],
      capacity: pa ? DEFAULT_SETTINGS.default_pa_capacity : DEFAULT_SETTINGS.default_group_capacity,
      price_cents: 4000,
      location: BALBOA,
      court: null,
      status: "published",
      description: "",
      internal_notes: "",
      created_at: created,
      ...extra,
    };
    sessions.push(s);
    return s;
  };

  const book = (s: Session, user: Profile, extra: Partial<Booking> = {}) => {
    const past = new Date(s.starts_at) < now;
    bookings.push({
      id: bid(),
      session_id: s.id,
      user_id: user.id,
      status: "confirmed",
      seats: 1,
      waitlist_position: null,
      attended: past ? bn % 7 !== 0 : null,
      late_cancel: false,
      cancel_reason: "",
      created_at: new Date(new Date(s.starts_at).getTime() - 5 * 86400000).toISOString(),
      updated_at: created,
      cancelled_at: null,
      spot_offered_at: null,
      ...extra,
    });
  };

  const lesson = (coach_id: string, kind: Lesson["kind"], client_names: string[], day: string, time: string, price: number, notes = "", location = BALBOA) => {
    const start = zonedToUtc(day, time);
    const end = new Date(start.getTime() + 3600000);
    // Older demo lessons are paid, except one so "Owed to you" has something in it.
    const paid = end < now && !(kind === "semi_private" && start.getTime() > now.getTime() - 9 * 86400000);
    lessons.push({ id: lid(), coach_id, kind, client_names, starts_at: start.toISOString(), ends_at: end.toISOString(), location, court: null, price_cents: price, commission_cents: null, paid_at: paid ? end.toISOString() : null, notes, created_at: created, updated_at: created });
  };

  // Three weeks: last week (history), this week, next week.
  for (const w of [-7, 0, 7]) {
    const mon = addDays(monday, w);
    const tue = addDays(mon, 1), wed = addDays(mon, 2), thu = addDays(mon, 3), fri = addDays(mon, 4), sat = addDays(mon, 5), sun = addDays(mon, 6);
    const g1 = mk("group", mon, "17:00");
    const g2 = mk("group", tue, "17:00", { coach_ids: [DEMO_IDS.maya] });
    const a1 = mk("performance_accelerator", tue, "20:00", { title: "Groundstrokes + Movement", description: "Heavy crosscourt patterns and recovery footwork." });
    const a2 = mk("performance_accelerator", thu, "18:00", { title: "Approach + Volley", coach_ids: [DEMO_IDS.maya] });
    const g3 = mk("group", fri, "15:00");
    const g4 = mk("group", sun, "18:30", { coach_ids: [DEMO_IDS.leo, DEMO_IDS.kaan], capacity: 12, price_cents: 2500, description: "Sunset doubles: two coaches, rotating points and a short drill block to start." });

    const pick = (offset: number, count: number) => Array.from({ length: count }, (_, i) => members[(offset + i) % members.length]);
    pick(0, 6).forEach((m) => book(g1, m)); // full
    pick(6, 2).forEach((m, i) => book(g1, m, { status: "waitlisted", waitlist_position: i + 1 }));
    pick(3, 4).forEach((m) => book(g2, m));
    pick(1, 6).forEach((m) => book(a1, m));
    pick(4, 3).forEach((m) => book(a2, m));
    pick(5, 5).forEach((m) => book(g3, m));
    pick(2, 9).forEach((m) => book(g4, m));

    lesson(DEMO_IDS.leo, "private", ["Rachel Green"], wed, "08:00", 10000, "Second serve. Bring the speed gun.");
    lesson(DEMO_IDS.leo, "semi_private", ["Tom Baker", "Chris Baker"], sat, "10:00", 11000, "Doubles patterns.");
    lesson(DEMO_IDS.maya, "private", ["Amir Sadeghi"], thu, "07:30", 9000);
    lesson(DEMO_IDS.leo, "private", ["Sofia Marquez"], fri, "07:00", 9000, "", "Morley Field");
  }

  // Older community sessions, so Sam's My Game page has a history, a streak and coach feedback.
  const feedback: Feedback[] = [];
  const note = (s: Session, user: Profile, skills: Feedback["skills"], tip = "") =>
    feedback.push({ id: `00000000-0000-4000-d000-${String(feedback.length + 1).padStart(12, "0")}`, session_id: s.id, user_id: user.id, coach_id: s.coach_ids[0], skills, tip, created_at: s.ends_at, updated_at: s.ends_at });
  const sam = members[0];
  for (let w = 2; w <= 9; w++) {
    const pa = w % 3 === 0;
    const s = mk(pa ? "performance_accelerator" : "group", addDays(addDays(monday, -7 * w), 2), w % 4 === 0 ? "07:30" : "18:00", pa ? { title: "Serve + Return" } : {});
    if (w !== 6) book(s, sam, { attended: true });
    for (let i = 1; i <= 4; i++) book(s, members[1 + ((w + i) % (members.length - 1))], { attended: true }); // never Sam twice
    if (w === 3) note(s, sam, ["serve"]);
    if (w === 5) note(s, sam, ["forehand", "movement"]);
    if (w === 8) note(s, sam, ["forehand"]);
  }
  const lastMonday = sessions.find((s) => s.session_type === "group" && dateKey(s.starts_at) === addDays(monday, -7));
  if (lastMonday) note(lastMonday, sam, ["backhand"], "Split step as they hit the ball, not after it bounces.");

  // Earlier weeks of lessons, so the month and year earnings views have history.
  const regulars = ["Rachel Green", "Amir Sadeghi", "Sofia Marquez", "Ben Carter", "Lucia Romero"];
  for (let w = 2; w <= 12; w++) {
    const mon = addDays(monday, -7 * w);
    lesson(DEMO_IDS.leo, "private", [regulars[w % regulars.length]], addDays(mon, 2), "08:00", 10000);
    lesson(DEMO_IDS.leo, "private", [regulars[(w + 2) % regulars.length]], addDays(mon, 3), "07:00", 9000, "", w % 3 ? BALBOA : "Morley Field");
    if (w % 2) lesson(DEMO_IDS.leo, "semi_private", ["Tom Baker", "Chris Baker"], addDays(mon, 5), "10:00", 11000);
  }

  // A client card for everyone on a lesson, a few filled in the way a coach would.
  const details: Record<string, Partial<Client>> = {
    "Rachel Green": { phone: "+16195550142", email: "rachel@example.com", level: "3.5", goals: "A second serve she can trust in league matches.", notes: "Left knee: keep the first 10 minutes light." },
    "Tom Baker": { phone: "+16195550177", level: "3.0", goals: "Doubles with his son Chris: poaching and serve + volley." },
    "Sofia Marquez": { email: "sofia.m@example.com", level: "Beginner", goals: "Rally from the baseline by spring." },
  };
  const clients: Client[] = [];
  for (const l of lessons) {
    for (const name of l.client_names) {
      if (clients.some((c) => c.coach_id === l.coach_id && c.full_name === name)) continue;
      clients.push({ id: `00000000-0000-4000-c000-${String(clients.length + 1).padStart(12, "0")}`, coach_id: l.coach_id, full_name: name, phone: null, email: null, level: "", goals: "", notes: "", created_at: created, updated_at: created, ...details[name] });
    }
  }

  // A draft for the admin views.
  mk("performance_accelerator", addDays(monday, 9), "19:00", { title: "Return of Serve", status: "draft" });

  return {
    settings: [{ ...DEFAULT_SETTINGS, updated_at: created }],
    profiles,
    sessions,
    bookings,
    lessons,
    coach_calendars: [],
    // A sample rate so the demo shows commission at work; the live site starts with none.
    commission_rules: [{ id: "demo-rule-balboa", place: "Balboa", percent: 20, per_hour_cents: 0, per_lesson_cents: 0, created_at: created }],
    clients,
    feedback,
    calendar_feeds: [],
  };
}

/** What a CourtReserve calendar looks like, for the demo: the live site fetches the player's real one. */
export function demoClubFeed(now: Date): string {
  const today = dateKey(now);
  const stamp = (day: string, time: string) => zonedToUtc(day, time).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const ev = (n: number, title: string, day: string, from: string, to: string) =>
    ["BEGIN:VEVENT", `UID:demo-club-${n}`, `SUMMARY:${title}`, `DTSTART:${stamp(day, from)}`, `DTEND:${stamp(day, to)}`, "LOCATION:Balboa Tennis Club", "END:VEVENT"].join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ev(1, "3.5 Drill Clinic", addDays(today, 1), "18:00", "19:30"),
    ev(2, "Private Lesson", addDays(today, 3), "08:00", "09:00"),
    ev(3, "Cardio Tennis", addDays(today, 6), "09:00", "10:00"),
    "END:VCALENDAR",
  ].join("\r\n");
}
