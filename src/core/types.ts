// Domain model shared by the UI and the database schema.
// Field names are snake_case so rows map 1:1 to PostgreSQL columns.

export type Role = "member" | "coach" | "admin";
export type SessionType = "group" | "performance_accelerator";
export type LessonKind = "private" | "semi_private";
export type SessionStatus = "draft" | "published" | "cancelled";
export type BookingStatus = "confirmed" | "waitlisted" | "cancelled";
export type Skill = "serve" | "forehand" | "backhand" | "volley" | "movement" | "match_play";

export interface Settings {
  id: string; // always "default"
  brand_name: string;
  logo_mark: string; // short monogram shown in the logo
  color_primary: string; // hex
  color_accent: string;
  color_background: string;
  color_ink: string;
  color_sage: string;
  community_url: string; // the WhatsApp community link
  default_location: string;
  timezone: string;
  currency: string;
  cancellation_window_hours: number;
  cancellation_policy: string;
  booking_horizon_days: number;
  club_disclaimer: string;
  default_group_capacity: number;
  default_group_price_cents: number | null;
  default_group_duration_min: number;
  default_pa_capacity: number;
  default_pa_price_cents: number | null;
  default_pa_duration_min: number;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: Role;
  emergency_contact: string;
  status: "active" | "inactive";
  onboarded: boolean;
  weekly_goal?: number; // sessions a week the player aims for, 1–3; missing until the My Game migration runs
  leaderboard_hidden?: boolean;
  created_at: string;
}

/** A community session on the public schedule. Private lessons live in `lessons`. */
export interface Session {
  id: string;
  session_type: SessionType | null; // null only on retired rows from before the simplification
  title: string; // the Performance Accelerator focus; empty for Group Sessions
  starts_at: string; // ISO UTC
  ends_at: string;
  coach_ids: string[];
  capacity: number;
  price_cents: number | null;
  location: string;
  court: number | null; // Balboa court 1–4, when set
  status: SessionStatus;
  description: string; // notes visible to players
  internal_notes: string; // session notes visible to coaches only
  decided_at?: string | null; // a coach confirmed a two-court session that was under its minimum
  decide_by?: string | null; // when a short two-court session will be decided; null means 12 hours before
  created_at: string;
}

export interface Booking {
  id: string;
  session_id: string;
  user_id: string;
  status: BookingStatus;
  seats: number;
  waitlist_position: number | null;
  attended: boolean | null;
  late_cancel: boolean;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  spot_offered_at: string | null; // a booked player has put their spot up for someone else to take
}

/** A private or semi-private lesson, owned by one coach and never shown to players. */
export interface Lesson {
  id: string;
  coach_id: string;
  kind: LessonKind;
  client_names: string[];
  starts_at: string;
  ends_at: string;
  location: string;
  court: number | null; // Balboa court 1–4, when set
  price_cents: number | null; // what the player pays, for all players together
  commission_cents: number | null; // the club's cut, fixed when saved; null until a rule covers the place
  paid_at: string | null; // when the coach marked it paid
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Someone a coach teaches privately. Lessons find their clients by name, ignoring case. */
export interface Client {
  id: string;
  coach_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  level: string; // e.g. "3.5" or "Beginner"
  goals: string;
  notes: string; // only the coach sees these
  created_at: string;
  updated_at: string;
}

/** What a coach noticed about one player after a community session. Each skill listed moved up a level. */
export interface Feedback {
  id: string;
  session_id: string;
  user_id: string; // the player
  coach_id: string;
  skills: Skill[];
  tip: string; // shown to the player as their focus
  created_at: string;
  updated_at: string;
}

/** What a club takes from lessons taught at its courts. Coaches can read these; only admins change them. */
export interface CommissionRule {
  id: string;
  place: string; // matched against the lesson location, e.g. "Balboa"
  percent: number; // % of the lesson price
  per_hour_cents: number; // court fee per hour on court
  per_lesson_cents: number; // flat fee per lesson
  created_at: string;
}

/** A coach's Google Calendar connection, as visible to the app. The token is stored separately. */
export interface CoachCalendar {
  coach_id: string;
  google_email: string;
  status: "connected" | "needs_reconnect";
  last_synced_at: string | null;
  last_error: string;
  connected_at: string;
}

/** A player's private calendar link token. Only its owner can read it: the link shows their bookings. */
export interface PlayerCalendar {
  id: string; // the player's profile id
  token: string; // 32 hex characters
  created_at: string;
}

export interface DB {
  settings: Settings[];
  profiles: Profile[];
  sessions: Session[];
  bookings: Booking[];
  lessons: Lesson[];
  coach_calendars: CoachCalendar[];
  commission_rules: CommissionRule[];
  clients: Client[];
  feedback: Feedback[];
  player_calendars: PlayerCalendar[];
}

export type Table = keyof DB;
export type Row<K extends Table> = DB[K][number];

/** The signed-in person as seen by the application. */
export interface Actor {
  /** Authentication identity (Supabase user id or demo id). */
  auth_id: string | null;
  identifier: string | null; // email or phone used to sign in
  user: Profile | null; // null until the welcome step creates the profile
}

export type ActionResult =
  | { ok: true; message?: string; redirect?: string; data?: unknown }
  | { ok: false; error: string };
