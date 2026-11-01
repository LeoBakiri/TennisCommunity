import type { Booking, DB, Profile, Program, ScheduleTemplate, Session, Settings } from "./types";
import { addDays, dateKey, startOfWeek, zonedToUtc } from "./time";

export const DEFAULT_SETTINGS: Settings = {
  id: "default",
  brand_name: "Leo Tennis Community",
  tagline: "Coaching & community in San Diego",
  logo_mark: "LT",
  color_primary: "#1F3A2E",
  color_accent: "#C9DC4B",
  color_background: "#F7F4EC",
  color_ink: "#1E2420",
  color_sage: "#DCE3D3",
  hero_headline: "Better tennis, built together.",
  hero_subtext:
    "Private lessons, small-group clinics and community sessions with coach Leo Bakiri — mostly at Balboa Tennis Club, San Diego.",
  coach_bio:
    "Leo Bakiri is an independent tennis coach in San Diego. His sessions blend clean technique, smart movement and point construction with a warm, community-first atmosphere — for players from first rally to competitive league play.",
  contact_email: "leocanbakiri@gmail.com",
  contact_phone: "+1 (619) 555-0142",
  community_url: "",
  default_location: "Balboa Tennis Club, San Diego",
  timezone: "America/Los_Angeles",
  currency: "USD",
  cancellation_window_hours: 24,
  cancellation_policy:
    "Please cancel at least 24 hours before your session so someone from the waitlist can take your spot. Late cancellations may still be charged by the coach.",
  waitlist_auto_promote: true,
  booking_horizon_days: 28,
  club_disclaimer:
    "Leo Tennis Community is an independent coaching business run by coach Leo Bakiri. It is not affiliated with or operated by Balboa Tennis Club, and booking a lesson here does not reserve club courts.",
  updated_at: new Date(0).toISOString(),
};

export const PROGRAM_SEEDS: Omit<Program, "created_at">[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    slug: "private-lessons",
    name: "Private Lesson",
    kind: "private",
    summary: "One-on-one coaching built entirely around your game.",
    description:
      "A focused hour with Leo on the parts of your game that matter most to you — technique, tactics, movement or match preparation. Book an open slot or request a time that works for you.",
    duration_min: 60,
    capacity: 1,
    price_cents: 10000,
    pricing: "per_session",
    requires_approval: false,
    allow_requests: true,
    skill_level: "All levels",
    location: "Balboa Tennis Club, San Diego",
    color: "#1F3A2E",
    coaches_count: 1,
    active: true,
    sort_order: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    slug: "semi-private-lessons",
    name: "Semi-Private Lesson",
    kind: "semi_private",
    summary: "Train with a partner — shared attention, shared cost.",
    description:
      "Two players, one coach. Great for doubles partners, friends at a similar level, or families. Bring a partner when you book, or request a time for both of you.",
    duration_min: 60,
    capacity: 2,
    price_cents: 11000,
    pricing: "per_session",
    requires_approval: true,
    allow_requests: true,
    skill_level: "All levels",
    location: "Balboa Tennis Club, San Diego",
    color: "#4F6B4A",
    coaches_count: 1,
    active: true,
    sort_order: 2,
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    slug: "group-clinics",
    name: "Group Clinic",
    kind: "group",
    summary: "90 minutes of drills, live-ball and play in a group of six.",
    description:
      "High-energy small-group clinics with progressive drills, live-ball patterns and situational play. Reserve your individual spot; if it's full, join the waitlist and you'll be moved in automatically when a spot opens.",
    duration_min: 90,
    capacity: 6,
    price_cents: 4000,
    pricing: "per_participant",
    requires_approval: false,
    allow_requests: false,
    skill_level: "3.0 – 4.0",
    location: "Balboa Tennis Club, San Diego",
    color: "#7A8F3A",
    coaches_count: 1,
    active: true,
    sort_order: 3,
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    slug: "performance-accelerator",
    name: "Performance Accelerator",
    kind: "group",
    summary: "Four players. Technique, movement, consistency, point construction.",
    description:
      "Small-group technical training for players who want measurable improvement. Each block focuses on one theme — from footwork patterns to serve +1 — with video-ready drills you can take into match play.",
    duration_min: 60,
    capacity: 4,
    price_cents: 4000,
    pricing: "per_participant",
    requires_approval: false,
    allow_requests: false,
    skill_level: "3.5+ recommended",
    location: "Balboa Tennis Club, San Diego",
    color: "#2F5D62",
    coaches_count: 1,
    active: true,
    sort_order: 4,
  },
  {
    id: "00000000-0000-4000-8000-000000000105",
    slug: "sunset-tennis",
    name: "Sunset Tennis",
    kind: "event",
    summary: "Sunday evening community tennis — drills, points and good company.",
    description:
      "Our weekly community gathering: structured warm-up drills, rotating point play and plenty of time to meet the rest of the community. Multiple coaches on court.",
    duration_min: 90,
    capacity: 12,
    price_cents: null,
    pricing: "per_participant",
    requires_approval: false,
    allow_requests: false,
    skill_level: "All levels",
    location: "Balboa Tennis Club, San Diego",
    color: "#B5672C",
    coaches_count: 2,
    active: true,
    sort_order: 5,
  },
];

