import { useState } from "react";
import { A } from "../nav";
import { Icon, SessionMark, TennisBall } from "../icons";
import { ActionForm, Badge, BookingBadge, btn, Card, cx, Empty, HeroPanel, HeroStat, LinkButton, PageHeader, SectionTitle, Submit } from "../kit";
import { calendarHref, CancelButton, countdown, SessionCard, whenWord } from "../sessions";
import { ProfileFields } from "./public";
import type { FrameMeta } from "../shell";
import type { BookingRow, loadMySessions, loadProfile, loadSchedule, SessionView } from "@/core/queries";
import { addDays, fmtDate, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange } from "@/core/time";
import { lastMilestone, nextMilestone, SESSION_META, sessionTitle } from "@/core/util";
import type { SessionType } from "@/core/types";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;
type ScheduleData = D<typeof loadSchedule>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


// ───────────────────────── schedule ─────────────────────────

function Progress({ played, streak }: { played: number; streak: number }) {
  const goal = nextMilestone(played);
  const prev = lastMilestone(played);
  const togo = goal - played;
  return (
    <div className="mt-6 rounded-xl bg-paper/[0.08] p-4 ring-1 ring-paper/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">
          {played === 0 ? "Your first session is waiting" : `${plural(played, "session")} played`}
        </span>
        {streak >= 2 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[12px] font-semibold text-ink">
            <Icon name="spark" size={13} /> {streak}-week streak
          </span>
        )}
      </div>
      {goal <= 10 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: goal }, (_, i) => (
            <TennisBall key={i} size={22} empty={i >= played} className={i < played ? "seat-taken" : "text-paper"} />
          ))}
        </div>
      ) : (
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-paper/15">
          <div className="h-full rounded-full bg-accent" style={{ width: `${((played - prev) / (goal - prev)) * 100}%` }} />
        </div>
      )}
      <p className="mt-2 text-[13px] text-paper/65">
        {played === 0 ? "Book one below and your tally starts here." : `${togo} more to reach ${goal}.`}
      </p>
    </div>
  );
}

