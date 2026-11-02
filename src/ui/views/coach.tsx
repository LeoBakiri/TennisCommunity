import { useState } from "react";
import { useAction, useNav, withQuery } from "../nav";
import { Icon, SessionMark } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, btn, Card, cx, Dot, Empty, Field, LinkButton, Notice, PageHeader, SectionTitle, Spinner, Submit } from "../kit";
import { WeekGrid, WeekNav } from "../sessions";
import { TimeSelect } from "./admin";
import type { loadCoachSchedule, loadCoachSession, loadLessonEditor } from "@/core/queries";
import type { CoachCalendar, LessonKind } from "@/core/types";
import { dateKey, fmtClock, fmtDateTime, fmtDayLong, fmtKeyLong, fmtRange, timeKey } from "@/core/time";
import { LESSON_META, SESSION_META, sessionTitle } from "@/core/util";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

// ───────────────────────── my schedule ─────────────────────────

const CONNECT_RESULT: Record<string, { tone: "info" | "warn"; text: string }> = {
  connected: { tone: "info", text: "Google Calendar connected. Your schedule is being added to it now." },
  denied: { tone: "warn", text: "Google Calendar wasn't connected. Allow access to your calendar events to sync your schedule." },
  failed: { tone: "warn", text: "Google Calendar couldn't be connected. Please try again." },
};