const P = {
  private: PROGRAM_SEEDS[0].id,
  semi: PROGRAM_SEEDS[1].id,
  group: PROGRAM_SEEDS[2].id,
  accel: PROGRAM_SEEDS[3].id,
  sunset: PROGRAM_SEEDS[4].id,
};

export const DEMO_IDS = {
  leo: "00000000-0000-4000-8000-000000000001",
  maya: "00000000-0000-4000-8000-000000000002",
  sam: "00000000-0000-4000-8000-000000000003",
};

export const TEMPLATE_SEEDS: Omit<ScheduleTemplate, "created_at">[] = [
  { id: "00000000-0000-4000-8000-000000000201", program_id: P.group, weekday: 1, start_time: "17:00", duration_min: 90, capacity: 6, coach_ids: [DEMO_IDS.leo], location: "", published: false, notes: "Monday Group Clinic" },
  { id: "00000000-0000-4000-8000-000000000202", program_id: P.group, weekday: 2, start_time: "17:00", duration_min: 90, capacity: 6, coach_ids: [DEMO_IDS.leo], location: "", published: false, notes: "Tuesday Pop-Up Group Clinic" },
  { id: "00000000-0000-4000-8000-000000000203", program_id: P.group, weekday: 5, start_time: "15:00", duration_min: 90, capacity: 6, coach_ids: [DEMO_IDS.leo], location: "", published: false, notes: "Friday Group Clinic" },
  { id: "00000000-0000-4000-8000-000000000204", program_id: P.sunset, weekday: 0, start_time: "18:30", duration_min: 90, capacity: 12, coach_ids: [DEMO_IDS.leo, DEMO_IDS.maya], location: "", published: false, notes: "Sunset Tennis" },
];

function profile(p: Partial<Profile> & Pick<Profile, "id" | "full_name">): Profile {
  return {
    email: null,
    phone: null,
    role: "member",
    skill_level: "Intermediate",
    ntrp: "3.5",
    goals: "",
    dominant_hand: "Right",
    emergency_contact: "",
    bio: "",
    notify_email: true,
    notify_sms: false,
    tags: [],
    status: "active",
    onboarded: true,
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    ...p,
  };
}

