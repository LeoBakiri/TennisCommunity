import { useEffect, useState, type ReactNode } from "react";
import { A, useAction } from "../nav";
import { ballBurst, Icon, SessionMark, TennisBall, type IconName } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Card, cx, Empty, HeroPanel, HeroStat, LinkButton, PageHeader, Place, SectionTitle, Submit } from "../kit";
import { calendarHref, countdown, MyBookingActions, SessionCard, skipTheLine, whenWord } from "../sessions";
import { ProfileFields } from "./public";
import type { FrameMeta } from "../shell";
import type { BookingRow, loadMyGame, loadMySessions, loadProfile, loadSchedule, SessionView } from "@/core/queries";
import { addDays, fmtDate, fmtDay, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange } from "@/core/time";
import { POINTS, POINTS_PER_LEVEL, skillLabel, WEEKLY_GOALS, type BadgeView, type Progress as GameProgress } from "@/core/progress";
import { lastMilestone, nextMilestone, SESSION_META, sessionTitle } from "@/core/util";
import type { SessionType } from "@/core/types";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;
type ScheduleData = D<typeof loadSchedule>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


// ───────────────────────── schedule ─────────────────────────

function Progress({ played, streak, game }: { played: number; streak: number; game: GameProgress }) {
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="text-[13px] text-paper/65">{played === 0 ? "Book one below and your tally starts here." : `${togo} more to reach ${goal}.`}</p>
        <A href="/my-game" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
          Level {game.level} · {game.into_level}/{POINTS_PER_LEVEL} points <Icon name="right" size={14} />
        </A>
      </div>
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
            <Progress played={me.played} streak={me.streak_weeks} game={me} />
            {meta.user && <LevelUp game={me} userId={meta.user.id} />}
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
                      <SessionCard key={s.id} s={s} signedIn={meta.signedIn} window={data.window} skip={skipTheLine(s, all)} />
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
              <Place p={r.session} className="mt-1 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              {r.booking.status === "confirmed" && (
                <a href={calendarHref(r.session)} target="_blank" rel="noreferrer" className={btn("ghost", "sm")} title="Add to Google Calendar">
                  <Icon name="calendar" size={15} /> Add to calendar
                </a>
              )}
              <MyBookingActions s={r.session} window={window} />
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
                  {r.booking.status === "cancelled" ? r.booking.cancel_reason.startsWith("Handed over") ? <Badge tone="blue">Handed over</Badge> : <BookingBadge status="cancelled" /> : r.booking.attended === false ? <Badge>Missed</Badge> : <Badge tone="green">Played</Badge>}
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

// ───────────────────────── my game ─────────────────────────

type GameData = D<typeof loadMyGame>;

/** How full this week's goal is, as a small ring. */
function GoalRing({ done, goal, size = 22 }: { done: number; goal: number; size?: number }) {
  const r = 14;
  const len = 2 * Math.PI * r;
  const part = Math.min(1, done / goal);
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" className="shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth="5" />
      {part > 0 && <circle cx="18" cy="18" r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${len * part} ${len}`} transform="rotate(-90 18 18)" />}
    </svg>
  );
}

function PointsBar({ game }: { game: GameProgress }) {
  return (
    <div className="mt-4 max-w-md">
      <div className="mb-1.5 flex justify-between gap-3 text-[12.5px] text-paper/70">
        <span>
          <b className="font-semibold text-paper">{game.into_level}</b> / {POINTS_PER_LEVEL} points
        </span>
        <span>
          {game.sessions_to_next} {game.sessions_to_next === 1 ? "session" : "sessions"} to Level {game.level + 1}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-paper/15">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(game.into_level / POINTS_PER_LEVEL) * 100}%` }} />
      </div>
    </div>
  );
}

