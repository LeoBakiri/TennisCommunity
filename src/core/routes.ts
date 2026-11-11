// One route table drives every screen in the app.
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
  { id: "schedule", pattern: "/", area: "public", title: "Schedule", load: Q.loadSchedule },
  { id: "schedule", pattern: "/schedule", area: "public", title: "Schedule", load: Q.loadSchedule },
  { id: "login", pattern: "/login", area: "auth", title: "Sign in" },
  { id: "welcome", pattern: "/onboarding", area: "auth", title: "Welcome", load: Q.loadWelcome },

  { id: "m.sessions", pattern: "/my-sessions", area: "member", title: "My Sessions", load: Q.loadMySessions },
  { id: "m.game", pattern: "/my-game", area: "member", title: "My Game", load: Q.loadMyGame },
  { id: "m.profile", pattern: "/profile", area: "member", title: "Profile", load: Q.loadProfile },

  { id: "c.schedule", pattern: "/coach", area: "coach", title: "My Schedule", load: Q.loadCoachSchedule },
  { id: "c.session", pattern: "/coach/sessions/:id", area: "coach", title: "Session", load: Q.loadCoachSession },
  { id: "c.lesson", pattern: "/coach/lessons/:id", area: "coach", title: "Lesson", load: Q.loadLessonEditor },
  { id: "c.earnings", pattern: "/coach/earnings", area: "coach", title: "Earnings", load: Q.loadCoachEarnings },
  { id: "c.clients", pattern: "/coach/clients", area: "coach", title: "Clients", load: Q.loadCoachClients },
  { id: "c.client", pattern: "/coach/clients/:id", area: "coach", title: "Client", load: Q.loadCoachClient },

  { id: "a.schedule", pattern: "/admin", area: "admin", title: "Community Schedule", load: Q.loadAdminSchedule },
  { id: "a.session", pattern: "/admin/sessions/:id", area: "admin", title: "Session", load: Q.loadSessionEditor },
  { id: "a.coaches", pattern: "/admin/coaches", area: "admin", title: "Coaches", load: Q.loadAdminCoaches },
  { id: "a.members", pattern: "/admin/members", area: "admin", title: "Members", load: Q.loadAdminMembers },
  { id: "a.member", pattern: "/admin/members/:id", area: "admin", title: "Member", load: Q.loadAdminMember },
  { id: "a.settings", pattern: "/admin/settings", area: "admin", title: "Settings", load: Q.loadSettingsPage },
];

// Links to retired pages live on in WhatsApp threads and home-screen shortcuts.
const RETIRED: [RegExp, string][] = [
  [/^\/app\/bookings/, "/my-sessions"],
  [/^\/app\/profile/, "/profile"],
  [/^\/(app|programs|about)(\/|$)/, "/schedule"],
  [/^\/coach\/players/, "/coach/clients"],
  [/^\/coach\/(calendar|messages)/, "/coach"],
  [/^\/admin\/sessions\/?$/, "/admin"],
  [/^\/admin\/(calendar|programs|schedule|requests|announcements|messages|notifications)/, "/admin"],
];

export function retiredRedirect(path: string): string | null {
  return RETIRED.find(([re]) => re.test(path))?.[1] ?? null;
}

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
  if (area === "public") {
    // Staff open the site onto their own work; the community schedule stays at /schedule.
    if (path === "/" && u?.onboarded && u.role !== "member") return homeFor(actor);
    return null;
  }
  if (area === "auth") {
    if (path.startsWith("/onboarding") && !actor.auth_id) return `/login`;
    if (path.startsWith("/login") && u?.onboarded) return homeFor(actor);
    return null;
  }
  if (!actor.auth_id) return `/login?next=${next}`;
  if (!u || !u.onboarded) return `/onboarding?next=${next}`;
  if (area === "coach" && u.role !== "coach" && u.role !== "admin") return "/schedule";
  if (area === "admin" && u.role !== "admin") return u.role === "coach" ? "/coach" : "/schedule";
  return null;
}

export function homeFor(actor: Actor): string {
  const r = actor.user?.role;
  return r === "admin" ? "/admin" : r === "coach" ? "/coach" : "/schedule";
}