function Hero({ data, meta }: { data: ScheduleData; meta: FrameMeta }) {
  const t = data.totals;
  const me = data.me;
  return (
    <HeroPanel eyebrow={me ? `Hi ${me.first_name}` : meta.settings.brand_name}>
        {me ? (
          <>
            {me.next ? (
              <>
                <h1 className="mt-2 max-w-md font-display text-3xl leading-tight font-semibold tracking-tight md:text-[2.4rem]">
                  You&apos;re on court {whenWord(me.next.starts_at, data.today)}.
                </h1>
                <A href="/my-sessions" className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-paper/10 py-1.5 pr-3 pl-2 text-sm ring-1 ring-paper/15 hover:bg-paper/15">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-paper">
                    <SessionMark type={me.next.session_type} size={14} />
                  </span>
                  <span className="truncate">
                    {sessionTitle(me.next)} · {fmtRange(me.next.starts_at, me.next.ends_at)}
                  </span>
                  {countdown(me.next.starts_at) && <span className="shrink-0 text-accent">{countdown(me.next.starts_at)}</span>}
                </A>
              </>
            ) : (
              <>
                <h1 className="mt-2 max-w-md font-display text-3xl leading-tight font-semibold tracking-tight md:text-[2.4rem]">Ready for your next hit?</h1>
                <p className="mt-2 max-w-md text-paper/70">
                  {t.open > 0 ? `${plural(t.open, "spot")} open across ${plural(t.sessions, "session")}. Grab one before they go.` : "Every session is full right now. Join a waitlist and you'll move in if a spot opens."}
                </p>
              </>
            )}
            <Progress played={me.played} streak={me.streak_weeks} />
          </>
        ) : (
          <>
            <h1 className="mt-2 max-w-md font-display text-[2rem] leading-[1.1] font-semibold tracking-tight md:text-[2.6rem]">Get on court this week.</h1>
            <p className="mt-3 max-w-md text-paper/70">Pick a session, book in two taps, and if it&apos;s full the waitlist moves you in when a spot opens.</p>
            {t.sessions > 0 && (
              <dl className="mt-6 grid max-w-md grid-cols-3 gap-2">
                {[
                  [t.sessions, t.sessions === 1 ? "session" : "sessions"],
                  [t.booked, t.booked === 1 ? "player in" : "players in"],
                  [t.open, t.open === 1 ? "spot open" : "spots open"],
                ].map(([n, label]) => (
                  <HeroStat key={label} value={n} label={String(label)} />
                ))}
              </dl>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
              <A href="/login?mode=signup&next=%2Fschedule" className={btn("accent", "lg")}>
                Join free <Icon name="arrow" size={17} />
              </A>
              <A href="/login?next=%2Fschedule" className="text-sm font-medium text-paper/75 hover:text-paper">
                I have an account
              </A>
            </div>
          </>
        )}
    </HeroPanel>
  );
}

function DayStrip({ data, shown }: { data: ScheduleData; shown: Set<string> }) {
  const last = data.days.at(-1)?.day ?? data.today;
  const all: string[] = [];
  for (let d = data.today; d <= last && all.length < 31; d = addDays(d, 1)) all.push(d);
  const byDay = new Map(data.days.map((x) => [x.day, x.sessions]));
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-2.5">
      {all.map((d) => {
        const list = byDay.get(d) ?? [];
        const on = shown.has(d);
        const mine = list.some((s) => s.my_booking?.status === "confirmed");
        return (
          <button
            key={d}
            type="button"
            disabled={!on}
            onClick={() => document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className={cx(
              "relative flex w-[54px] shrink-0 flex-col items-center rounded-xl border py-1.5 transition-colors",
              on ? "border-ink/10 bg-card hover:border-ink/30" : "border-transparent opacity-40",
              d === data.today && "border-brand/40 bg-sage/60",
            )}
            aria-label={`${fmtKeyLong(d)}: ${plural(list.length, "session")}`}
          >
            <span className="text-[10px] font-medium tracking-tight text-ink/50 uppercase">{d === data.today ? "Today" : fmtKeyWeekday(d)}</span>
            <span className="font-display text-lg leading-tight font-semibold tabular-nums">{fmtKeyNum(d)}</span>
            <span className="flex h-3.5 items-center gap-0.5">
              {list.slice(0, 3).map((s) => (
                <SessionMark key={s.id} type={s.session_type} size={11} />
              ))}
            </span>
            {mine && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-paper ring-2 ring-paper">
                <Icon name="check" size={10} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

type Filter = "all" | SessionType | "open";

function Filters({ value, onChange, sessions }: { value: Filter; onChange: (f: Filter) => void; sessions: SessionView[] }) {
  const count = (f: Filter) => sessions.filter((s) => matches(s, f)).length;
  const items: { key: Filter; label: string; type?: SessionType }[] = [
    { key: "all", label: "All" },
    { key: "group", label: SESSION_META.group.label, type: "group" },
    { key: "performance_accelerator", label: SESSION_META.performance_accelerator.label, type: "performance_accelerator" },
    { key: "open", label: "Spots open" },
  ];
  return (
    <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
      {items.map((it) => {
        const n = count(it.key);
        const on = value === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            aria-pressed={on}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
              on ? "border-brand bg-brand text-paper" : "border-ink/10 bg-card text-ink/75 hover:border-ink/25",
            )}
          >
            {it.type && <SessionMark type={it.type} size={13} />}
            {it.label}
            <span className={cx("tabular-nums", on ? "text-paper/60" : "text-ink/40")}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

const matches = (s: SessionView, f: Filter) => (f === "all" ? true : f === "open" ? s.spots_left > 0 : s.session_type === f);

function HowItWorks({ data }: { data: ScheduleData }) {
  const steps: [string, string, string][] = [
    ["calendar", "Pick a session", `Sessions are posted up to ${data.horizon} days ahead, with the coach, place and price on each.`],
    ["check", "Book in two taps", "Your spot is held straight away, and it shows up under My Sessions."],
    ["repeat", "Full? Join the waitlist", "If someone drops out, the first player waiting moves in automatically."],
  ];
  return (
    <section className="card p-5 md:p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">How it works</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map(([icon, title, body], i) => (
          <li key={title} className="flex gap-3 sm:flex-col">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage/70 text-brand">
              <Icon name={icon as "calendar"} size={19} />
              <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent text-[10.5px] font-bold text-ink">{i + 1}</span>
            </span>
            <span>
              <span className="block text-[15px] font-semibold">{title}</span>
              <span className="mt-0.5 block text-sm text-ink/60">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <A href="/login?mode=signup&next=%2Fschedule" className={cx(btn("primary"), "mt-5 w-full sm:w-auto")}>
        Create your free account
      </A>
    </section>
  );
}

export function ScheduleView({ data, meta }: { data: ScheduleData; meta: FrameMeta }) {
  const [filter, setFilter] = useState<Filter>("all");
  const all = data.days.flatMap((d) => d.sessions);
  const days = data.days.map((d) => ({ ...d, sessions: d.sessions.filter((s) => matches(s, filter)) })).filter((d) => d.sessions.length);
  const shown = new Set(days.map((d) => d.day));
  return (
    <>
      <Hero data={data} meta={meta} />
      {data.days.length ? (
        <>
          <div className="sticky top-16 z-20 -mx-4 mb-4 border-b border-ink/[0.06] bg-paper/90 px-4 pt-1 backdrop-blur-md">
            <DayStrip data={data} shown={shown} />
          </div>
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Coming up</h2>
              <span className="text-xs text-ink/50">Times are Pacific</span>
            </div>
            <Filters value={filter} onChange={setFilter} sessions={all} />
          </div>
          {days.length ? (
            <div className="space-y-5">
              {days.map(({ day, sessions }) => (
                <section key={day} id={`day-${day}`} className="card scroll-mt-40 overflow-hidden">
                  <h2 className="flex items-center justify-between border-b border-ink/[0.06] bg-paper/60 px-4 py-2.5 text-sm font-semibold md:px-5">
                    {fmtKeyLong(day)}
                    {day === data.today ? <Badge tone="accent">Today</Badge> : day === addDays(data.today, 1) ? <Badge>Tomorrow</Badge> : null}
                  </h2>
                  <div className="divide-y divide-ink/[0.06]">
                    {sessions.map((s) => (
                      <SessionCard key={s.id} s={s} signedIn={meta.signedIn} window={data.window} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Empty icon="filter" title="Nothing matches that filter" action={<button className={btn("outline", "sm")} onClick={() => setFilter("all")}>Show all sessions</button>} />
          )}
          {!meta.signedIn && (
            <div className="mt-6">
              <HowItWorks data={data} />
            </div>
          )}
          <p className="mt-5 px-1 text-sm text-ink/55">{data.policy}</p>
        </>
      ) : (
        <Empty icon="calendar" title="No sessions posted yet" body="New sessions are added every week." />
      )}
    </>
  );
}

// ───────────────────────── my sessions ─────────────────────────

function BookingGroup({ title, rows, window }: { title: string; rows: BookingRow[]; window: number }) {
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="card divide-y divide-ink/[0.06]">
        {rows.map((r) => (
          <div key={r.booking.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <SessionMark type={r.session.session_type} /> {sessionTitle(r.session)}
              </div>
              <div className="mt-0.5 text-sm text-ink/60">{fmtDayRange(r.session.starts_at, r.session.ends_at)}</div>
              <div className="text-sm text-ink/60">{r.session.location}</div>
            </div>
            <div className="flex items-center gap-2">
              {r.booking.status === "confirmed" && (
                <a href={calendarHref(r.session)} target="_blank" rel="noreferrer" className={btn("ghost", "sm")} title="Add to Google Calendar">
                  <Icon name="calendar" size={15} /> Add to calendar
                </a>
              )}
              <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />
              <CancelButton bookingId={r.booking.id} status={r.booking.status} session={r.session} window={window} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MyStats({ data }: { data: D<typeof loadMySessions> }) {
  const { played, streak_weeks } = data.stats;
  const goal = nextMilestone(played);
  const tiles: [string, number, string][] = [
    ["Coming up", data.confirmed.length, data.waitlisted.length ? `+ ${data.waitlisted.length} on a waitlist` : "booked"],
    ["Played", played, played ? `${goal - played} more to ${goal}` : "your tally starts here"],
    ["Week streak", streak_weeks, streak_weeks >= 2 ? "keep it going" : "play weekly to build one"],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map(([label, n, hint], i) => (
        <div key={label} className={cx("card p-3 sm:p-4", i === 0 && "court-lines border-brand bg-brand text-paper")}>
          <div className={cx("text-[12px] font-medium sm:text-[13px]", i === 0 ? "text-paper/70" : "text-ink/55")}>{label}</div>
          <div className="mt-1 flex items-center gap-1.5 font-display text-2xl leading-none font-semibold tabular-nums sm:text-3xl">
            {n}
            {i === 1 && n > 0 && <TennisBall size={18} />}
            {i === 2 && n >= 2 && <Icon name="spark" size={18} className="text-[#B5672C]" />}
          </div>
          <div className={cx("mt-1.5 text-[11.5px] leading-snug sm:text-[12.5px]", i === 0 ? "text-paper/60" : "text-ink/50")}>{hint}</div>
        </div>
      ))}
    </div>
  );
}

export function MySessions({ data }: { data: D<typeof loadMySessions> }) {
  const empty = !data.confirmed.length && !data.waitlisted.length;
  return (
    <>
      <PageHeader title="My Sessions" />
      <div className="space-y-6">
        <MyStats data={data} />
        {empty && <Empty icon="calendar" title="Nothing booked yet" action={<LinkButton href="/schedule">See the schedule</LinkButton>} />}
        <BookingGroup title="Upcoming" rows={data.confirmed} window={data.window} />
        <BookingGroup title="Waitlist" rows={data.waitlisted} window={data.window} />
        {data.history.length > 0 && (
          <details className="card p-4 md:px-5">
            <summary className="cursor-pointer text-sm font-semibold">History</summary>
            <ul className="mt-3 divide-y divide-ink/[0.06]">
              {data.history.map((r) => (
                <li key={r.booking.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 items-start gap-2">
                    <SessionMark type={r.session.session_type} size={15} className="mt-[2px]" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{sessionTitle(r.session)}</span>
                      <span className="text-ink/55">{fmtDate(r.session.starts_at)}</span>
                    </span>
                  </span>
                  {r.booking.status === "cancelled" ? <BookingBadge status="cancelled" /> : r.booking.attended === false ? <Badge>Missed</Badge> : <Badge tone="green">Played</Badge>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

// ───────────────────────── profile ─────────────────────────

export function ProfileView({ data }: { data: D<typeof loadProfile> }) {
  return (
    <>
      <PageHeader title="Profile" back={{ href: "/schedule", label: "Schedule" }} />
      <Card className="max-w-xl">
        <ActionForm action="updateMyProfile">
          <ProfileFields p={data.profile} />
          <Submit className="mt-6">Save changes</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
