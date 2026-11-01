import { useState } from "react";
import { A, useNav } from "../nav";
import { Icon } from "../icons";
import {
  ActionButton,
  ActionForm,
  Avatar,
  Badge,
  BookingBadge,
  btn,
  Capacity,
  Card,
  cx,
  Dot,
  Empty,
  Field,
  LinkButton,
  Notice,
  PageHeader,
  SectionTitle,
  Stat,
  Submit,
  Tabs,
} from "../kit";
import { BookButton, priceLabel, ScheduleBoard, sessionName } from "../sessions";
import { ProfileFields } from "./public";
import type { FrameMeta } from "../shell";
import type { BookingRow, loadMemberBookings, loadMemberDashboard, loadMemberMessages, loadMemberProfile, loadRequestForm, loadSchedule, loadSessionDetail, SessionView } from "@/core/queries";
import { fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtKeyLong, fmtRange, fmtClock, relativeFromNow } from "@/core/time";
import { fmtMoney } from "@/core/util";
import { buildIcs, googleCalendarUrl } from "@/core/ics";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function CalendarButtons({ s, compact }: { s: SessionView; compact?: boolean }) {
  const ev = { uid: s.id, title: sessionName(s), starts_at: s.starts_at, ends_at: s.ends_at, location: s.location, description: `${s.program.name} with ${s.coaches.map((c) => c.full_name).join(" & ")}` };
  const download = () => {
    const blob = new Blob([buildIcs(ev)], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sessionName(s).replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button className={btn("outline", "sm")} onClick={download}>
        <Icon name="download" size={15} /> {compact ? "Calendar" : "Apple / Outlook"}
      </button>
      {!compact && (
        <a className={btn("outline", "sm")} href={googleCalendarUrl(ev)} target="_blank" rel="noreferrer">
          <Icon name="calendar" size={15} /> Google Calendar
        </a>
      )}
    </div>
  );
}

function CancelButton({ row, window, compact }: { row: { booking: { id: string; status: string }; session: SessionView }; window: number; compact?: boolean }) {
  const hours = (new Date(row.session.starts_at).getTime() - Date.now()) / 3600000;
  const late = row.booking.status !== "waitlisted" && hours < window;
  const leaving = row.booking.status === "waitlisted";
  return (
    <ActionButton
      action="cancelBooking"
      input={{ booking_id: row.booking.id }}
      variant="ghost"
      size="sm"
      icon={compact ? undefined : "x"}
      confirm={{
        title: leaving ? "Leave the waitlist?" : "Cancel this booking?",
        body: (
          <div className="space-y-3">
            <p>
              {sessionName(row.session)} · {fmtDateTime(row.session.starts_at)}
            </p>
            {late && <Notice tone="warn">This is within {window} hours of the start, so it counts as a late cancellation under the coach&apos;s policy.</Notice>}
            {!leaving && <p className="text-sm text-ink/55">If there&apos;s a waitlist, the next player gets your spot automatically.</p>}
          </div>
        ),
        label: leaving ? "Leave waitlist" : "Cancel booking",
        danger: true,
      }}
    >
      {leaving ? "Leave waitlist" : "Cancel"}
    </ActionButton>
  );
}

function DateBlock({ iso, dark }: { iso: string; dark?: boolean }) {
  const d = new Date(iso);
  const mon = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short" });
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", day: "numeric" });
  return (
    <div className={cx("flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl", dark ? "bg-paper/10" : "bg-paper")}>
      <span className={cx("text-[10.5px] font-semibold uppercase", dark ? "text-accent" : "text-brand")}>{mon}</span>
      <span className="font-display text-xl leading-none font-semibold">{day}</span>
    </div>
  );
}

function BookingLine({ row, window, showCancel = true }: { row: BookingRow; window: number; showCancel?: boolean }) {
  const s = row.session;
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <DateBlock iso={s.starts_at} />
        <div className="min-w-0">
          <A href={`/app/sessions/${s.id}`} className="flex items-center gap-2 font-semibold hover:underline">
            <Dot color={s.program.color} /> <span className="truncate">{sessionName(s)}</span>
          </A>
          <div className="mt-0.5 text-[13px] text-ink/55">
            {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}
            {s.coaches.length > 0 && ` · ${s.coaches.map((c) => c.full_name.split(" ")[0]).join(" & ")}`}
          </div>
          {row.booking.guest_name && <div className="mt-0.5 text-xs text-ink/50">With {row.booking.guest_name}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[72px] sm:pl-0">
        <BookingBadge status={row.booking.status} position={row.booking.waitlist_position} />
        {s.status === "cancelled" && <Badge tone="red">Session cancelled</Badge>}
        {showCancel && (row.booking.status === "confirmed" || row.booking.status === "pending" || row.booking.status === "waitlisted") && s.status !== "cancelled" && <CancelButton row={row} window={window} compact />}
      </div>
    </div>
  );
}

// ───────────────────────── dashboard ─────────────────────────

export function MemberDashboard({ data, meta }: { data: D<typeof loadMemberDashboard>; meta: FrameMeta }) {
  const first = meta.user!.full_name.split(" ")[0];
  const next = data.next;
  return (
    <>
      <PageHeader
        title={`${greeting()}, ${first}`}
        subtitle={next ? `Your next session is ${relativeFromNow(next.session.starts_at)}.` : "Ready for your next hit? Find a session below."}
        actions={
          <>
            <LinkButton href="/app/request" variant="outline" icon="whistle">
              Request a lesson
            </LinkButton>
            <LinkButton href="/app/book" icon="calendar">
              Book a session
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
        <div className="space-y-6">
          {next ? (
            <div className="court-lines relative overflow-hidden rounded-2xl bg-brand p-6 text-paper md:p-7">
              <div className="absolute -top-20 -right-10 h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative flex items-start justify-between gap-3">
                <span className="text-[12px] font-semibold tracking-[0.12em] text-paper/60 uppercase">Next up</span>
                {next.booking.status === "pending" ? <Badge tone="amber">Awaiting approval</Badge> : <Badge tone="accent">Confirmed</Badge>}
              </div>
              <div className="relative mt-4 flex items-center gap-4">
                <DateBlock iso={next.session.starts_at} dark />
                <div>
                  <h2 className="font-display text-2xl font-semibold tracking-tight">{sessionName(next.session)}</h2>
                  <p className="mt-0.5 text-paper/70">
                    {fmtDayLong(next.session.starts_at)} · {fmtRange(next.session.starts_at, next.session.ends_at)}
                  </p>
                </div>
              </div>
              <div className="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-paper/75">
                <span className="flex items-center gap-1.5">
                  <Icon name="pin" size={15} /> {next.session.location}
                </span>
                {next.session.coaches.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Icon name="whistle" size={15} /> {next.session.coaches.map((c) => c.full_name).join(" & ")}
                  </span>
                )}
                {next.session.capacity > 1 && (
                  <span className="flex items-center gap-1.5">
                    <Icon name="users" size={15} /> {next.session.booked} playing
                  </span>
                )}
              </div>
              <div className="relative mt-6 flex flex-wrap gap-2">
                <A href={`/app/sessions/${next.session.id}`} className={btn("accent", "sm")}>
                  View details
                </A>
              </div>
            </div>
          ) : (
            <Empty
              icon="calendar"
              title="Nothing booked yet"
              body="Grab a spot in a clinic or request a private lesson — it takes seconds."
              action={<LinkButton href="/app/book">Browse the schedule</LinkButton>}
            />
          )}

          {data.upcoming.length > 1 && (
            <div>
              <SectionTitle action={<A href="/app/bookings" className="text-sm font-medium text-brand hover:underline">All bookings</A>}>Coming up</SectionTitle>
              <div className="card divide-y divide-ink/[0.06]">
                {data.upcoming.slice(next ? 1 : 0).map((r) => (
                  <BookingLine key={r.booking.id} row={r} window={meta.settings.cancellation_window_hours} showCancel={false} />
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle action={<A href="/app/book" className="text-sm font-medium text-brand hover:underline">Full schedule</A>}>Open spots in the next two weeks</SectionTitle>
            {data.openSessions.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {data.openSessions.map((s) => (
                  <Card key={s.id} className="flex flex-col" pad>
                    <div className="flex items-center gap-2 text-[13px] font-medium text-ink/55">
                      <Dot color={s.program.color} /> {s.program.name}
                    </div>
                    <div className="mt-2 font-semibold">{sessionName(s)}</div>
                    <div className="mt-0.5 text-sm text-ink/60">
                      {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}
                    </div>
                    <div className="mt-3">
                      <Capacity booked={s.booked} capacity={s.capacity} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{priceLabel(s)}</span>
                      <BookButton s={s} signedIn />
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/55">You&apos;re in everything that&apos;s open — nice. New sessions are added every week.</p>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Upcoming" value={data.upcoming.length} icon="calendar" />
            <Stat label="Played this year" value={data.attended} icon="ball" />
          </div>
          {(data.unread > 0 || data.pendingRequests > 0) && (
            <div className="space-y-2">
              {data.unread > 0 && (
                <A href="/app/messages" className="card flex items-center gap-3 p-4 hover:shadow-md">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-ink">
                    <Icon name="message" size={17} />
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {data.unread} new message{data.unread > 1 ? "s" : ""} from your coach
                  </span>
                  <Icon name="right" size={16} className="text-ink/40" />
                </A>
              )}
              {data.pendingRequests > 0 && (
                <A href="/app/bookings?tab=requests" className="card flex items-center gap-3 p-4 hover:shadow-md">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage text-brand">
                    <Icon name="whistle" size={17} />
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {data.pendingRequests} lesson request{data.pendingRequests > 1 ? "s" : ""} pending
                  </span>
                  <Icon name="right" size={16} className="text-ink/40" />
                </A>
              )}
            </div>
          )}
          <div>
            <SectionTitle>From your coach</SectionTitle>
            {data.notes.length ? (
              <div className="space-y-3">
                {data.notes.map((n) => (
                  <Card key={n.id} pad className="!p-4">
                    <p className="text-[14.5px] leading-relaxed text-ink/80">“{n.body}”</p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-ink/50">
                      <Avatar name={n.author} size={22} /> {n.author} · {fmtDate(n.created_at)}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/55">Feedback your coach shares after sessions will show up here.</p>
            )}
          </div>
          <div>
            <SectionTitle>Announcements</SectionTitle>
            <div className="space-y-3">
              {data.announcements.map((a) => (
                <Card key={a.id} pad className="!p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{a.title}</h3>
                    {a.pinned && <Badge tone="accent">Pinned</Badge>}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink/65">{a.body}</p>
                  <p className="mt-2 text-xs text-ink/45">
                    {a.author} · {fmtDate(a.created_at)}
                  </p>
                </Card>
              ))}
              {!data.announcements.length && <p className="text-sm text-ink/55">No announcements right now.</p>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function MemberBook({ data, meta }: { data: D<typeof loadSchedule>; meta: FrameMeta }) {
  void meta;
  return (
    <>
      <PageHeader
        title="Book a session"
        subtitle="Pick a clinic, a group session or an open private slot. Times are Pacific."
        actions={
          <LinkButton href="/app/request" variant="outline" icon="whistle">
            Can&apos;t find a time? Request one
          </LinkButton>
        }
      />
      <ScheduleBoard data={data} signedIn base="/app/book" />
    </>
  );
}

export function MemberSession({ data, meta }: { data: D<typeof loadSessionDetail>; meta: FrameMeta }) {
  const s = data.session;
  const mine = s.my_booking;
  const past = data.hoursUntil <= 0;
  const program = data.program;
  return (
    <>
      <PageHeader
        back={{ href: "/app/book", label: "Schedule" }}
        eyebrow={
          <span className="flex items-center gap-2">
            <Dot color={s.program.color} /> {s.program.name}
          </span>
        }
        title={sessionName(s)}
        subtitle={`${fmtDayLong(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <div className="grid gap-5 sm:grid-cols-2">
              {[
                ["calendar", "When", `${fmtDayLong(s.starts_at)}, ${fmtRange(s.starts_at, s.ends_at)}`],
                ["pin", "Where", s.location],
                ["users", "Group", s.capacity === 1 ? "Private (1 player)" : `${s.booked} of ${s.capacity} spots taken${s.waitlist ? ` · ${s.waitlist} on waitlist` : ""}`],
                ["ball", "Level", s.skill_level || "All levels"],
              ].map(([icon, label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage/70 text-brand">
                    <Icon name={icon as "calendar"} size={17} />
                  </span>
                  <div>
                    <div className="text-xs text-ink/50">{label}</div>
                    <div className="text-[14.5px] font-medium">{value}</div>
                  </div>
                </div>
              ))}
            </div>
            {(s.description || program?.description) && <p className="mt-6 border-t border-ink/[0.06] pt-5 text-[15px] leading-relaxed whitespace-pre-line text-ink/70">{s.description || program?.description}</p>}
          </Card>
          {s.coaches.length > 0 && (
            <Card>
              <SectionTitle>Your coach{s.coaches.length > 1 ? "es" : ""}</SectionTitle>
              <div className="space-y-4">
                {s.coaches.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar name={c.full_name} size={42} />
                    <div>
                      <div className="font-semibold">{c.full_name}</div>
                      {c.bio && <p className="text-sm text-ink/60">{c.bio}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink/55">Price</span>
              <span className="font-display text-2xl font-semibold">{priceLabel(s)}</span>
            </div>
            {s.capacity > 1 && (
              <div className="mt-5">
                <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} />
              </div>
            )}
            <div className="mt-6">
              {s.status === "cancelled" ? (
                <Notice tone="warn">This session was cancelled by the coach.</Notice>
              ) : mine ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl bg-paper p-3">
                    <span className="text-sm font-medium">Your booking</span>
                    <BookingBadge status={mine.status} position={mine.waitlist_position} />
                  </div>
                  {mine.status === "waitlisted" && <p className="text-sm text-ink/60">We&apos;ll move you in automatically and let you know if a spot opens.</p>}
                  {mine.status === "pending" && <p className="text-sm text-ink/60">Your spot is held while the coach confirms.</p>}
                  {(mine.status === "confirmed" || mine.status === "pending") && !past && <CalendarButtons s={s} />}
                  {!past && (
                    <div className="border-t border-ink/[0.06] pt-4">
                      <CancelButton row={{ booking: mine, session: s }} window={data.policy.window} />
                    </div>
                  )}
                </div>
              ) : past ? (
                <Badge>This session has started</Badge>
              ) : (
                <BookButton s={s} signedIn full />
              )}
            </div>
            {data.myBooking?.status === "cancelled" && !mine && <p className="mt-3 text-xs text-ink/50">You cancelled a previous booking for this session.</p>}
          </Card>
          <Notice icon="shield">{data.policy.text}</Notice>
          <A href="/app/messages" className="flex items-center gap-2 px-1 text-sm font-medium text-brand hover:underline">
            <Icon name="message" size={16} /> Questions? Message the coach
          </A>
        </aside>
      </div>
      {void meta}
    </>
  );
}

// ───────────────────────── request ─────────────────────────

export function MemberRequest({ data }: { data: D<typeof loadRequestForm> }) {
  const [programId, setProgramId] = useState(data.selected);
  const program = data.programs.find((p) => p.id === programId);
  if (!data.programs.length) return <Empty title="Lesson requests are closed right now" body="Please check the schedule for open slots." />;
  return (
    <>
      <PageHeader back={{ href: "/app", label: "Home" }} title="Request a lesson" subtitle="Tell us when you'd like to play. Your coach will confirm a time — usually within a day." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <ActionForm action="createRequest">
            <fieldset>
              <legend className="label">Lesson type</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.programs.map((p) => (
                  <label key={p.id} className={cx("flex cursor-pointer gap-3 rounded-xl border p-4", programId === p.id ? "border-brand bg-sage/40" : "border-ink/12 hover:border-ink/25")}>
                    <input type="radio" name="program_id" value={p.id} checked={programId === p.id} onChange={() => setProgramId(p.id)} className="check mt-0.5" />
                    <span>
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-xs text-ink/55">
                        {p.duration_min} min · {p.price_cents === null ? "Price TBA" : fmtMoney(p.price_cents)}
                        {p.kind === "semi_private" ? " total" : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Preferred date">
                <input className="input" type="date" name="preferred_date" min={data.today} required />
              </Field>
              <Field label="Preferred start time">
                <select className="input" name="preferred_time" defaultValue="08:00">
                  {Array.from({ length: 30 }, (_, i) => {
                    const h = 6 + Math.floor(i / 2);
                    const m = i % 2 ? "30" : "00";
                    const v = `${String(h).padStart(2, "0")}:${m}`;
                    return (
                      <option key={v} value={v}>
                        {fmtClock(v)}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field label="Other times that work" className="sm:col-span-2" hint="e.g. any weekday before 9am, Saturday afternoons">
                <input className="input" name="alternatives" />
              </Field>
              {program?.kind === "semi_private" && (
                <>
                  <Field label="Partner's name">
                    <input className="input" name="partner_name" required />
                  </Field>
                  <Field label="Partner's email" hint="Optional">
                    <input className="input" type="email" name="partner_email" />
                  </Field>
                </>
              )}
              <Field label="Anything the coach should know?" className="sm:col-span-2">
                <textarea className="input" name="message" placeholder="What would you like to focus on?" />
              </Field>
            </div>
            <Submit className="mt-6 w-full sm:w-auto" icon="check">
              Send request
            </Submit>
          </ActionForm>
        </Card>
        <aside className="space-y-4">
          {program && (
            <Card>
              <div className="flex items-center gap-2">
                <Dot color={program.color} />
                <h2 className="font-semibold">{program.name}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink/65">{program.description}</p>
            </Card>
          )}
          <Notice>You&apos;ll get a confirmation by email as soon as your coach schedules it. You can also book open private slots directly from the schedule.</Notice>
        </aside>
      </div>
    </>
  );
}

// ───────────────────────── bookings ─────────────────────────

export function MemberBookings({ data, meta }: { data: D<typeof loadMemberBookings>; meta: FrameMeta }) {
  void meta;
  const tab = data.tab;
  return (
    <>
      <PageHeader title="My bookings" actions={<LinkButton href="/app/book" icon="plus">Book a session</LinkButton>} />
      <Tabs
        current={tab}
        items={[
          { key: "upcoming", label: "Upcoming", href: "/app/bookings", count: data.upcoming.length },
          { key: "requests", label: "Lesson requests", href: "/app/bookings?tab=requests", count: data.requests.filter((r) => r.status === "pending").length },
          { key: "past", label: "Past", href: "/app/bookings?tab=past" },
          { key: "cancelled", label: "Cancelled", href: "/app/bookings?tab=cancelled" },
        ]}
      />
      {tab === "upcoming" &&
        (data.upcoming.length ? (
          <div className="card divide-y divide-ink/[0.06]">
            {data.upcoming.map((r) => (
              <BookingLine key={r.booking.id} row={r} window={data.window} />
            ))}
          </div>
        ) : (
          <Empty icon="calendar" title="No upcoming bookings" action={<LinkButton href="/app/book">Find a session</LinkButton>} />
        ))}
      {tab === "past" &&
        (data.past.length ? (
          <div className="card divide-y divide-ink/[0.06]">
            {data.past.map((r) => (
              <div key={r.booking.id} className="flex items-center gap-4 px-4 py-3.5 md:px-5">
                <DateBlock iso={r.session.starts_at} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{sessionName(r.session)}</div>
                  <div className="text-[13px] text-ink/55">{fmtRange(r.session.starts_at, r.session.ends_at)}</div>
                </div>
                {r.booking.attended === true && <Badge tone="green">Attended</Badge>}
                {r.booking.attended === false && <Badge>Missed</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="ball" title="No past sessions yet" />
        ))}
      {tab === "cancelled" &&
        (data.cancelled.length ? (
          <div className="card divide-y divide-ink/[0.06]">
            {data.cancelled.map((r) => (
              <div key={r.booking.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{sessionName(r.session)}</div>
                  <div className="text-[13px] text-ink/55">
                    {fmtDateTime(r.session.starts_at)}
                    {r.booking.cancel_reason && ` · ${r.booking.cancel_reason}`}
                  </div>
                </div>
                <BookingBadge status={r.booking.status} />
                {r.booking.late_cancel && <Badge tone="amber">Late cancel</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="check" title="No cancellations" />
        ))}
      {tab === "requests" &&
        (data.requests.length ? (
          <div className="card divide-y divide-ink/[0.06]">
            {data.requests.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{r.program}</div>
                  <div className="text-[13px] text-ink/55">
                    Preferred {fmtKeyLong(r.preferred_date)} at {fmtClock(r.preferred_time)}
                    {r.partner_name && ` · with ${r.partner_name}`}
                  </div>
                  {r.admin_note && <div className="mt-1 text-[13px] text-ink/70">Coach: “{r.admin_note}”</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : r.status === "declined" ? "red" : "neutral"}>
                    {r.status === "pending" ? "Waiting for coach" : r.status[0].toUpperCase() + r.status.slice(1)}
                  </Badge>
                  {r.status === "approved" && r.session_id && (
                    <LinkButton href={`/app/sessions/${r.session_id}`} variant="outline" size="sm">
                      View lesson
                    </LinkButton>
                  )}
                  {r.status === "pending" && (
                    <ActionButton action="withdrawRequest" input={{ request_id: r.id }} variant="ghost" confirm={{ title: "Withdraw this request?", label: "Withdraw", danger: true }}>
                      Withdraw
                    </ActionButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="whistle" title="No lesson requests" body="Want a private or semi-private lesson at a specific time?" action={<LinkButton href="/app/request">Request a lesson</LinkButton>} />
        ))}
    </>
  );
}

// ───────────────────────── messages ─────────────────────────

export function Thread({ messages, meId, emptyText }: { messages: D<typeof loadMemberMessages>["messages"]; meId: string; emptyText: string }) {
  if (!messages.length) return <p className="py-10 text-center text-sm text-ink/50">{emptyText}</p>;
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const mine = m.sender_id === meId;
        return (
          <div key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[82%] rounded-2xl px-4 py-2.5", mine ? "rounded-br-md bg-brand text-paper" : "rounded-bl-md bg-paper text-ink")}>
              {!mine && <div className="mb-0.5 text-xs font-semibold text-brand">{m.sender}</div>}
              <p className="text-[14.5px] leading-relaxed whitespace-pre-line">{m.body}</p>
              <div className={cx("mt-1 text-[11px]", mine ? "text-paper/55" : "text-ink/45")}>{fmtDateTime(m.created_at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MemberMessages({ data, meta }: { data: D<typeof loadMemberMessages>; meta: FrameMeta }) {
  return (
    <>
      <PageHeader title="Messages" subtitle={`Questions about lessons, scheduling or your game — ${data.coaches.map((c) => c.full_name.split(" ")[0]).join(" & ")} will reply here.`} />
      <Card className="flex min-h-[420px] flex-col">
        <div className="flex-1">
          <Thread messages={data.messages} meId={meta.user!.id} emptyText="No messages yet. Say hi!" />
        </div>
        <ActionForm action="sendMessage" reset className="mt-5 flex items-end gap-2 border-t border-ink/[0.06] pt-4">
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <textarea name="body" className="input !min-h-[48px]" rows={2} placeholder="Write a message…" />
          </label>
          <Submit icon="arrow">Send</Submit>
        </ActionForm>
      </Card>
    </>
  );
}

// ───────────────────────── profile ─────────────────────────

export function MemberProfile({ data }: { data: D<typeof loadMemberProfile> }) {
  const nav = useNav();
  return (
    <>
      <PageHeader title="Your profile" subtitle="Keep your details current so your coach can plan the right sessions for you." />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <ActionForm action="updateMyProfile">
            <ProfileFields p={data.profile} />
            <Submit className="mt-6">Save changes</Submit>
          </ActionForm>
        </Card>
        <aside className="space-y-4">
          <Card>
            <SectionTitle>Coach feedback</SectionTitle>
            {data.notes.length ? (
              <ul className="space-y-4">
                {data.notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-accent pl-3">
                    <p className="text-sm text-ink/80">{n.body}</p>
                    <p className="mt-1 text-xs text-ink/45">
                      {n.author} · {fmtDate(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink/55">Notes your coach shares with you will appear here.</p>
            )}
          </Card>
          <button onClick={() => nav.auth.signOut()} className={cx(btn("outline"), "w-full")}>
            <Icon name="logout" size={17} /> Sign out
          </button>
        </aside>
      </div>
    </>
  );
}