function GoogleCalendarCard({ calendar, live }: { calendar: CoachCalendar | null; live: boolean }) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const { run } = useAction();
  const result = CONNECT_RESULT[nav.search.google];
  const call = (name: "calendarConnect" | "calendarSync") => async () => {
    setBusy(true);
    await run(name, {});
    setBusy(false);
  };
  const lapsed = calendar?.status === "needs_reconnect";
  return (
    <div className="mb-5 space-y-3">
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", calendar && !lapsed ? "bg-accent text-ink" : "bg-sage text-brand")}>
            <Icon name="calendar" size={17} />
          </span>
          <div className="min-w-0 text-sm">
            <div className="font-semibold">{!calendar ? "Google Calendar not connected" : lapsed ? "Google Calendar needs reconnecting" : "Syncing to Google Calendar"}</div>
            <div className="break-words text-ink/55">
              {!calendar && (live ? "Connect it to add your whole coaching schedule to your calendar." : "Google Calendar connects on the live site, not in this demo.")}
              {calendar && (lapsed ? "Google access expired or was revoked, so updates have paused." : calendar.google_email)}
              {calendar && !lapsed && calendar.last_synced_at && ` · last update ${fmtDateTime(calendar.last_synced_at)}`}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {(!calendar || lapsed) && (
            <button className={btn("primary", "sm")} disabled={busy || !live} onClick={call("calendarConnect")}>
              {busy && <Spinner />} {lapsed ? "Reconnect" : "Connect Google Calendar"}
            </button>
          )}
          {calendar && !lapsed && (
            <button className={btn("outline", "sm")} disabled={busy} onClick={call("calendarSync")}>
              {busy ? <Spinner /> : <Icon name="refresh" size={15} />} Sync now
            </button>
          )}
          {calendar && (
            <ActionButton action="calendarDisconnect" input={{}} variant="ghost" confirm={{ title: "Disconnect Google Calendar?", body: "Upcoming events from this site are removed from your calendar. Past events stay.", label: "Disconnect", danger: true }}>
              Disconnect
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

const LEGEND = [
  { ...SESSION_META.group, mark: <SessionMark type="group" size={14} /> },
  { ...SESSION_META.performance_accelerator, mark: <SessionMark type="performance_accelerator" size={14} /> },
  { ...LESSON_META.private, mark: <Dot color={LESSON_META.private.color} /> },
  { ...LESSON_META.semi_private, mark: <Dot color={LESSON_META.semi_private.color} /> },
];

export function CoachSchedule({ data }: { data: D<typeof loadCoachSchedule> }) {
  const addHref = (kind: LessonKind, date?: string, time?: string) => withQuery("/coach/lessons/new", { kind, date, time });
  const s = data.summary;
  return (
    <>
      <PageHeader
        title="My Schedule"
        subtitle={`${s.community} community ${s.community === 1 ? "session" : "sessions"}, ${s.lessons} ${s.lessons === 1 ? "lesson" : "lessons"}, ${s.hours} hours this week.`}
        actions={
          <>
            <LinkButton href={addHref("private")} icon="plus">
              Add Private Lesson
            </LinkButton>
            <LinkButton href={addHref("semi_private")} variant="outline" icon="plus">
              Add Semi-Private Lesson
            </LinkButton>
          </>
        }
      />
      <GoogleCalendarCard calendar={data.calendar} live={data.live} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <WeekNav monday={data.monday} base="/coach" />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink/60">
          {LEGEND.map((m) => (
            <span key={m.label} className="flex items-center gap-1.5">
              {m.mark} {m.label}
            </span>
          ))}
        </div>
      </div>
      <WeekGrid days={data.days} today={data.today} items={data.items} newHref={(d, t) => addHref("private", d, t)} nowIso={data.nowIso} />
    </>
  );
}

// ───────────────────────── lesson ─────────────────────────

export function LessonEditor({ data }: { data: D<typeof loadLessonEditor> }) {
  const l = data.lesson;
  const p = data.prefill;
  const [kind, setKind] = useState<LessonKind>(l?.kind ?? p!.kind);
  const date = l ? dateKey(l.starts_at) : p!.date;
  const time = l ? timeKey(l.starts_at) : p!.time;
  const duration = l ? Math.round((new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()) / 60000) : 60;
  const semi = kind === "semi_private";
  return (
    <>
      <PageHeader
        back={{ href: "/coach", label: "My Schedule" }}
        title={l ? LESSON_META[l.kind].label : `Add ${LESSON_META[kind].label}`}
        subtitle={l ? `${fmtDayLong(l.starts_at)} · ${fmtRange(l.starts_at, l.ends_at)}` : `${fmtKeyLong(date)} · ${fmtClock(time)}`}
      />
      <div className="max-w-2xl space-y-4">
        <Card>
          <ActionForm action="saveLesson" hidden={{ id: l?.id ?? "", kind }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1 sm:col-span-2" role="radiogroup" aria-label="Lesson type">
                {(["private", "semi_private"] as const).map((k) => (
                  <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("rounded-lg py-2 text-sm font-semibold", kind === k ? "bg-card shadow-sm" : "text-ink/55")}>
                    {LESSON_META[k].label}
                  </button>
                ))}
              </div>
              <Field label={semi ? "Players / clients" : "Player / client name"} hint={semi ? "Separate names with commas" : "Doesn't need to be a community member"} className="sm:col-span-2">
                <input className="input" name="client_names" list="lesson-clients" defaultValue={l?.client_names.join(", ") ?? ""} required />
                <datalist id="lesson-clients">
                  {data.clients.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Date">
                <input className="input" type="date" name="date" defaultValue={date} />
              </Field>
              <Field label="Start time (Pacific)">
                <TimeSelect name="time" value={time} />
              </Field>
              <Field label="Duration (minutes)">
                <input className="input" type="number" name="duration_min" min={15} step={15} defaultValue={duration} />
              </Field>
              <Field label="Price (USD)" hint="Optional">
                <input className="input" name="price" inputMode="decimal" defaultValue={l?.price_cents == null ? "" : l.price_cents / 100} />
              </Field>
              <Field label="Location" className="sm:col-span-2">
                <input className="input" name="location" defaultValue={l?.location ?? p!.location} />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <textarea className="input" name="notes" defaultValue={l?.notes ?? ""} />
              </Field>
            </div>
            <Submit className="mt-6" icon="check">
              {l ? "Save lesson" : "Add lesson"}
            </Submit>
          </ActionForm>
        </Card>
        {l && (
          <ActionButton action="deleteLesson" input={{ lesson_id: l.id }} variant="ghost" icon="trash" confirm={{ title: "Delete this lesson?", body: "It's also removed from your Google Calendar. This can't be undone.", label: "Delete", danger: true }}>
            Delete lesson
          </ActionButton>
        )}
      </div>
    </>
  );
}

// ───────────────────────── community session ─────────────────────────

function AttendanceToggle({ bookingId, value }: { bookingId: string; value: boolean | null }) {
  const { run, pending } = useAction();
  const set = (v: "yes" | "no" | "clear") => run("setAttendance", { booking_id: bookingId, attended: v });
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-ink/12" role="group" aria-label="Attendance">
      <button disabled={pending} onClick={() => set(value === true ? "clear" : "yes")} className={cx("flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium", value === true ? "bg-[#E3EEDD] text-[#2E5A2A]" : "bg-card text-ink/60 hover:bg-paper")} aria-pressed={value === true}>
        <Icon name="check" size={14} /> Present
      </button>
      <button disabled={pending} onClick={() => set(value === false ? "clear" : "no")} className={cx("flex items-center gap-1 border-l border-ink/12 px-2.5 py-1.5 text-[13px] font-medium", value === false ? "bg-[#F5E1DC] text-[#8E3326]" : "bg-card text-ink/60 hover:bg-paper")} aria-pressed={value === false}>
        <Icon name="x" size={14} /> No-show
      </button>
    </div>
  );
}

export function CoachSession({ data }: { data: D<typeof loadCoachSession> }) {
  const s = data.session;
  const [open, setOpen] = useState<string | null>(null);
  const confirmed = data.roster.filter((r) => r.booking.status === "confirmed");
  const waitlist = data.roster.filter((r) => r.booking.status === "waitlisted");
  return (
    <>
      <PageHeader
        back={{ href: "/coach", label: "My Schedule" }}
        title={sessionTitle(s)}
        subtitle={`${fmtDayLong(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)} · ${s.location}`}
        actions={
          <>
            {data.isAdmin && (
              <LinkButton href={`/admin/sessions/${s.id}`} variant="outline" icon="edit">
                Edit in admin
              </LinkButton>
            )}
            {confirmed.some((r) => r.booking.attended === null) && (
              <ActionButton action="markAllPresent" input={{ session_id: s.id }} variant="primary" size="md" icon="check">
                Mark all present
              </ActionButton>
            )}
          </>
        }
      />
      {s.status === "cancelled" && (
        <div className="mb-4">
          <Notice tone="warn">This session was cancelled.</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <div>
            <SectionTitle action={<span className="text-sm text-ink/55 tabular-nums">{s.booked}/{s.capacity} booked</span>}>Roster</SectionTitle>
            {confirmed.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {confirmed.map((r) => (
                  <div key={r.booking.id} className="px-4 py-3.5 md:px-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <Avatar name={r.player?.full_name ?? "?"} size={38} />
                      <div className="min-w-0 flex-1 font-semibold">{r.player?.full_name}</div>
                      <AttendanceToggle bookingId={r.booking.id} value={r.booking.attended} />
                      <button className={btn("ghost", "sm")} onClick={() => setOpen(open === r.booking.id ? null : r.booking.id)} aria-expanded={open === r.booking.id}>
                        <Icon name="down" size={16} className={cx("transition-transform", open === r.booking.id && "rotate-180")} />
                        <span className="sr-only">Contact details</span>
                      </button>
                    </div>
                    {open === r.booking.id && r.player && (
                      <div className="fade-in mt-3 space-y-1.5 rounded-xl bg-paper p-4 text-sm">
                        {r.player.phone && (
                          <a href={`tel:${r.player.phone}`} className="flex items-center gap-2 hover:underline">
                            <Icon name="phone" size={15} /> {r.player.phone}
                          </a>
                        )}
                        {r.player.email && (
                          <a href={`mailto:${r.player.email}`} className="flex items-center gap-2 hover:underline">
                            <Icon name="mail" size={15} /> {r.player.email}
                          </a>
                        )}
                        {r.player.emergency_contact && (
                          <div className="flex items-center gap-2 text-ink/70">
                            <Icon name="shield" size={15} /> Emergency: {r.player.emergency_contact}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="users" title="No one booked yet" />
            )}
          </div>
          <div>
            <SectionTitle>Waitlist</SectionTitle>
            {waitlist.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {waitlist.map((r) => (
                  <div key={r.booking.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                    <span className="w-6 text-center text-sm font-semibold text-ink/40">#{r.booking.waitlist_position}</span>
                    <Avatar name={r.player?.full_name ?? "?"} size={30} />
                    <span className="flex-1 text-sm font-medium">{r.player?.full_name}</span>
                    {data.isAdmin && (
                      <ActionButton action="promoteBooking" input={{ booking_id: r.booking.id }} size="sm">
                        Move in
                      </ActionButton>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/50">No one is waiting.</p>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <Card>
            <SectionTitle>Session notes</SectionTitle>
            <ActionForm action="saveSessionNotes" hidden={{ session_id: s.id }}>
              <textarea className="input" name="internal_notes" defaultValue={s.internal_notes} rows={5} aria-label="Session notes" placeholder="Only coaches see these." />
              <Submit size="sm" className="mt-3" icon="note">
                Save notes
              </Submit>
            </ActionForm>
          </Card>
          {s.description && (
            <Card>
              <SectionTitle>
                Notes players see <Badge className="ml-1">Set by admin</Badge>
              </SectionTitle>
              <p className="text-sm whitespace-pre-line text-ink/70">{s.description}</p>
            </Card>
          )}
          {s.coaches.length > 1 && (
            <Card>
              <SectionTitle>Coaches</SectionTitle>
              <p className="text-sm text-ink/70">{s.coaches.map((c) => c.full_name).join(", ")}</p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