function GameHero({ data }: { data: GameData }) {
  const g = data.me;
  return (
    <HeroPanel eyebrow={`Hi ${data.first_name} · Level ${g.level}`}>
      <h1 className="mt-2 max-w-md font-display text-3xl leading-tight font-semibold tracking-tight md:text-[2.4rem]">{g.level_name}</h1>
      <PointsBar game={g} />
      <dl className="mt-5 grid max-w-md grid-cols-3 gap-2">
        <HeroStat value={g.played} label={g.played === 1 ? "session played" : "sessions played"} />
        <HeroStat
          value={
            <span className="inline-flex items-center gap-1.5">
              {g.streak_weeks >= 2 && <Icon name="spark" size={17} className="text-accent" />}
              {g.streak_weeks}
            </span>
          }
          label="week streak"
        />
        <HeroStat
          value={
            <span className="inline-flex items-center gap-1.5">
              <GoalRing done={g.this_week} goal={g.goal} />
              {Math.min(g.this_week, g.goal)}/{g.goal}
            </span>
          }
          label="this week's goal"
        />
      </dl>
      {g.streak_weeks > 0 && (
        <p className="mt-3 text-[12.5px] text-paper/60">
          {g.freeze_left ? "Miss a week this month and your streak still holds: one freeze a month is on us." : "You've used this month's streak freeze. Play next week to keep it going."}
        </p>
      )}
    </HeroPanel>
  );
}

