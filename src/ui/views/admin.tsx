import { useState } from "react";
import { A, useNav, withQuery } from "../nav";
import { Icon } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Capacity, Card, cx, Dot, Empty, Field, LinkButton, Modal, Notice, PageHeader, SectionTitle, Stat, Submit, Tabs, Toggle } from "../kit";
import { priceLabel, sessionName, WeekGrid, WeekNav } from "../sessions";
import { NoteComposer, NotesList, StaffInbox } from "./coach";
import { SKILL_LEVELS } from "./public";
import type { FrameMeta } from "../shell";
import type {
  loadAdminCalendar,
  loadAdminMember,
  loadAdminMembers,
  loadAdminOverview,
  loadAdminPrograms,
  loadAdminRequests,
  loadAdminSessions,
  loadAnnouncements,
  loadNotifications,
  loadProgramEditor,
  loadSessionEditor,
  loadSettingsPage,
  loadStaffInbox,
  loadTemplates,
} from "@/core/queries";
import { dateKey, fmtClock, fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtKeyDay, fmtKeyLong, fmtRange, timeKey, WEEKDAYS } from "@/core/time";
import { fmtMoney } from "@/core/util";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

const TIMES = Array.from({ length: 64 }, (_, i) => {
  const h = 6 + Math.floor(i / 4);
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${m}`;
});

function TimeSelect({ name, value }: { name: string; value: string }) {
  const opts = TIMES.includes(value) ? TIMES : [value, ...TIMES];
  return (
    <select className="input" name={name} defaultValue={value}>
      {opts.map((t) => (
        <option key={t} value={t}>
          {fmtClock(t)}
        </option>
      ))}
    </select>
  );
}

// ───────────────────────── overview ─────────────────────────

export function AdminOverview({ data, meta }: { data: D<typeof loadAdminOverview>; meta: FrameMeta }) {
  const k = data.kpis;
  const max = Math.max(1, ...data.trend.map((t) => t.seats));
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={`Welcome back, ${meta.user!.full_name.split(" ")[0]}`}
        subtitle="Everything happening across your coaching business this week."
        actions={
          <>
            <LinkButton href="/admin/calendar" variant="outline" icon="calendar">
              Calendar
            </LinkButton>
            <LinkButton href="/admin/sessions/new" icon="plus">
              New session
            </LinkButton>
          </>
        }
      />
      {(data.requests > 0 || data.pendingBookings > 0 || data.unread > 0 || data.drafts > 0) && (
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: data.requests, label: "lesson requests", href: "/admin/requests", icon: "inbox" as const },
            { n: data.pendingBookings, label: "bookings to approve", href: "/admin/requests", icon: "check" as const },
            { n: data.unread, label: "unread messages", href: "/admin/messages", icon: "message" as const },
            { n: data.drafts, label: "draft sessions", href: "/admin/sessions?tab=draft", icon: "edit" as const },
          ]
            .filter((x) => x.n > 0)
            .map((x) => (
              <A key={x.label} href={x.href} className="flex items-center gap-3 rounded-xl border border-accent/60 bg-accent/25 px-4 py-3 text-sm font-medium hover:bg-accent/40">
                <Icon name={x.icon} size={17} />
                <span className="flex-1">
                  <span className="font-bold tabular-nums">{x.n}</span> {x.label}
                </span>
                <Icon name="right" size={15} className="text-ink/40" />
              </A>
            ))}
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions this week" value={k.weekSessions} hint={`${k.booked} seats booked`} icon="calendar" />
        <Stat label="Fill rate" value={`${k.fill}%`} hint={`${k.waitlisted} on waitlists`} icon="chart" tone="accent" />
        <Stat label="Active players (month)" value={k.activePlayers} hint={`${k.members} members total`} icon="users" />
        <Stat label="Attendance (30 days)" value={k.attendance === null ? "—" : `${k.attendance}%`} hint={`${k.newMembers} new members in 30 days`} icon="check" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <div>
            <SectionTitle action={<A href="/admin/calendar" className="text-sm font-medium text-brand hover:underline">Week view</A>}>Today · {fmtDayLong(new Date())}</SectionTitle>
            {data.today.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {data.today.map((s) => (
                  <A key={s.id} href={`/admin/sessions/${s.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-paper/60 md:px-5">
                    <div className="w-28 shrink-0 text-sm font-semibold tabular-nums">{fmtRange(s.starts_at, s.ends_at)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Dot color={s.program.color} /> <span className="truncate">{sessionName(s)}</span>
                      </div>
                      <div className="text-xs text-ink/50">{s.coaches.map((c) => c.full_name).join(", ")}</div>
                    </div>
                    <div className="hidden w-32 sm:block">
                      <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} />
                    </div>
                  </A>
                ))}
              </div>
            ) : (
              <Empty icon="sun" title="No sessions today" action={<LinkButton href={`/admin/sessions/new?date=${dateKey(new Date())}`} size="sm" variant="outline">Add one</LinkButton>} />
            )}
          </div>
          <Card>
            <SectionTitle>Seats booked per week</SectionTitle>
            <div className="flex h-40 items-end gap-3">
              {data.trend.map((t, i) => (
                <div key={t.week} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-medium text-ink/60 tabular-nums">{t.seats}</span>
                  <div className={cx("w-full rounded-t-lg", i === 4 ? "bg-brand" : "bg-sage")} style={{ height: `${Math.max(4, (t.seats / max) * 110)}px` }} title={`${t.seats} seats`} />
                  <span className="text-[11px] text-ink/45">{i === 4 ? "This wk" : fmtKeyDay(t.week).split(", ")[1]}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div>
          <SectionTitle>Recent activity</SectionTitle>
          <div className="card divide-y divide-ink/[0.06]">
            {data.recent.map((r) => (
              <A key={r.id} href={`/admin/sessions/${r.session_id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-paper/60">
                <Avatar name={r.player} size={30} />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{r.player}</span> <span className="text-ink/55">{r.status === "waitlisted" ? "joined the waitlist for" : r.status === "cancelled" ? "cancelled" : r.status === "pending" ? "requested" : "booked"}</span> <span className="font-medium">{r.session}</span>
                  <div className="text-xs text-ink/45">{r.starts_at && fmtDateTime(r.starts_at)}</div>
                </div>
              </A>
            ))}
            {!data.recent.length && <p className="p-5 text-sm text-ink/50">No bookings yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

// ───────────────────────── calendar ─────────────────────────

export function AdminCalendar({ data }: { data: D<typeof loadAdminCalendar> }) {
  const nav = useNav();
  return (
    <>
      <PageHeader
        title="Instructor calendar"
        subtitle="Click an empty slot to schedule a session, or a session to manage it."
        actions={
          <>
            <LinkButton href="/admin/schedule" variant="outline" icon="repeat">
              Weekly schedule
            </LinkButton>
            <LinkButton href="/admin/sessions/new" icon="plus">
              New session
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekNav monday={data.monday} base="/admin/calendar" extra={data.coach ? { coach: data.coach } : {}} />
        <div className="flex items-center gap-3">
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-sm" value={data.coach} onChange={(e) => nav.push(withQuery("/admin/calendar", { week: data.monday, coach: e.target.value }))} aria-label="Filter by coach">
            <option value="">All coaches</option>
            {data.coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink/60">
        {data.programs.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <Dot color={p.color} /> {p.name}
          </span>
        ))}
      </div>
      <WeekGrid days={data.days} today={data.today} sessions={data.sessions} hrefFor={(s) => `/admin/sessions/${s.id}`} newHref={(d, t) => withQuery("/admin/sessions/new", { date: d, time: t })} nowIso={new Date().toISOString()} />
    </>
  );
}

// ───────────────────────── sessions list ─────────────────────────

export function AdminSessions({ data }: { data: D<typeof loadAdminSessions> }) {
  const nav = useNav();
  const base = (tab: string) => withQuery("/admin/sessions", { tab: tab === "upcoming" ? "" : tab, program: data.program });
  return (
    <>
      <PageHeader title="Sessions" actions={<LinkButton href="/admin/sessions/new" icon="plus">New session</LinkButton>} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Tabs
          current={data.tab}
          items={[
            { key: "upcoming", label: "Upcoming", href: base("upcoming"), count: data.counts.upcoming },
            { key: "draft", label: "Drafts", href: base("draft"), count: data.counts.draft },
            { key: "past", label: "Past", href: base("past") },
            { key: "cancelled", label: "Cancelled", href: base("cancelled") },
          ]}
        />
        <select className="input !min-h-[38px] !w-auto !py-1.5 text-sm" value={data.program} onChange={(e) => nav.push(withQuery("/admin/sessions", { tab: data.tab === "upcoming" ? "" : data.tab, program: e.target.value }))} aria-label="Filter by program">
          <option value="">All programs</option>
          {data.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {data.sessions.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>When</th>
                <th className="hidden md:table-cell">Coach</th>
                <th>Players</th>
                <th className="hidden sm:table-cell">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => nav.push(`/admin/sessions/${s.id}`)}>
                  <td>
                    <div className="flex items-center gap-2 font-medium">
                      <Dot color={s.program.color} /> {sessionName(s)}
                    </div>
                    <div className="mt-0.5 flex gap-1.5">
                      {s.status === "draft" && <Badge>Draft</Badge>}
                      {s.visibility === "private" && <Badge tone="blue">Private</Badge>}
                      {s.pending > 0 && <Badge tone="amber">{s.pending} to approve</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <div>{fmtDay(s.starts_at)}</div>
                    <div className="text-xs text-ink/50">{fmtRange(s.starts_at, s.ends_at)}</div>
                  </td>
                  <td className="hidden text-ink/70 md:table-cell">{s.coaches.map((c) => c.full_name.split(" ")[0]).join(", ") || "—"}</td>
                  <td className="w-36">
                    <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} />
                  </td>
                  <td className="hidden whitespace-nowrap text-ink/70 sm:table-cell">{priceLabel(s)}</td>
                  <td className="text-right">
                    <Icon name="right" size={16} className="text-ink/35" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="calendar" title="No sessions here" action={<LinkButton href="/admin/sessions/new" size="sm">Create a session</LinkButton>} />
      )}
    </>
  );
}

// ───────────────────────── session editor ─────────────────────────

function AddPlayer({ sessionId, members, semi }: { sessionId: string; members: { id: string; full_name: string }[]; semi: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={btn("outline", "sm")} onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} /> Add player
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a player to this session">
        <ActionForm action="adminAddBooking" hidden={{ session_id: sessionId }} onDone={(r) => r.ok && setOpen(false)}>
          <Field label="Player">
            <select className="input" name="user_id" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </Field>
          {semi && (
            <Field label="Partner name (optional)" className="mt-4">
              <input className="input" name="guest_name" />
            </Field>
          )}
          <Field label="Add as" className="mt-4">
            <select className="input" name="mode" defaultValue="auto">
              <option value="auto">Automatic (confirmed if there&apos;s room, otherwise waitlist)</option>
              <option value="confirmed">Confirmed, even if over capacity</option>
              <option value="waitlisted">Waitlist</option>
            </select>
          </Field>
          <Submit className="mt-5 w-full">Add player</Submit>
        </ActionForm>
      </Modal>
    </>
  );
}

export function AdminSession({ data }: { data: D<typeof loadSessionEditor> }) {
  const s = data.session;
  const program0 = data.programs.find((p) => p.id === (s?.program_id ?? data.prefill?.program_id)) ?? data.programs[0];
  const [programId, setProgramId] = useState(program0?.id ?? "");
  const program = data.programs.find((p) => p.id === programId) ?? program0;
  const date = s ? dateKey(s.starts_at) : data.prefill!.date;
  const time = s ? timeKey(s.starts_at) : data.prefill!.time;
  const duration = s ? Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000) : program?.duration_min ?? 60;
  const coachIds = s ? s.coach_ids : data.prefill!.coach_ids;
  const active = data.roster.filter((r) => r.booking.status !== "cancelled" && r.booking.status !== "declined");
  const inactive = data.roster.filter((r) => r.booking.status === "cancelled" || r.booking.status === "declined");

  const form = (
    <ActionForm action="saveSession" hidden={{ id: s?.id ?? "" }} key={programId}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Program" className="sm:col-span-2">
          <select className="input" name="program_id" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {data.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? "" : " (archived)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" hint="Optional — e.g. “Accelerator: Serve +1”" className="sm:col-span-2">
          <input className="input" name="title" defaultValue={s?.title ?? ""} placeholder={program?.name} />
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
        <Field label="Capacity">
          <input className="input" type="number" name="capacity" min={1} defaultValue={s?.capacity ?? program?.capacity ?? 6} />
        </Field>
        <Field label="Price (USD)" hint="Leave blank for “Price TBA”, 0 for free">
          <input className="input" name="price" inputMode="decimal" defaultValue={s ? (s.price_cents === null ? "" : s.price_cents / 100) : program?.price_cents === null ? "" : (program?.price_cents ?? 0) / 100} />
        </Field>
        <Field label="Pricing">
          <select className="input" name="pricing" defaultValue={s?.pricing ?? program?.pricing}>
            <option value="per_participant">Per player</option>
            <option value="per_session">Per session (split between players)</option>
          </select>
        </Field>
        <Field label="Location" className="sm:col-span-2">
          <input className="input" name="location" defaultValue={s?.location ?? program?.location ?? data.settings.default_location} />
        </Field>
        <Field label="Recommended level">
          <input className="input" name="skill_level" defaultValue={s?.skill_level ?? program?.skill_level ?? ""} list="levels" />
          <datalist id="levels">
            {SKILL_LEVELS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field label="Who can see it">
          <select className="input" name="visibility" defaultValue={s?.visibility ?? "public"}>
            <option value="public">Public schedule</option>
            <option value="private">Private (only booked players)</option>
          </select>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">Coaches</legend>
          <div className="flex flex-wrap gap-2">
            {data.coaches.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink/12 bg-card px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                <input type="checkbox" name="coach_ids[]" value={c.id} defaultChecked={coachIds.includes(c.id)} className="check" />
                {c.full_name}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Description for players" className="sm:col-span-2">
          <textarea className="input" name="description" defaultValue={s?.description ?? ""} placeholder="Focus, format, what to bring…" />
        </Field>
        <Field label="Internal notes (coaches only)" className="sm:col-span-2">
          <textarea className="input !min-h-[72px]" name="internal_notes" defaultValue={s?.internal_notes ?? ""} />
        </Field>
        {!s && (
          <Field label="Repeat weekly" hint="Creates this many additional weekly copies">
            <select className="input" name="repeat_weeks" defaultValue="0">
              {[0, 1, 2, 3, 4, 5, 7, 11].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Don't repeat" : `${n} more week${n > 1 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!s ? (
          <Field label="Status">
            <select className="input" name="status" defaultValue="published">
              <option value="published">Publish now (bookable)</option>
              <option value="draft">Save as draft</option>
            </select>
          </Field>
        ) : (
          <>
            <input type="hidden" name="status" value={s.status === "cancelled" ? "draft" : s.status} />
            <div className="sm:col-span-2">
              <Toggle name="notify" defaultChecked label="Notify booked players if the time or place changes" />
            </div>
          </>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Submit icon="check">{s ? "Save changes" : "Create session"}</Submit>
      </div>
    </ActionForm>
  );

  if (!s) {
    return (
      <>
        <PageHeader back={{ href: "/admin/calendar", label: "Calendar" }} title="New session" subtitle={`${fmtKeyLong(date)} · ${fmtClock(time)}`} />
        <div className="max-w-3xl">
          <Card>{form}</Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/admin/sessions", label: "Sessions" }}
        eyebrow={
          <span className="flex items-center gap-2">
            <Dot color={s.program.color} /> {s.program.name}
            {s.status === "draft" && <Badge>Draft</Badge>}
            {s.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
            {s.visibility === "private" && <Badge tone="blue">Private</Badge>}
          </span>
        }
        title={sessionName(s)}
        subtitle={`${fmtDayLong(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)}`}
        actions={
          <>
            {s.status === "draft" && (
              <ActionButton action="setSessionStatus" input={{ session_id: s.id, status: "published" }} variant="primary" size="md" icon="check">
                Publish
              </ActionButton>
            )}
            {s.status === "published" && (
              <ActionButton action="setSessionStatus" input={{ session_id: s.id, status: "draft" }} variant="outline" size="md" confirm={{ title: "Unpublish this session?", body: "It will disappear from the schedule. Existing bookings are kept." }}>
                Unpublish
              </ActionButton>
            )}
            <ActionButton action="duplicateSession" input={{ session_id: s.id, days: 7 }} variant="outline" size="md" icon="copy">
              Copy to next week
            </ActionButton>
            <LinkButton href={`/coach/sessions/${s.id}`} variant="outline" icon="clipboard">
              Attendance
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">
              Players <span className="font-normal text-ink/50">· {s.booked}/{s.capacity}</span>
            </h2>
            {s.status !== "cancelled" && <AddPlayer sessionId={s.id} members={data.members} semi={s.program.kind === "semi_private"} />}
          </div>
          {active.length ? (
            <div className="card divide-y divide-ink/[0.06]">
              {active.map((r) => (
                <div key={r.booking.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={r.player?.full_name ?? "?"} size={34} />
                  <div className="min-w-0 flex-1">
                    <A href={`/admin/members/${r.player?.id}`} className="text-sm font-semibold hover:underline">
                      {r.player?.full_name}
                    </A>
                    <div className="truncate text-xs text-ink/50">
                      {r.player?.email ?? r.player?.phone}
                      {r.booking.guest_name && ` · + ${r.booking.guest_name}`}
                    </div>
                  </div>
                  <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />
                  <div className="flex gap-1">
                    {r.booking.status === "pending" && (
                      <>
                        <ActionButton action="adminBookingOp" input={{ booking_id: r.booking.id, op: "approve" }} variant="primary">
                          Approve
                        </ActionButton>
                        <ActionButton action="adminBookingOp" input={{ booking_id: r.booking.id, op: "decline" }} variant="ghost" confirm={{ title: "Decline this booking?", label: "Decline", danger: true }}>
                          Decline
                        </ActionButton>
                      </>
                    )}
                    {r.booking.status === "waitlisted" && (
                      <ActionButton action="adminBookingOp" input={{ booking_id: r.booking.id, op: "promote" }}>
                        Move in
                      </ActionButton>
                    )}
                    <ActionButton
                      action="cancelBooking"
                      input={{ booking_id: r.booking.id, reason: "Removed by coach" }}
                      variant="ghost"
                      icon="x"
                      className="!px-2"
                      confirm={{ title: `Remove ${r.player?.full_name ?? "this player"}?`, body: "They'll be notified, and the waitlist moves up automatically.", label: "Remove", danger: true }}
                    >
                      <span className="sr-only">Remove</span>
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="users" title="No players yet" body={s.status === "draft" ? "Publish the session so players can book." : "Share the schedule link with your community."} />
          )}
          {inactive.length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink/70">
                {inactive.length} cancelled / declined
              </summary>
              <ul className="mt-3 space-y-2">
                {inactive.map((r) => (
                  <li key={r.booking.id} className="flex items-center justify-between gap-2">
                    <span>{r.player?.full_name}</span>
                    <span className="flex items-center gap-2 text-xs text-ink/50">
                      {r.booking.late_cancel && <Badge tone="amber">Late</Badge>}
                      {r.booking.cancel_reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {s.status !== "cancelled" && (
            <Card className="border-[#F5E1DC]">
              <h3 className="font-semibold">Cancel or delete</h3>
              <p className="mt-1 text-sm text-ink/60">Cancelling notifies every booked and waitlisted player. Sessions without bookings can be deleted.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton
                  action="setSessionStatus"
                  input={{ session_id: s.id, status: "cancelled" }}
                  variant="danger"
                  confirm={{ title: "Cancel this session?", body: `${s.booked + s.waitlist} player(s) will be notified.`, label: "Cancel session", danger: true, reason: true }}
                >
                  Cancel session
                </ActionButton>
                {s.booked + s.waitlist === 0 && (
                  <ActionButton action="deleteSession" input={{ session_id: s.id }} variant="ghost" icon="trash" confirm={{ title: "Delete this session?", body: "This can't be undone.", label: "Delete", danger: true }}>
                    Delete
                  </ActionButton>
                )}
              </div>
            </Card>
          )}
        </div>
        <div>
          <h2 className="mb-4 text-[15px] font-semibold">Details</h2>
          {s.status === "cancelled" ? <Notice tone="warn">This session is cancelled. Use “Copy to next week” to reschedule it.</Notice> : <Card>{form}</Card>}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── programs ─────────────────────────

export function AdminPrograms({ data }: { data: D<typeof loadAdminPrograms> }) {
  return (
    <>
      <PageHeader title="Programs" subtitle="Templates for every kind of session you offer. Prices, capacity and duration here are the defaults for new sessions." actions={<LinkButton href="/admin/programs/new" icon="plus">New program</LinkButton>} />
      <div className="grid gap-3 md:grid-cols-2">
        {data.programs.map((p) => (
          <A key={p.id} href={`/admin/programs/${p.id}`} className={cx("card flex gap-4 p-5 transition-shadow hover:shadow-md", !p.active && "opacity-60")}>
            <span className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{p.name}</h3>
                {!p.active && <Badge>Archived</Badge>}
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink/60">{p.summary}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink/55">
                <span>{p.price_cents === null ? "Price TBA" : `${fmtMoney(p.price_cents)} ${p.pricing === "per_session" ? "/ session" : "/ player"}`}</span>
                <span>{p.duration_min} min</span>
                <span>Cap {p.capacity}</span>
                <span>{p.upcoming} upcoming</span>
                {p.requires_approval && <span>Needs approval</span>}
              </div>
            </div>
          </A>
        ))}
      </div>
    </>
  );
}

export function AdminProgram({ data }: { data: D<typeof loadProgramEditor> }) {
  const p = data.program;
  return (
    <>
      <PageHeader back={{ href: "/admin/programs", label: "Programs" }} title={p ? p.name : "New program"} subtitle="Workshops, junior clinics, events — anything you run can be a program." />
      <div className="max-w-3xl">
        <Card>
          <ActionForm action="saveProgram" hidden={{ id: p?.id ?? "" }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <input className="input" name="name" defaultValue={p?.name ?? ""} required />
              </Field>
              <Field label="Type">
                <select className="input" name="kind" defaultValue={p?.kind ?? "group"}>
                  <option value="private">Private lesson</option>
                  <option value="semi_private">Semi-private lesson</option>
                  <option value="group">Group / clinic</option>
                  <option value="event">Community event</option>
                </select>
              </Field>
              <Field label="Color on calendar">
                <input className="input !p-1.5" type="color" name="color" defaultValue={p?.color ?? "#4F6B4A"} />
              </Field>
              <Field label="Short summary" className="sm:col-span-2">
                <input className="input" name="summary" defaultValue={p?.summary ?? ""} />
              </Field>
              <Field label="Full description" className="sm:col-span-2">
                <textarea className="input" name="description" defaultValue={p?.description ?? ""} rows={5} />
              </Field>
              <Field label="Default duration (min)">
                <input className="input" type="number" name="duration_min" defaultValue={p?.duration_min ?? 60} min={15} step={15} />
              </Field>
              <Field label="Default capacity">
                <input className="input" type="number" name="capacity" defaultValue={p?.capacity ?? 6} min={1} />
              </Field>
              <Field label="Default price (USD)" hint="Blank = Price TBA">
                <input className="input" name="price" inputMode="decimal" defaultValue={p ? (p.price_cents === null ? "" : p.price_cents / 100) : ""} />
              </Field>
              <Field label="Pricing">
                <select className="input" name="pricing" defaultValue={p?.pricing ?? "per_participant"}>
                  <option value="per_participant">Per player</option>
                  <option value="per_session">Per session (split between players)</option>
                </select>
              </Field>
              <Field label="Recommended level">
                <input className="input" name="skill_level" defaultValue={p?.skill_level ?? ""} />
              </Field>
              <Field label="Coaches on court">
                <input className="input" type="number" name="coaches_count" defaultValue={p?.coaches_count ?? 1} min={1} />
              </Field>
              <Field label="Default location" className="sm:col-span-2">
                <input className="input" name="location" defaultValue={p?.location ?? data.defaultLocation} />
              </Field>
              <Field label="Sort order" hint="Lower numbers show first">
                <input className="input" type="number" name="sort_order" defaultValue={p?.sort_order ?? 10} />
              </Field>
              <div className="grid gap-2 sm:col-span-2">
                <Toggle name="requires_approval" defaultChecked={p?.requires_approval ?? false} label="Coach approves each booking" hint="Bookings stay “awaiting approval” until you confirm them" />
                <Toggle name="allow_requests" defaultChecked={p?.allow_requests ?? false} label="Players can request custom times" hint="Shows this program on the Request a lesson form" />
                <Toggle name="active" defaultChecked={p?.active ?? true} label="Active" hint="Turn off to archive — it disappears from the public site" />
              </div>
            </div>
            <Submit className="mt-6" icon="check">
              {p ? "Save program" : "Create program"}
            </Submit>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── weekly schedule (templates) ─────────────────────────

function TemplateForm({ t, data, onDone }: { t?: D<typeof loadTemplates>["templates"][number]; data: D<typeof loadTemplates>; onDone: () => void }) {
  return (
    <ActionForm action="saveTemplate" hidden={{ id: t?.id ?? "" }} onDone={(r) => r.ok && onDone()}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Program" className="sm:col-span-2">
          <select className="input" name="program_id" defaultValue={t?.program_id ?? data.programs[0]?.id}>
            {data.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" hint="Shown as the session title" className="sm:col-span-2">
          <input className="input" name="notes" defaultValue={t?.notes ?? ""} placeholder="e.g. Monday Group Clinic" />
        </Field>
        <Field label="Day">
          <select className="input" name="weekday" defaultValue={t?.weekday ?? 1}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <option key={d} value={d}>
                {WEEKDAYS[d]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start time">
          <TimeSelect name="start_time" value={t?.start_time ?? "17:00"} />
        </Field>
        <Field label="Duration (min)">
          <input className="input" type="number" name="duration_min" defaultValue={t?.duration_min ?? 90} step={15} min={15} />
        </Field>
        <Field label="Capacity" hint="Blank = program default">
          <input className="input" type="number" name="capacity" defaultValue={t?.capacity ?? ""} min={1} />
        </Field>
        <Field label="Location" hint="Blank = program default" className="sm:col-span-2">
          <input className="input" name="location" defaultValue={t?.location ?? ""} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">Coaches</legend>
          <div className="flex flex-wrap gap-2">
            {data.coaches.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink/12 px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                <input type="checkbox" name="coach_ids[]" value={c.id} defaultChecked={t ? t.coach_ids.includes(c.id) : data.coaches[0]?.id === c.id} className="check" />
                {c.full_name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Toggle name="published" defaultChecked={t?.published ?? false} label="Published" hint="Only published slots are used when you generate sessions" />
        </div>
      </div>
      <Submit className="mt-5 w-full">{t ? "Save" : "Add recurring slot"}</Submit>
    </ActionForm>
  );
}

export function AdminTemplates({ data }: { data: D<typeof loadTemplates> }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [gen, setGen] = useState(false);
  const current = data.templates.find((t) => t.id === editing);
  const published = data.templates.filter((t) => t.published).length;
  return (
    <>
      <PageHeader
        title="Weekly schedule"
        subtitle="Your recurring timetable. Nothing goes live until you publish a slot and generate sessions from it."
        actions={
          <>
            <button className={btn("outline")} onClick={() => setEditing("new")}>
              <Icon name="plus" size={17} /> Add slot
            </button>
            <button className={btn("primary")} onClick={() => setGen(true)} disabled={!published}>
              <Icon name="repeat" size={17} /> Generate sessions
            </button>
          </>
        }
      />
      {!published && (
        <div className="mb-4">
          <Notice>All recurring slots start unpublished. Edit a slot and switch on “Published”, then use “Generate sessions” to create the dates.</Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 *:min-w-0 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
          const list = data.templates.filter((t) => t.weekday === wd);
          return (
            <div key={wd} className="card p-4">
              <h3 className="mb-3 text-sm font-semibold">{WEEKDAYS[wd]}</h3>
              {list.length ? (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => setEditing(t.id)} className="flex w-full items-center gap-3 rounded-xl bg-paper px-3 py-2.5 text-left hover:bg-sage/40">
                        <span className="h-8 w-1 rounded-full" style={{ background: t.program.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.notes || t.program.name}</span>
                          <span className="text-xs text-ink/55">
                            {fmtClock(t.start_time)} · {t.duration_min} min
                          </span>
                        </span>
                        {t.published ? <Badge tone="green">Published</Badge> : <Badge>Unpublished</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink/40">—</p>
              )}
            </div>
          );
        })}
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={current ? "Edit recurring slot" : "New recurring slot"} wide>
        {editing !== null && <TemplateForm t={current} data={data} onDone={() => setEditing(null)} />}
        {current && (
          <div className="mt-3 border-t border-ink/[0.06] pt-3">
            <ActionButton action="deleteTemplate" input={{ template_id: current.id }} variant="ghost" icon="trash" confirm={{ title: "Delete this recurring slot?", body: "Sessions already created from it are kept.", label: "Delete", danger: true }} onDone={(r) => r.ok && setEditing(null)}>
              Delete slot
            </ActionButton>
          </div>
        )}
      </Modal>
      <Modal open={gen} onClose={() => setGen(false)} title="Generate sessions">
        <ActionForm action="generateFromTemplates" onDone={(r) => r.ok && setGen(false)}>
          <p className="mb-4 text-sm text-ink/65">Creates dated sessions from your {published} published slot(s). Dates that already exist are skipped.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting from">
              <input className="input" type="date" name="start" defaultValue={data.nextMonday} />
            </Field>
            <Field label="Number of weeks">
              <select className="input" name="weeks" defaultValue="4">
                {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4">
            <Toggle name="publish" label="Publish immediately" hint="Off = create as drafts you can review first" />
          </div>
          <Submit className="mt-5 w-full" icon="repeat">
            Generate
          </Submit>
        </ActionForm>
      </Modal>
    </>
  );
}

// ───────────────────────── requests ─────────────────────────

export function AdminRequests({ data }: { data: D<typeof loadAdminRequests> }) {
  const [approving, setApproving] = useState<string | null>(null);
  const r = data.pending.find((x) => x.id === approving);
  return (
    <>
      <PageHeader title="Requests & approvals" subtitle="Lesson requests from players, plus bookings that need your OK." />
      {data.pendingBookings.length > 0 && (
        <div className="mb-8">
          <SectionTitle>Bookings awaiting approval</SectionTitle>
          <div className="card divide-y divide-ink/[0.06]">
            {data.pendingBookings.map((b) => (
              <div key={b.booking.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
                <Avatar name={b.player} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{b.player}</div>
                  <div className="text-[13px] text-ink/55">
                    {sessionName(b.session)} · {fmtDateTime(b.session.starts_at)}
                    {b.booking.guest_name && ` · with ${b.booking.guest_name}`}
                  </div>
                </div>
                <ActionButton action="adminBookingOp" input={{ booking_id: b.booking.id, op: "approve" }} variant="primary" icon="check">
                  Approve
                </ActionButton>
                <ActionButton action="adminBookingOp" input={{ booking_id: b.booking.id, op: "decline" }} variant="ghost" confirm={{ title: "Decline this booking?", label: "Decline", danger: true }}>
                  Decline
                </ActionButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <SectionTitle>Lesson requests</SectionTitle>
      {data.pending.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.pending.map((x) => (
            <Card key={x.id}>
              <div className="flex items-start gap-3">
                <Avatar name={x.player?.full_name ?? "?"} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{x.player?.full_name}</span>
                    <Badge>{x.program?.name}</Badge>
                  </div>
                  <div className="text-xs text-ink/50">
                    {x.player?.skill_level} · requested {fmtDate(x.created_at)}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-paper p-3.5 text-sm">
                <div className="font-medium">
                  {fmtKeyLong(x.preferred_date)} at {fmtClock(x.preferred_time)}
                </div>
                {x.alternatives && <div className="mt-0.5 text-ink/60">Also: {x.alternatives}</div>}
                {x.partner_name && <div className="mt-0.5 text-ink/60">Partner: {x.partner_name}{x.partner_email && ` (${x.partner_email})`}</div>}
                {x.message && <p className="mt-2 text-ink/75">“{x.message}”</p>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={btn("primary", "sm")} onClick={() => setApproving(x.id)}>
                  <Icon name="check" size={15} /> Schedule it
                </button>
                <ActionButton action="declineRequest" input={{ request_id: x.id, admin_note: "" }} variant="ghost" confirm={{ title: "Decline this request?", body: "The player will be notified and invited to message you for another time.", label: "Decline", danger: true }}>
                  Decline
                </ActionButton>
                {x.player && (
                  <A href={withQuery("/admin/messages", { m: x.player.id })} className={btn("ghost", "sm")}>
                    <Icon name="message" size={15} /> Message
                  </A>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty icon="inbox" title="No pending requests" body="New lesson requests from players will appear here." />
      )}
      {data.handled.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-ink/60">Recently handled ({data.handled.length})</summary>
          <div className="card mt-3 divide-y divide-ink/[0.06]">
            {data.handled.map((x) => (
              <div key={x.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1">
                  {x.player?.full_name} · {x.program?.name} · {fmtKeyDay(x.preferred_date)}
                </span>
                <Badge tone={x.status === "approved" ? "green" : x.status === "declined" ? "red" : "neutral"}>{x.status}</Badge>
              </div>
            ))}
          </div>
        </details>
      )}
      <Modal open={!!r} onClose={() => setApproving(null)} title="Schedule this lesson">
        {r && (
          <ActionForm action="approveRequest" hidden={{ request_id: r.id }} onDone={(res) => res.ok && setApproving(null)}>
            <p className="mb-4 text-sm text-ink/65">
              {r.player?.full_name} · {r.program?.name}. Adjust the time if needed — the player gets a confirmation right away.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date">
                <input className="input" type="date" name="date" defaultValue={r.preferred_date} />
              </Field>
              <Field label="Start time">
                <TimeSelect name="time" value={r.preferred_time} />
              </Field>
              <Field label="Duration (min)">
                <input className="input" type="number" name="duration_min" defaultValue={r.program?.duration_min ?? 60} step={15} />
              </Field>
              <Field label="Coach">
                <select className="input" name="coach_id" defaultValue={data.me}>
                  {data.coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Location" className="sm:col-span-2">
                <input className="input" name="location" defaultValue={r.program?.location ?? data.defaultLocation} />
              </Field>
              <Field label="Note to the player (optional)" className="sm:col-span-2">
                <input className="input" name="admin_note" placeholder="e.g. Meet at court 4" />
              </Field>
            </div>
            <Submit className="mt-5 w-full" icon="check">
              Confirm lesson
            </Submit>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}

// ───────────────────────── members ─────────────────────────

export function AdminMembers({ data }: { data: D<typeof loadAdminMembers> }) {
  const nav = useNav();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Community"
        subtitle={`${data.total} people · players, coaches and admins`}
        actions={
          <button className={btn("primary")} onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} /> Add player
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <form
          className="min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            nav.push(withQuery("/admin/members", { q: String(new FormData(e.currentTarget).get("q") ?? ""), role: data.role, tag: data.tag }));
          }}
        >
          <label className="relative block">
            <Icon name="search" size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" />
            <input name="q" defaultValue={data.q} className="input !pl-10" placeholder="Search name, email or phone" />
          </label>
        </form>
        <select className="input !w-auto" value={data.role} onChange={(e) => nav.push(withQuery("/admin/members", { q: data.q, role: e.target.value, tag: data.tag }))} aria-label="Role">
          <option value="">Everyone</option>
          <option value="member">Players</option>
          <option value="coach">Coaches</option>
          <option value="admin">Admins</option>
        </select>
        <select className="input !w-auto" value={data.tag} onChange={(e) => nav.push(withQuery("/admin/members", { q: data.q, role: data.role, tag: e.target.value }))} aria-label="Tag">
          <option value="">All tags</option>
          {data.tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      {data.members.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden md:table-cell">Contact</th>
                <th>Level</th>
                <th className="hidden sm:table-cell">Bookings</th>
                <th className="hidden lg:table-cell">Tags</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => nav.push(`/admin/members/${m.id}`)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} size={32} />
                      <div>
                        <div className="font-medium">{m.full_name}</div>
                        <div className="flex gap-1">
                          {m.role !== "member" && <Badge tone="dark">{m.role}</Badge>}
                          {m.status === "inactive" && <Badge>Inactive</Badge>}
                          {!m.onboarded && <Badge tone="amber">Invited</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden text-ink/65 md:table-cell">
                    <div>{m.email}</div>
                    <div className="text-xs">{m.phone}</div>
                  </td>
                  <td className="text-ink/70">
                    {m.skill_level}
                    {m.ntrp && <span className="text-ink/45"> · {m.ntrp}</span>}
                  </td>
                  <td className="hidden tabular-nums sm:table-cell">{m.bookings}</td>
                  <td className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="users" title="No one matches" />
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a player">
        <ActionForm action="adminCreateMember" onDone={(r) => r.ok && setAdding(false)}>
          <p className="mb-4 text-sm text-ink/60">Bring players over from WhatsApp. They can sign in later with the same email or phone to claim their account.</p>
          <div className="grid gap-4">
            <Field label="Full name">
              <input className="input" name="full_name" required />
            </Field>
            <Field label="Email">
              <input className="input" type="email" name="email" />
            </Field>
            <Field label="Mobile">
              <input className="input" type="tel" name="phone" />
            </Field>
            <Field label="Tags" hint="Comma separated, e.g. League, Sunset">
              <input className="input" name="tags" />
            </Field>
          </div>
          <Submit className="mt-5 w-full">Add player</Submit>
        </ActionForm>
      </Modal>
    </>
  );
}

export function AdminMember({ data, meta }: { data: D<typeof loadAdminMember>; meta: FrameMeta }) {
  const p = data.profile;
  return (
    <>
      <PageHeader
        back={{ href: "/admin/members", label: "Community" }}
        title={p.full_name}
        subtitle={`${p.skill_level}${p.ntrp ? ` · NTRP ${p.ntrp}` : ""} · joined ${fmtDate(p.created_at)}`}
        actions={
          <LinkButton href={withQuery("/admin/messages", { m: p.id })} variant="outline" icon="message">
            Message
          </LinkButton>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>Contact</SectionTitle>
            <div className="space-y-2 text-sm">
              {p.email && (
                <a href={`mailto:${p.email}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="mail" size={15} /> {p.email}
                </a>
              )}
              {p.phone && (
                <a href={`tel:${p.phone}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="phone" size={15} /> {p.phone}
                </a>
              )}
              {p.emergency_contact && (
                <div className="flex items-center gap-2 text-ink/70">
                  <Icon name="shield" size={15} /> {p.emergency_contact}
                </div>
              )}
              {p.goals && <p className="pt-2 text-ink/70">Goals: {p.goals}</p>}
            </div>
          </Card>
          <Card>
            <SectionTitle>Role & tags</SectionTitle>
            <ActionForm action="adminUpdateMember" hidden={{ user_id: p.id }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role" hint="Coaches get the Coach portal; admins get everything">
                  <select className="input" name="role" defaultValue={p.role} disabled={p.id === meta.user!.id}>
                    <option value="member">Player</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                  </select>
                  {p.id === meta.user!.id && <input type="hidden" name="role" value={p.role} />}
                </Field>
                <Field label="Status">
                  <select className="input" name="status" defaultValue={p.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive (can't book)</option>
                  </select>
                </Field>
                <Field label="Level">
                  <input className="input" name="skill_level" defaultValue={p.skill_level} list="levels2" />
                  <datalist id="levels2">
                    {SKILL_LEVELS.map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                </Field>
                <Field label="NTRP">
                  <input className="input" name="ntrp" defaultValue={p.ntrp} />
                </Field>
                <Field label="Tags" hint="Comma separated" className="sm:col-span-2">
                  <input className="input" name="tags" defaultValue={p.tags.join(", ")} />
                </Field>
                {p.role !== "member" && (
                  <Field label="Coach bio (shown to players)" className="sm:col-span-2">
                    <textarea className="input" name="bio" defaultValue={p.bio} />
                  </Field>
                )}
              </div>
              <Submit className="mt-5">Save</Submit>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <SectionTitle>Coaching notes</SectionTitle>
            <NoteComposer playerId={p.id} />
            <div className="mt-5">
              <NotesList notes={data.notes} me={data.me} isAdmin />
            </div>
          </Card>
          <div>
            <SectionTitle>Bookings</SectionTitle>
            {data.history.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {data.history.slice(0, 25).map((r) => (
                  <A key={r.booking.id} href={`/admin/sessions/${r.session.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-paper/60">
                    <Dot color={r.session.program.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{sessionName(r.session)}</span>
                      <span className="text-xs text-ink/50">{fmtDateTime(r.session.starts_at)}</span>
                    </span>
                    {r.booking.attended === true ? <Badge tone="green">Attended</Badge> : r.booking.attended === false ? <Badge tone="red">No-show</Badge> : <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />}
                  </A>
                ))}
              </div>
            ) : (
              <Empty title="No bookings yet" />
            )}
          </div>
          {data.requests.length > 0 && (
            <div>
              <SectionTitle>Lesson requests</SectionTitle>
              <div className="card divide-y divide-ink/[0.06]">
                {data.requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      {r.program} · {fmtKeyDay(r.preferred_date)}
                    </span>
                    <Badge tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "neutral"}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── community & settings ─────────────────────────

export function AdminAnnouncements({ data }: { data: D<typeof loadAnnouncements> }) {
  return (
    <>
      <PageHeader title="Announcements" subtitle="Post updates to every player's dashboard — and optionally email them. Replaces the WhatsApp broadcast." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <SectionTitle>New announcement</SectionTitle>
          <ActionForm action="createAnnouncement" reset>
            <Field label="Title">
              <input className="input" name="title" />
            </Field>
            <Field label="Message" className="mt-4">
              <textarea className="input" name="body" rows={5} />
            </Field>
            <div className="mt-4 grid gap-2">
              <Toggle name="pinned" label="Pin to the top" />
              <Toggle name="notify" label={`Also send by email (${data.audience} people)`} />
            </div>
            <Submit className="mt-5" icon="megaphone">
              Post
            </Submit>
          </ActionForm>
        </Card>
        <div className="space-y-3">
          {data.announcements.map((a) => (
            <Card key={a.id} className="!p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="text-xs text-ink/45">
                    {a.author} · {fmtDate(a.created_at)}
                  </p>
                </div>
                {a.pinned && <Badge tone="accent">Pinned</Badge>}
              </div>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink/70">{a.body}</p>
              <div className="mt-3 flex gap-1">
                <ActionButton action="updateAnnouncement" input={{ announcement_id: a.id, op: a.pinned ? "unpin" : "pin" }} variant="ghost">
                  {a.pinned ? "Unpin" : "Pin"}
                </ActionButton>
                <ActionButton action="updateAnnouncement" input={{ announcement_id: a.id, op: "delete" }} variant="ghost" icon="trash" confirm={{ title: "Delete this announcement?", label: "Delete", danger: true }}>
                  Delete
                </ActionButton>
              </div>
            </Card>
          ))}
          {!data.announcements.length && <Empty icon="megaphone" title="No announcements yet" />}
        </div>
      </div>
    </>
  );
}

export function AdminMessages({ data, meta }: { data: D<typeof loadStaffInbox>; meta: FrameMeta }) {
  return <StaffInbox data={data} meta={meta} base="/admin/messages" />;
}

export function AdminNotifications({ data }: { data: D<typeof loadNotifications> }) {
  return (
    <>
      <PageHeader title="Notification log" subtitle="Every confirmation, waitlist update and announcement the system has queued." />
      {data.notifications.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th>Subject</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.notifications.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap text-ink/60">{fmtDateTime(n.created_at)}</td>
                  <td className="text-ink/70">{n.recipient}</td>
                  <td>
                    <div className="font-medium">{n.subject}</div>
                    <div className="line-clamp-1 max-w-md text-xs text-ink/50">{n.body}</div>
                  </td>
                  <td>
                    <Badge tone={n.status === "sent" ? "green" : n.status === "failed" ? "red" : "neutral"}>{n.status === "logged" ? "Queued" : n.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="bell" title="Nothing sent yet" body="Book or cancel a session to see notifications appear here." />
      )}
    </>
  );
}

export function AdminSettings({ data }: { data: D<typeof loadSettingsPage> }) {
  const s = data.settings;
  const color = (name: keyof typeof s, label: string) => (
    <Field label={label}>
      <input className="input !p-1.5" type="color" name={name} defaultValue={String(s[name])} />
    </Field>
  );
  return (
    <>
      <PageHeader title="Settings" subtitle="Branding, booking policies and contact details." />
      <ActionForm action="updateSettings" className="max-w-3xl space-y-6">
        <Card>
          <SectionTitle>Brand</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Business name">
              <input className="input" name="brand_name" defaultValue={s.brand_name} />
            </Field>
            <Field label="Logo letters">
              <input className="input" name="logo_mark" defaultValue={s.logo_mark} maxLength={4} />
            </Field>
            <Field label="Tagline" className="sm:col-span-2">
              <input className="input" name="tagline" defaultValue={s.tagline} />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {color("color_primary", "Primary")}
            {color("color_accent", "Accent")}
            {color("color_background", "Background")}
            {color("color_ink", "Text")}
            {color("color_sage", "Secondary")}
          </div>
        </Card>
        <Card>
          <SectionTitle>Home page</SectionTitle>
          <div className="grid gap-4">
            <Field label="Headline">
              <input className="input" name="hero_headline" defaultValue={s.hero_headline} />
            </Field>
            <Field label="Intro">
              <textarea className="input" name="hero_subtext" defaultValue={s.hero_subtext} />
            </Field>
            <Field label="Coach bio">
              <textarea className="input" name="coach_bio" defaultValue={s.coach_bio} rows={4} />
            </Field>
          </div>
        </Card>
        <Card>
          <SectionTitle>Booking rules</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cancellation window (hours)">
              <input className="input" type="number" name="cancellation_window_hours" defaultValue={s.cancellation_window_hours} min={0} />
            </Field>
            <Field label="Show sessions up to (days ahead)">
              <input className="input" type="number" name="booking_horizon_days" defaultValue={s.booking_horizon_days} min={1} />
            </Field>
            <Field label="Cancellation policy text" className="sm:col-span-2">
              <textarea className="input" name="cancellation_policy" defaultValue={s.cancellation_policy} />
            </Field>
            <div className="sm:col-span-2">
              <Toggle name="waitlist_auto_promote" defaultChecked={s.waitlist_auto_promote} label="Automatically move waitlisted players in when a spot opens" />
            </div>
          </div>
        </Card>
        <Card>
          <SectionTitle>Contact & legal</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <input className="input" name="contact_email" defaultValue={s.contact_email} />
            </Field>
            <Field label="Phone">
              <input className="input" name="contact_phone" defaultValue={s.contact_phone} />
            </Field>
            <Field label="Default location" className="sm:col-span-2">
              <input className="input" name="default_location" defaultValue={s.default_location} />
            </Field>
            <Field label="Community chat link (optional)" className="sm:col-span-2">
              <input className="input" name="community_url" defaultValue={s.community_url} placeholder="https://chat.whatsapp.com/…" />
            </Field>
            <Field label="Club disclaimer" className="sm:col-span-2">
              <textarea className="input" name="club_disclaimer" defaultValue={s.club_disclaimer} />
            </Field>
          </div>
        </Card>
        <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
          <Submit size="lg" icon="check" className="shadow-lg">
            Save settings
          </Submit>
        </div>
      </ActionForm>
      <p className="mt-6 text-xs text-ink/45">Data store: {data.storeKind === "memory" ? "Demo (this browser only)" : "Supabase"}</p>
    </>
  );
}
