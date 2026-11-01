import type { ComponentType } from "react";
import type { FrameMeta } from "@/ui/shell";
import * as P from "@/ui/views/public";
import * as M from "@/ui/views/member";
import * as C from "@/ui/views/coach";
import * as AD from "@/ui/views/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = ComponentType<{ data: any; meta: FrameMeta }>;

export const VIEWS: Record<string, View> = {
  home: P.HomeView,
  programs: P.ProgramsView,
  program: P.ProgramView,
  schedule: P.ScheduleView,
  about: P.AboutView as View,
  login: P.LoginView as View,
  onboarding: P.OnboardingView,

  "m.dashboard": M.MemberDashboard,
  "m.book": M.MemberBook,
  "m.session": M.MemberSession,
  "m.request": M.MemberRequest as View,
  "m.bookings": M.MemberBookings,
  "m.messages": M.MemberMessages,
  "m.profile": M.MemberProfile as View,

  "c.today": C.CoachToday,
  "c.calendar": C.CoachCalendar,
  "c.session": C.CoachSession,
  "c.players": C.CoachPlayers as View,
  "c.player": C.CoachPlayer,
  "c.messages": ((p) => <C.StaffInbox {...p} base="/coach/messages" />) as View,

  "a.overview": AD.AdminOverview,
  "a.calendar": AD.AdminCalendar as View,
  "a.sessions": AD.AdminSessions as View,
  "a.session": AD.AdminSession as View,
  "a.programs": AD.AdminPrograms as View,
  "a.program": AD.AdminProgram as View,
  "a.templates": AD.AdminTemplates as View,
  "a.requests": AD.AdminRequests as View,
  "a.members": AD.AdminMembers as View,
  "a.member": AD.AdminMember,
  "a.announcements": AD.AdminAnnouncements as View,
  "a.messages": AD.AdminMessages,
  "a.notifications": AD.AdminNotifications as View,
  "a.settings": AD.AdminSettings as View,
};
