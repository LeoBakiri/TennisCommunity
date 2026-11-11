import type { ComponentType } from "react";
import type { FrameMeta } from "@/ui/shell";
import * as P from "@/ui/views/public";
import * as M from "@/ui/views/member";
import * as C from "@/ui/views/coach";
import * as AD from "@/ui/views/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = ComponentType<{ data: any; meta: FrameMeta }>;

export const VIEWS: Record<string, View> = {
  schedule: M.ScheduleView,
  login: P.LoginView as View,
  welcome: P.WelcomeView,

  "m.sessions": M.MySessions as View,
  "m.game": M.MyGame as View,
  "m.profile": M.ProfileView as View,

  "c.schedule": C.CoachSchedule as View,
  "c.session": C.CoachSession as View,
  "c.lesson": C.LessonEditor as View,
  "c.earnings": C.CoachEarnings as View,
  "c.clients": C.CoachClients as View,
  "c.client": C.CoachClient as View,

  "a.schedule": AD.AdminSchedule as View,
  "a.session": AD.AdminSession as View,
  "a.coaches": AD.AdminCoaches as View,
  "a.members": AD.AdminMembers as View,
  "a.member": AD.AdminMember,
  "a.settings": AD.AdminSettings as View,
};