function WeeklyGoal({ game }: { game: GameProgress }) {
  const { run, pending } = useAction();
  const done = game.this_week >= game.goal;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Weekly goal</h2>
          <p className="mt-0.5 text-sm text-ink/60">
            {done ? `Done for this week. That's +${POINTS.goal} point.` : `${game.goal - game.this_week} more this week for +${POINTS.goal} point.`}
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-full border border-ink/12" role="group" aria-label="Sessions a week">
          {WEEKLY_GOALS.map((n) => (
            <button
              key={n}
              type="button"
              disabled={pending}
              aria-pressed={game.goal === n}
              onClick={() => game.goal !== n && run("setWeeklyGoal", { goal: n })}
              className={cx("px-3.5 py-1.5 text-[13px] font-medium", n > 1 && "border-l border-ink/12", game.goal === n ? "bg-brand text-paper" : "bg-card text-ink/65 hover:bg-paper")}
            >
              {n} a week
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Skills({ game }: { game: GameProgress }) {
  const any = game.skills.some((s) => s.level > 1);
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50">set by your coaches</span>}>Your skills</SectionTitle>
      <div className="space-y-2.5">
        {game.skills.map((s) => (
          <div key={s.key} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3">
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              {s.label}
              {s.recent && <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-bold text-brand">+1</span>}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-ink/[0.07]">
              <div className="h-full rounded-full bg-brand" style={{ width: `${s.level * 10}%` }} />
            </div>
            <span className="text-right text-[12px] text-ink/50 tabular-nums">Lv {s.level}</span>
          </div>
        ))}
      </div>
      {!any && <p className="mt-3 text-[13px] text-ink/55">After a session your coach can tap the skill that got better, and it moves up a level here.</p>}
    </Card>
  );
}

function Feed({ data }: { data: GameData }) {
  if (!data.feed.length) return null;
  return (
    <Card>
      <SectionTitle>From your coaches</SectionTitle>
      <ul className="space-y-3">
        {data.feed.map((f) => (
          <li key={f.id} className="flex gap-3">
            <Avatar name={f.coach} size={30} />
            <div className="min-w-0 text-[13.5px]">
              <p>
                <b className="font-semibold">{f.coach.split(" ")[0]}</b>{" "}
                {f.skills.length ? (
                  <>
                    moved up your <b className="font-semibold">{f.skills.map(skillLabel).join(", ")}</b>
                  </>
                ) : (
                  "left you a tip"
                )}
              </p>
              {f.tip && <p className="mt-0.5 text-ink/70">&ldquo;{f.tip}&rdquo;</p>}
              <p className="mt-0.5 text-[12px] text-ink/50">
                {fmtDay(f.at)} · {f.session}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const BADGE_ICONS: Record<string, IconName> = {
  s10: "flag",
  s25: "flag",
  s50: "flag",
  streak4: "spark",
  streak8: "spark",
  coach_pick: "whistle",
  goal4: "check",
  early: "sun",
  night: "clock",
  comeback: "repeat",
  all_round: "grid",
};

function BadgeIcon({ b }: { b: BadgeView }) {
  if (b.key === "first") return <TennisBall size={26} />;
  if (b.key === "accelerated") return <SessionMark type="performance_accelerator" size={24} className="fill-accent" />;
  return <Icon name={BADGE_ICONS[b.key] ?? "ball"} size={22} strokeWidth={2} />;
}

function Badges({ game }: { game: GameProgress }) {
  const earned = game.badges.filter((b) => b.earned);
  // Earned first, then the ones closest to done.
  const next = game.badges.filter((b) => !b.earned).sort((a, b) => b.have / b.need - a.have / a.need);
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50 tabular-nums">{earned.length} of {game.badges.length}</span>}>Badges</SectionTitle>
      <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6">
        {[...earned, ...next].map((b) => (
          <li key={b.key} className="text-center" title={b.hint}>
            <div className={cx("mx-auto flex h-13 w-13 items-center justify-center rounded-full", b.earned ? "bg-brand text-accent" : "border-[1.5px] border-dashed border-ink/25 text-ink/35")}>
              {b.earned ? <BadgeIcon b={b} /> : <Icon name="shield" size={18} />}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-tight font-medium">{b.label}</p>
            {!b.earned && <p className="line-clamp-2 text-[11px] leading-snug text-ink/50 tabular-nums">{b.need > 1 ? `${b.have} / ${b.need}` : b.hint}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

function Leaderboard({ data }: { data: GameData }) {
  const b = data.board;
  const row = (r: GameData["board"]["top"][number]) => (
    <li key={r.user_id} className={cx("grid grid-cols-[1.5rem_auto_1fr_auto] items-center gap-3 rounded-xl px-2.5 py-2 text-[14px]", r.me && "bg-accent/35")}>
      <span className="text-center font-display text-[13px] font-semibold text-ink/50 tabular-nums">{r.rank}</span>
      <Avatar name={r.name} size={28} />
      <span className={cx("truncate", r.me && "font-semibold")}>{r.me ? "You" : r.name}</span>
      <span className="font-semibold tabular-nums">{r.played}</span>
    </li>
  );
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50">sessions played</span>}>{monthName(b.month)} leaderboard</SectionTitle>
      {b.top.length ? (
        <ol className="space-y-0.5">
          {b.top.map(row)}
          {b.mine && (
            <>
              <li className="py-0.5 text-center text-ink/30" aria-hidden="true">
                ⋯
              </li>
              {row(b.mine)}
            </>
          )}
        </ol>
      ) : (
        <p className="text-sm text-ink/60">Nobody has played yet this month. Your first session puts you at the top.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[12.5px] text-ink/55">
        <span>
          {b.hidden
            ? "You're hidden from the leaderboard."
            : b.leading
              ? "You're top this month. Hold on to it!"
              : b.chase
                ? `${b.chase.gap} more ${b.chase.gap === 1 ? "session" : "sessions"} to pass ${b.chase.name}`
                : "Play a session to get on the board"}
          {` · resets in ${b.resets_in} ${b.resets_in === 1 ? "day" : "days"}`}
        </span>
        <ActionButton action="setLeaderboardHidden" input={{ hidden: !b.hidden }} variant="ghost" size="sm">
          {b.hidden ? "Show me" : "Hide me"}
        </ActionButton>
      </div>
    </Card>
  );
}

function HowPoints() {
  const rows: [string, string][] = [
    ["Group Session played", `${POINTS.group} points`],
    ["Performance Accelerator played", `${POINTS.performance_accelerator} points`],
    ["A coach moves up one of your skills", `+${POINTS.skill} point`],
    ["Weekly goal hit", `+${POINTS.goal} point`],
  ];
  return (
    <details className="card group p-5 md:p-6">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-semibold">
        How points work
        <Icon name="down" size={16} className="text-ink/50 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="mt-3 divide-y divide-ink/[0.06] text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-ink/70">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-ink/55">Every {POINTS_PER_LEVEL} points is a new level. No-shows earn nothing.</p>
    </details>
  );
}

export function MyGame({ data, meta }: { data: GameData; meta: FrameMeta }) {
  return (
    <>
      <GameHero data={data} />
      <div className="space-y-4">
        {data.focus && (
          <Card className="border-0 bg-sage shadow-none">
            <div className="flex items-center gap-2 text-[12.5px] text-ink/60">
              <Avatar name={data.focus.coach} size={26} />
              This week&apos;s focus · from {data.focus.coach.split(" ")[0]}, {fmtDay(data.focus.at)}
            </div>
            <p className="mt-2 font-display text-[17px] leading-snug font-semibold">&ldquo;{data.focus.tip}&rdquo;</p>
          </Card>
        )}
        <WeeklyGoal game={data.me} />
        <Skills game={data.me} />
        <Feed data={data} />
        <Badges game={data.me} />
        <Leaderboard data={data} />
        <HowPoints />
      </div>
      {meta.user && <LevelUp game={data.me} userId={meta.user.id} />}
    </>
  );
}

// ───────────────────────── level up ─────────────────────────

const seenKey = (userId: string) => `ltc.level.${userId}`;
function readSeen(userId: string): number | null {
  try {
    const v = localStorage.getItem(seenKey(userId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeSeen(userId: string, level: number) {
  try {
    localStorage.setItem(seenKey(userId), String(level));
  } catch {
    /* storage unavailable: the celebration just won't be remembered */
  }
}

/** A full-screen moment the first time a player opens the app after reaching a new level. */
function LevelUp({ game, userId }: { game: GameProgress; userId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const seen = readSeen(userId);
    // The first visit only remembers where they are, so nobody gets a celebration for old levels.
    if (seen === null || seen > game.level) writeSeen(userId, game.level);
    else if (seen < game.level) {
      setOpen(true);
      setTimeout(() => ballBurst({ x: window.innerWidth / 2, y: window.innerHeight * 0.32 }), 250);
    }
  }, [userId, game.level]);
  if (!open) return null;
  const close = () => {
    writeSeen(userId, game.level);
    setOpen(false);
  };
  const recent = game.skills.filter((s) => s.recent);
  const items: [IconName, ReactNode, string][] = [
    ...recent.map((s): [IconName, ReactNode, string] => ["whistle", `${s.label} Lv ${s.level}`, "Your coach moved it up"]),
    ...(game.streak_weeks >= 2 ? [["spark", `${game.streak_weeks}-week streak`, "Keep turning up"] as [IconName, ReactNode, string]] : []),
    ["ball", `${game.played} ${game.played === 1 ? "session" : "sessions"} played`, `${game.sessions_to_next} more ${game.sessions_to_next === 1 ? "session" : "sessions"} to Level ${game.level + 1}`],
  ];
  const r = 74;
  return (
    <div className="fade-in court-lines fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-brand p-6 text-center text-paper" role="dialog" aria-modal="true" aria-label={`Level ${game.level}`}>
      <div className="pointer-events-none absolute top-1/4 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />
      <div className="relative w-full max-w-xs">
        <div className="relative mx-auto mb-5 h-[170px] w-[170px]">
          <svg width="170" height="170" viewBox="0 0 170 170" aria-hidden="true">
            <circle cx="85" cy="85" r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth="10" />
            <circle cx="85" cy="85" r={r} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * r} 999`} transform="rotate(-90 85 85)" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[12px] font-semibold tracking-widest text-accent">LEVEL</span>
            <span className="font-display text-6xl leading-none font-bold">{game.level}</span>
          </div>
        </div>
        <div className="text-[13px] font-semibold tracking-wider text-accent uppercase">Level up</div>
        <h2 className="mt-1 font-display text-[2rem] leading-tight font-semibold tracking-tight">{game.level_name}</h2>
        <ul className="mt-5 space-y-2 text-left">
          {items.map(([icon, title, sub]) => (
            <li key={String(title)} className="flex items-center gap-3 rounded-xl bg-paper/[0.08] px-3 py-2.5 ring-1 ring-paper/10">
              <Icon name={icon} size={20} className="text-accent" />
              <span className="min-w-0">
                <b className="block text-sm font-semibold">{title}</b>
                <span className="text-[12px] text-paper/60">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
        <A href="/schedule" onClick={close} className={cx(btn("accent", "lg"), "mt-6 w-full justify-center")}>
          Book my next session
        </A>
        <button type="button" onClick={close} className="mt-3 text-sm text-paper/65 hover:text-paper">
          Close
        </button>
      </div>
    </div>
  );
}
