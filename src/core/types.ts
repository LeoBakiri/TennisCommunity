// Domain model shared by the server, the UI and the database schema.
// Field names are snake_case so rows map 1:1 to PostgreSQL columns.

export type Role = "member" | "coach" | "admin";
export type ProgramKind = "private" | "semi_private" | "group" | "event";
export type Pricing = "per_participant" | "per_session";
export type SessionStatus = "draft" | "published" | "cancelled";
export type Visibility = "public" | "private";
export type BookingStatus = "confirmed" | "pending" | "waitlisted" | "cancelled" | "declined";
export type RequestStatus = "pending" | "approved" | "declined" | "withdrawn";

export interface Settings {
  id: string; // always "default"
  brand_name: string;
  tagline: string;
  logo_mark: string; // short monogram shown in the logo
  color_primary: string; // hex
  color_accent: string;
  color_background: string;
  color_ink: string;
  color_sage: string;
  hero_headline: string;
  hero_subtext: string;
  coach_bio: string;
  contact_email: string;
  contact_phone: string;
  community_url: string;
  default_location: string;
  timezone: string;
  currency: string;
  cancellation_window_hours: number;
  cancellation_policy: string;
  waitlist_auto_promote: boolean;
  booking_horizon_days: number;
  club_disclaimer: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: Role;
  skill_level: string;
  ntrp: string;
  goals: string;
  dominant_hand: string;
  emergency_contact: string;
  bio: string;
  notify_email: boolean;
  notify_sms: boolean;
  tags: string[];
  status: "active" | "inactive";
  onboarded: boolean;
  created_at: string;
}

export interface Program {
  id: string;
  slug: string;
  name: string;
  kind: ProgramKind;
  summary: string;
  description: string;
  duration_min: number;
  capacity: number;
  price_cents: number | null;
  pricing: Pricing;
  requires_approval: boolean;
  allow_requests: boolean;
  skill_level: string;
  location: string;
  color: string;
  coaches_count: number;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface ScheduleTemplate {
  id: string;
  program_id: string;
  weekday: number; // 0 = Sunday … 6 = Saturday
  start_time: string; // "HH:MM" business-local
  duration_min: number;
  capacity: number | null;
  coach_ids: string[];
  location: string;
  published: boolean;
  notes: string;
  created_at: string;
}

export interface Session {
  id: string;
  program_id: string;
  title: string;
  starts_at: string; // ISO UTC
  ends_at: string;
  coach_ids: string[];
  capacity: number;
  price_cents: number | null;
  pricing: Pricing;
  location: string;
  status: SessionStatus;
  visibility: Visibility;
  description: string;
  internal_notes: string;
  skill_level: string;
  template_id: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  session_id: string;
  user_id: string;
  status: BookingStatus;
  seats: number;
  waitlist_position: number | null;
  guest_name: string;
  guest_email: string;
  attended: boolean | null;
  late_cancel: boolean;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface LessonRequest {
  id: string;
  user_id: string;
  program_id: string;
  preferred_date: string; // YYYY-MM-DD
  preferred_time: string; // HH:MM
  alternatives: string;
  partner_name: string;
  partner_email: string;
  message: string;
  status: RequestStatus;
  coach_id: string | null;
  session_id: string | null;
  admin_note: string;
  created_at: string;
}

export interface CoachNote {
  id: string;
  player_id: string;
  author_id: string;
  session_id: string | null;
  body: string;
  visibility: "staff" | "shared";
  created_at: string;
}

export interface Message {
  id: string;
  member_id: string; // the conversation is keyed by member
  sender_id: string;
  body: string;
  read_by_staff: boolean;
  read_by_member: boolean;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  author_id: string;
  pinned: boolean;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  user_id: string | null;
  channel: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  status: "sent" | "logged" | "failed";
  created_at: string;
}

export interface DB {
  settings: Settings[];
  profiles: Profile[];
  programs: Program[];
  schedule_templates: ScheduleTemplate[];
  sessions: Session[];
  bookings: Booking[];
  lesson_requests: LessonRequest[];
  coach_notes: CoachNote[];
  messages: Message[];
  announcements: Announcement[];
  notifications: NotificationLog[];
}

export type Table = keyof DB;
export type Row<K extends Table> = DB[K][number];

/** The signed-in person as seen by the application. */
export interface Actor {
  /** Authentication identity (Supabase user id or demo id). */
  auth_id: string | null;
  identifier: string | null; // email or phone used to sign in
  user: Profile | null; // null until onboarding creates the profile
}

export type ActionResult =
  | { ok: true; message?: string; redirect?: string; data?: unknown }
  | { ok: false; error: string };