/** Rich, date-relative demo data so every screen has something real to show. */
export function demoSeed(now = new Date()): DB {
  const created = new Date(now.getTime() - 120 * 86400000).toISOString();
  const today = dateKey(now);
  const monday = startOfWeek(today);

  const profiles: Profile[] = [
    profile({ id: DEMO_IDS.leo, full_name: "Leo Bakiri", email: "leo@leobakiritennis.com", role: "admin", ntrp: "5.5", skill_level: "Coach", bio: "Head coach. Technique, movement and point construction." }),
    profile({ id: DEMO_IDS.maya, full_name: "Maya Chen", email: "maya@example.com", role: "coach", ntrp: "5.0", skill_level: "Coach", bio: "Collaborating coach. Doubles strategy and net play." }),
    profile({ id: DEMO_IDS.sam, full_name: "Sam Rivera", email: "sam@example.com", phone: "+16195550101", ntrp: "3.5", goals: "Build a reliable second serve and get more comfortable at the net.", tags: ["Clinic regular"] }),
  ];
  const memberNames: [string, string, string, string[]][] = [
    ["Priya Patel", "4.0", "Advanced", ["League", "Clinic regular"]],
    ["Jordan Lee", "3.0", "Intermediate", ["New"]],
    ["Ava Thompson", "3.5", "Intermediate", ["Sunset"]],
    ["Marcus Johnson", "4.0", "Advanced", ["League"]],
    ["Elena Rossi", "2.5", "Beginner", ["New"]],
    ["Noah Kim", "3.5", "Intermediate", []],
    ["Sofia Garcia", "3.0", "Intermediate", ["Sunset"]],
    ["Ethan Brooks", "4.5", "Advanced", ["League"]],
    ["Lily Nguyen", "3.0", "Intermediate", []],
    ["Diego Alvarez", "3.5", "Intermediate", ["Clinic regular"]],
    ["Hannah Wright", "2.5", "Beginner", []],
    ["Omar Haddad", "4.0", "Advanced", []],
  ];
  memberNames.forEach(([name, ntrp, level, tags], i) => {
    profiles.push(
      profile({
        id: `00000000-0000-4000-8000-0000000010${String(i + 10).padStart(2, "0")}`,
        full_name: name,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        phone: `+1619555${String(1100 + i).padStart(4, "0")}`,
        ntrp,
        skill_level: level,
        tags,
        created_at: new Date(now.getTime() - (100 - i * 7) * 86400000).toISOString(),
      }),
    );
  });
  const members = profiles.filter((p) => p.role === "member");

  const programs: Program[] = PROGRAM_SEEDS.map((p) => ({ ...p, created_at: created }));
  const templates: ScheduleTemplate[] = TEMPLATE_SEEDS.map((t) => ({ ...t, created_at: created }));

  const sessions: Session[] = [];
  const bookings: Booking[] = [];
  let n = 0;
  const sid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
  let bn = 0;
  const bid = () => `00000000-0000-4000-a000-${String(++bn).padStart(12, "0")}`;

  const mk = (programId: string, day: string, time: string, extra: Partial<Session> = {}): Session => {
    const prog = programs.find((p) => p.id === programId)!;
    const start = zonedToUtc(day, time);
    const s: Session = {
      id: sid(),
      program_id: programId,
      title: "",
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + prog.duration_min * 60000).toISOString(),
      coach_ids: [DEMO_IDS.leo],
      capacity: prog.capacity,
      price_cents: prog.price_cents,
      pricing: prog.pricing,
      location: prog.location,
      status: "published",
      visibility: "public",
      description: "",
      internal_notes: "",
      skill_level: prog.skill_level,
      template_id: null,
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
      guest_name: "",
      guest_email: "",
      attended: past ? bn % 7 !== 0 : null,
      late_cancel: false,
      cancel_reason: "",
      created_at: new Date(new Date(s.starts_at).getTime() - 5 * 86400000).toISOString(),
      updated_at: created,
      cancelled_at: null,
      ...extra,
    });
  };

  // Three weeks: last week (history), this week, next week.
  for (const w of [-7, 0, 7]) {
    const mon = addDays(monday, w);
    const tue = addDays(mon, 1), wed = addDays(mon, 2), thu = addDays(mon, 3), fri = addDays(mon, 4), sat = addDays(mon, 5), sun = addDays(mon, 6);
    const g1 = mk(P.group, mon, "17:00", { title: "Monday Group Clinic" });
    const g2 = mk(P.group, tue, "17:00", { title: "Pop-Up Group Clinic", coach_ids: [DEMO_IDS.maya] });
    const a1 = mk(P.accel, thu, "18:00", { title: "Accelerator: Serve +1", skill_level: "3.5+" });
    const g3 = mk(P.group, fri, "15:00", { title: "Friday Group Clinic" });
    const s1 = mk(P.sunset, sun, "18:30", { title: "Sunset Tennis", coach_ids: [DEMO_IDS.leo, DEMO_IDS.maya], price_cents: 2500, description: "Two coaches, rotating doubles and a short drill block to start." });
    const pv1 = mk(P.private, wed, "08:00");
    const pv2 = mk(P.private, wed, "09:00");
    const pv3 = mk(P.private, sat, "10:00");
    const pv4 = mk(P.private, sat, "11:00", { coach_ids: [DEMO_IDS.maya] });
    const sp1 = mk(P.semi, thu, "16:00");

    const pick = (offset: number, count: number) => Array.from({ length: count }, (_, i) => members[(offset + i) % members.length]);
    pick(0, 6).forEach((m) => book(g1, m)); // full
    pick(6, 2).forEach((m, i) => book(g1, m, { status: "waitlisted", waitlist_position: i + 1 }));
    pick(3, 4).forEach((m) => book(g2, m));
    pick(1, 3).forEach((m) => book(a1, m));
    pick(5, 5).forEach((m) => book(g3, m));
    pick(2, 9).forEach((m) => book(s1, m));
    book(pv1, members[w === 0 ? 0 : 4]);
    book(pv3, members[w === 7 ? 0 : 7]);
    book(sp1, members[3], { seats: 2, guest_name: "Chris (partner)" });
    void pv2; void pv4;
  }

  // A draft and a cancelled example for the admin views
  mk(P.accel, addDays(monday, 9), "18:00", { title: "Accelerator: Return of Serve", status: "draft", skill_level: "3.5+" });

  const sam = profiles.find((p) => p.id === DEMO_IDS.sam)!;
  const lastWeekGroup = sessions.find((s) => s.program_id === P.group && new Date(s.starts_at) < now);

  return {
    settings: [{ ...DEFAULT_SETTINGS, updated_at: created }],
    profiles,
    programs,
    schedule_templates: templates,
    sessions,
    bookings,
    lesson_requests: [
      {
        id: "00000000-0000-4000-b000-000000000001",
        user_id: members[1].id,
        program_id: P.private,
        preferred_date: addDays(today, 3),
        preferred_time: "07:30",
        alternatives: "Any weekday morning before 9",
        partner_name: "",
        partner_email: "",
        message: "Working on my backhand slice before league starts.",
        status: "pending",
        coach_id: null,
        session_id: null,
        admin_note: "",
        created_at: new Date(now.getTime() - 86400000).toISOString(),
      },
      {
        id: "00000000-0000-4000-b000-000000000002",
        user_id: members[4].id,
        program_id: P.semi,
        preferred_date: addDays(today, 5),
        preferred_time: "17:30",
        alternatives: "Weekend afternoons also work",
        partner_name: "Dana Rossi",
        partner_email: "dana@example.com",
        message: "My sister and I are both beginners.",
        status: "pending",
        coach_id: null,
        session_id: null,
        admin_note: "",
        created_at: new Date(now.getTime() - 3 * 3600000).toISOString(),
      },
    ],
    coach_notes: [
      {
        id: "00000000-0000-4000-c000-000000000001",
        player_id: sam.id,
        author_id: DEMO_IDS.leo,
        session_id: lastWeekGroup?.id ?? null,
        body: "Great progress on the kick serve toss — keep it slightly over the left shoulder. Next: add the split step after the serve.",
        visibility: "shared",
        created_at: new Date(now.getTime() - 4 * 86400000).toISOString(),
      },
      {
        id: "00000000-0000-4000-c000-000000000002",
        player_id: sam.id,
        author_id: DEMO_IDS.maya,
        session_id: null,
        body: "Ready to move into the Accelerator group. Pair with Noah for doubles patterns.",
        visibility: "staff",
        created_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
      },
    ],
    messages: [
      {
        id: "00000000-0000-4000-d000-000000000001",
        member_id: sam.id,
        sender_id: sam.id,
        body: "Hi Leo! Is there any chance of a private lesson Thursday early morning?",
        read_by_staff: true,
        read_by_member: true,
        created_at: new Date(now.getTime() - 26 * 3600000).toISOString(),
      },
      {
        id: "00000000-0000-4000-d000-000000000002",
        member_id: sam.id,
        sender_id: DEMO_IDS.leo,
        body: "Hey Sam — I can open a 7:30 AM slot. Send a lesson request and I'll approve it.",
        read_by_staff: true,
        read_by_member: false,
        created_at: new Date(now.getTime() - 20 * 3600000).toISOString(),
      },
      {
        id: "00000000-0000-4000-d000-000000000003",
        member_id: members[0].id,
        sender_id: members[0].id,
        body: "Could I bring a friend to Sunset Tennis this week?",
        read_by_staff: false,
        read_by_member: true,
        created_at: new Date(now.getTime() - 2 * 3600000).toISOString(),
      },
    ],
    announcements: [
      {
        id: "00000000-0000-4000-e000-000000000001",
        title: "Welcome to the new booking portal",
        body: "No more WhatsApp polls — book clinics, join waitlists and manage everything here. Questions? Message me from your dashboard.",
        author_id: DEMO_IDS.leo,
        pinned: true,
        created_at: new Date(now.getTime() - 5 * 86400000).toISOString(),
      },
      {
        id: "00000000-0000-4000-e000-000000000002",
        title: "Sunset Tennis moves to 6:30 PM",
        body: "With the earlier sunsets we're starting at 6:30 PM under the lights. Same courts, same energy.",
        author_id: DEMO_IDS.leo,
        pinned: false,
        created_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
      },
    ],
    notifications: [],
  };
}
