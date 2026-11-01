// One route table drives both the Next.js app and the standalone preview.
import * as Q from "./queries";
import type { LoadCtx } from "./queries";
import type { Actor } from "./types";

export type Area = "public" | "auth" | "member" | "coach" | "admin";

export interface RouteDef {
  id: string;
  pattern: string;
  area: Area;
  title: string;
  load?: (ctx: LoadCtx) => Promise<unknown>;
}

export const ROUTES: RouteDef[] = [
  { id: "home", pattern: "/", area: "public", title: "Home", load: Q.loadHome },
  { id: "programs", pattern: "/programs", area: "public", title: "Programs", load: Q.loadPrograms },
  { id: "program", pattern: "/programs/:slug", area: "public", title: "Program", load: Q.loadProgram },
  { id: "schedule", pattern: "/schedule", area: "public", title: "Schedule", load: Q.loadSchedule },
  { id: "about", pattern: "/about", area: "public", title: "About" },
  { id: "login", pattern: "/login", area: "auth", title: "Sign in" },
  { id: "onboarding", pattern: "/onboarding", area: "auth", title: "Welcome", load: Q.loadOnboarding },

  { id: "m.dashboard", pattern: "/app", area: "member", title: "Home", load: Q.loadMemberDashboard },
  { id: "m.book", pattern: "/app/book", area: "member", title: "Book", load: Q.loadMemberBook },
  { id: "m.session", pattern: "/app/sessions/:id", area: "member", title: "Session", load: Q.loadSessionDetail },
  { id: "m.request", pattern: "/app/request", area: "member", title: "Request a lesson", load: Q.loadRequestForm },
  { id: "m.bookings", pattern: "/app/bookings", area: "member", title: "My bookings", load: Q.loadMemberBookings },
  { id: "m.messages", pattern: "/app/messages", area: "member", title: "Messages", load: Q.loadMemberMessages },
  { id: "m.profile", pattern: "/app/profile", area: "member", title: "Profile", load: Q.loadMemberProfile },

  { id: "c.today", pattern: "/coach", area: "coach", title: "Today", load: Q.loadCoachToday },
  { id: "c.calendar", pattern: "/coach/calendar", area: "coach", title: "Calendar", load: Q.loadCoachCalendar },
  { id: "c.session", pattern: "/coach/sessions/:id", area: "coach", title: "Session", load: Q.loadCoachSession },
  { id: "c.players", pattern: "/coach/players", area: "coach", title: "Players", load: Q.loadCoachPlayers },
  { id: "c.player", pattern: "/coach/players/:id", area: "coach", title: "Player", load: Q.loadCoachPlayer },
  { id: "c.messages", pattern: "/coach/messages", area: "coach", title: "Messages", load: Q.loadStaffInbox },

  { id: "a.overview", pattern: "/admin", area: "admin", title: "Overview", load: Q.loadAdminOverview },
  { id: "a.calendar", pattern: "/admin/calendar", area: "admin", title: "Calendar", load: Q.loadAdminCalendar },
  { id: "a.sessions", pattern: "/admin/sessions", area: "admin", title: "Sessions", load: Q.loadAdminSessions },
  { id: "a.session", pattern: "/admin/sessions/:id", area: "admin", title: "Session", load: Q.loadSessionEditor },
  { id: "a.programs", pattern: "/admin/programs", area: "admin", title: "Programs", load: Q.loadAdminPrograms },
  { id: "a.program", pattern: "/admin/programs/:id", area: "admin", title: "Program", load: Q.loadProgramEditor },
  { id: "a.templates", pattern: "/admin/schedule", area: "admin", title: "Weekly schedule", load: Q.loadTemplates },
  { id: "a.requests", pattern: "/admin/requests", area: "admin", title: "Requests", load: Q.loadAdminRequests },
  { id: "a.members", pattern: "/admin/members", area: "admin", title: "Community", load: Q.loadAdminMembers },
  { id: "a.member", pattern: "/admin/members/:id", area: "admin", title: "Member", load: Q.loadAdminMember },
  { id: "a.announcements", pattern: "/admin/announcements", area: "admin", title: "Announcements", load: Q.loadAnnouncements },
  { id: "a.messages", pattern: "/admin/messages", area: "admin", title: "Messages", load: Q.loadStaffInbox },
  { id: "a.notifications", pattern: "/admin/notifications", area: "admin", title: "Notification log", load: Q.loadNotifications },
  { id: "a.settings", pattern: "/admin/settings", area: "admin", title: "Settings", load: Q.loadSettingsPage },
];

export function matchRoute(path: string): { route: RouteDef; params: Record<string, string> } | null {
  const clean = path.replace(/\/+$/, "") || "/";
  const segs = clean.split("/").filter(Boolean);
  // Prefer static matches over parameter matches.
  const candidates = [...ROUTES].sort((a, b) => a.pattern.split(":").length - b.pattern.split(":").length);
  for (const route of candidates) {
    const ps = route.pattern.split("/").filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (ps[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

/** Returns a redirect target when the actor may not open this area, otherwise null. */
export function guard(area: Area, actor: Actor, path: string): string | null {
  const next = encodeURIComponent(path);
  const u = actor.user;
  if (area === "public") return null;
  if (area === "auth") {
    if (path.startsWith("/onboarding") && !actor.auth_id) return `/login`;
    if (path.startsWith("/login") && u?.onboarded) return homeFor(actor);
    return null;
  }
  if (!actor.auth_id) return `/login?next=${next}`;
  if (!u || !u.onboarded) return `/onboarding?next=${next}`;
  if (area === "coach" && u.role !== "coach" && u.role !== "admin") return "/app";
  if (area === "admin" && u.role !== "admin") return u.role === "coach" ? "/coach" : "/app";
  return null;
}

export function homeFor(actor: Actor): string {
  const r = actor.user?.role;
  return r === "admin" ? "/admin" : r === "coach" ? "/coach" : "/app";
}
