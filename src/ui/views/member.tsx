import { useEffect, useState, type ReactNode } from "react";
import { A, useAction } from "../nav";
import { ballBurst, Icon, SessionMark, TennisBall, type IconName } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Card, cx, Empty, HeroPanel, HeroStat, LinkButton, Notice, PageHeader, Place, SectionTitle, Submit } from "../kit";
import { calendarHref, countdown, courtNote, MyBookingActions, SessionCard, skipTheLine, whenWord } from "../sessions";
import { ProfileFields } from "./public";
import type { FrameMeta } from "../shell";
import type { BookingRow, ClubFeed, loadMyGame, loadMySessions, loadProfile, loadSchedule, SessionView } from "@/core/queries";
import { addDays, fmtDate, fmtDateTime, fmtDay, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange } from "@/core/time";
import { levelName, MAX_SKILL_LEVEL, MY_GAME_LAUNCHED, POINTS, POINTS_PER_LEVEL, WEEKLY_GOALS, type BadgeView, type Progress as GameProgress } from "@/core/progress";
import { by, nextMilestone, SESSION_META, sessionTitle } from "@/core/util";
import type { SessionType, Skill } from "@/core/types";
import { FEED_DAYS, type ClubEvent } from "@/core/ical";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;
type ScheduleData = D<typeof loadSchedule>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


// ───────────────────────── schedule ─────────────────────────

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
                  {t.open > 0
                    ? `${plural(t.open, "spot")} open across ${plural(t.sessions, "session")}. Grab one before they go.`
                    : t.sessions > 0
                      ? "Every session is full right now. Join a waitlist and you'll move in if a spot opens."
                      : "No sessions are posted right now. New ones are added every week."}
                </p>
              </>
            )}
            {MY_GAME_LAUNCHED && (
              <A href="/my-game" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
                Level {me.level} · {me.into_level}/{POINTS_PER_LEVEL} points <Icon name="right" size={14} />
              </A>
            )}
            {MY_GAME_LAUNCHED && meta.user && <LevelUp game={me} userId={meta.user.id} />}
          </>
        ) : (
          <>
            <h1 className="mt-2 max-w-md font-display text-[2rem] leading-[1.1] font-semibold tracking-tight md:text-[2.6rem]">Get on court this week.</h1>
            <p className="mt-3 max-w-md text-paper/70">Pick a session, book in two taps, and if it&apos;s full the waitlist moves you in when a spot opens.</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
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
        // A filter that would show nothing is just noise.
        if (!n && it.key !== "all" && !on) return null;
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
    ["check", "Book in two taps", `Your spot is held straight away. Cancel free up to ${data.window} hours before; after that, offer your spot to someone else.`],
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
  // The day strip and filters help with a busy schedule; with a few sessions the list itself is quicker.
  const busy = all.length >= 6;
  return (
    <>
      <Hero data={data} meta={meta} />
      {data.days.length ? (
        <>
          {data.days.length >= 4 && (
            <div className="sticky top-16 z-20 -mx-4 mb-4 border-b border-ink/[0.06] bg-paper/90 px-4 pt-1 backdrop-blur-md">
              <DayStrip data={data} shown={shown} />
            </div>
          )}
          <div className="mb-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Coming up</h2>
              <span className="text-xs text-ink/50">Times are Pacific</span>
            </div>
            {busy && <Filters value={filter} onChange={setFilter} sessions={all} />}
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

/** Only while a two-court session is still short, so a booked player knows it isn't settled. */
function CourtLine({ s }: { s: SessionView }) {
  const note = courtNote(s);
  return note ? <div className="mt-1 text-xs font-medium text-[#8A5A10]">{note}</div> : null;
}

/** A clinic or private from the player's CourtReserve calendar. It's managed in CourtReserve, so there's nothing to do here. */
function ClubRow({ e }: { e: ClubEvent }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold">
          <Icon name="calendar" size={16} className="shrink-0 text-ink/45" /> {e.title}
        </div>
        <div className="mt-0.5 text-sm text-ink/60">{e.all_day ? fmtDay(e.starts_at) : fmtDayRange(e.starts_at, e.ends_at)}</div>
        <Place p={e} className="mt-1 text-sm" />
      </div>
      <Badge className="self-start sm:self-center">CourtReserve</Badge>
    </div>
  );
}

function BookingGroup({ title, rows, window, club = [] }: { title: string; rows: BookingRow[]; window: number; club?: ClubEvent[] }) {
  if (!rows.length && !club.length) return null;
  // El Patio bookings and CourtReserve events in one list, by start time.
  const items: { at: string; r?: BookingRow; e?: ClubEvent }[] = [...rows.map((r) => ({ at: r.session.starts_at, r })), ...club.map((e) => ({ at: e.starts_at, e }))].sort(by((i) => i.at));
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="card divide-y divide-ink/[0.06]">
        {items.map(({ r, e }) => !r ? <ClubRow key={`club:${e!.uid}`} e={e!} /> : (
          <div key={r.booking.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <SessionMark type={r.session.session_type} /> {sessionTitle(r.session)}
              </div>
              <div className="mt-0.5 text-sm text-ink/60">{fmtDayRange(r.session.starts_at, r.session.ends_at)}</div>
              <Place p={r.session} className="mt-1 text-sm" />
              <CourtLine s={r.session} />
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

/** Players paste their CourtReserve calendar link once; their club bookings then show in Upcoming. */
function ClubCalendar({ club }: { club: ClubFeed }) {
  if (club.connected) {
    return (
      <div className="space-y-3">
        {club.error && <Notice tone="warn">{club.error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-sage/50 px-4 py-2.5 text-sm">
          <span className="flex min-w-0 items-start gap-2 text-ink/70">
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-brand" />
            <span>
              CourtReserve connected
              {!club.error && <span className="text-ink/50"> · {club.events.length ? plural(club.events.length, "booking") : "nothing booked"} in the next {FEED_DAYS} days</span>}
            </span>
          </span>
          <ActionButton action="disconnectCourtReserve" input={{}} variant="ghost" confirm={{ title: "Disconnect CourtReserve?", body: "Your CourtReserve bookings stop showing here. Nothing changes in CourtReserve.", label: "Disconnect", danger: true }}>
            Disconnect
          </ActionButton>
        </div>
      </div>
    );
  }
  return (
    <div className="card p-4 md:px-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage text-brand">
          <Icon name="calendar" size={17} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Connect your CourtReserve calendar</div>
          <div className="text-ink/55">Your clinics and privates from CourtReserve show up here, next to your El Patio sessions.</div>
          <ActionForm action="connectCourtReserve" className="mt-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input name="url" className="input min-w-0 flex-1" placeholder="https://app.courtreserve.com/Online/PublicIcal/…" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="CourtReserve calendar link" />
              <Submit size="md" className="shrink-0">Connect</Submit>
            </div>
          </ActionForm>
          <details className="mt-3 text-ink/60">
            <summary className="cursor-pointer font-medium text-ink/75">Where do I find my link?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Sign in to CourtReserve and open your calendar.</li>
              <li>Choose the option to subscribe or sync your calendar, and copy the link it gives you.</li>
              <li>Paste it above. Only you can see it here.</li>
            </ol>
          </details>
        </div>
      </div>
    </div>
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
  const empty = !data.confirmed.length && !data.waitlisted.length && !data.club.events.length;
  return (
    <>
      <PageHeader title="My Sessions" />
      <div className="space-y-6">
        <MyStats data={data} />
        {empty && <Empty icon="calendar" title="Nothing booked yet" action={<LinkButton href="/schedule">See the schedule</LinkButton>} />}
        <BookingGroup title="Upcoming" rows={data.confirmed} window={data.window} club={data.club.events} />
        <BookingGroup title="Waitlist" rows={data.waitlisted} window={data.window} />
        <ClubCalendar club={data.club} />
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

/** A small "+2" tag: what something is worth. */
function Pts({ n, dim, className }: { n: number; dim?: boolean; className?: string }) {
  return <span className={cx("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums", dim ? "bg-ink/[0.06] text-ink/60" : "bg-accent text-brand", className)}>+{n}</span>;
}

/** Ten points to a level, one segment each, so every point shows. */
function PointsBar({ game }: { game: GameProgress }) {
  const nextName = levelName(game.level + 1);
  return (
    <div className="mt-4 max-w-md">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12.5px] text-paper/70">
        <span>
          <b className="font-display text-[17px] font-semibold text-paper tabular-nums">{game.into_level}</b> / {POINTS_PER_LEVEL} points
        </span>
        <span>
          {game.to_next} to Level {game.level + 1} · {nextName}
        </span>
      </div>
      <div className="grid grid-cols-10 gap-1" role="img" aria-label={`${game.into_level} of ${POINTS_PER_LEVEL} points`}>
        {Array.from({ length: POINTS_PER_LEVEL }, (_, i) => (
          <span
            key={i}
            className={cx("h-2.5 rounded-full", i < game.into_level ? "seat-taken bg-accent" : i === game.into_level ? "seat-next bg-paper/25 text-accent" : "bg-paper/15")}
            style={i < game.into_level ? { animationDelay: `${120 + i * 55}ms` } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function GameHero({ data }: { data: GameData }) {
  const g = data.me;
  return (
    <HeroPanel eyebrow={`Hi ${data.first_name} · Level ${g.level}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="mt-2 font-display text-3xl leading-tight font-semibold tracking-tight md:text-[2.4rem]">{g.level_name}</h1>
        {g.week_points > 0 && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[12.5px] font-bold text-brand">
            <Icon name="spark" size={13} /> +{g.week_points} this week
          </span>
        )}
      </div>
      <PointsBar game={g} />
      <dl className="mt-5 grid max-w-md grid-cols-3 gap-2">
        <HeroStat value={g.points} label="points in all" />
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
          label="this week"
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

/** One way to earn points next, with what it's worth. */
function NextRow({ icon, title, sub, pts, children }: { icon: ReactNode; title: ReactNode; sub: ReactNode; pts?: number; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage text-brand">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[14px] font-semibold">{title}</p>
          {pts !== undefined && <Pts n={pts} />}
        </div>
        <p className="mt-0.5 text-[13px] text-ink/60">{sub}</p>
        {children}
      </div>
    </li>
  );
}

/** The goal picker answers at once; the save happens behind it. */
function GoalPicker({ goal }: { goal: number }) {
  const { run } = useAction();
  const [shown, setShown] = useState(goal);
  useEffect(() => setShown(goal), [goal]);
  const pick = async (n: number) => {
    if (n === shown) return;
    const before = shown;
    setShown(n);
    const r = await run("setWeeklyGoal", { goal: n });
    if (!r.ok) setShown(before);
  };
  return (
    <div className="mt-2 inline-flex overflow-hidden rounded-full border border-ink/12" role="group" aria-label="Sessions a week">
      {WEEKLY_GOALS.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={shown === n}
          onClick={() => pick(n)}
          className={cx("px-3 py-1 text-[12.5px] font-medium transition-colors", n > 1 && "border-l border-ink/12", shown === n ? "bg-brand text-paper" : "bg-card text-ink/65 hover:bg-paper")}
        >
          {n} a week
        </button>
      ))}
    </div>
  );
}

function NextUp({ data }: { data: GameData }) {
  const g = data.me;
  const n = data.next;
  const goalLeft = Math.max(0, g.goal - g.this_week);
  const weakest = [...g.skills].sort((a, b) => a.level - b.level)[0];
  const badge = g.closest_badge;
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50">{g.to_next} to Level {g.level + 1}</span>}>Your next points</SectionTitle>
      <ul className="divide-y divide-ink/[0.06]">
        {n ? (
          <NextRow
            icon={<SessionMark type={n.session_type} size={18} />}
            title={
              <A href="/my-sessions" className="hover:underline">
                {n.title} · {fmtDateTime(n.starts_at)}
              </A>
            }
            sub={n.levels_up ? `Play it and you reach Level ${g.level + 1} · ${levelName(g.level + 1)}!` : `Play it and you're on ${g.into_level + n.earns}/${POINTS_PER_LEVEL}${n.goal_bonus ? ", weekly goal included" : ""}.`}
            pts={n.earns}
          />
        ) : (
          <NextRow
            icon={<Icon name="calendar" size={18} />}
            title="Book your next session"
            sub={`${POINTS.group} for a Group Session, ${POINTS.performance_accelerator} for a Performance Accelerator.`}
            pts={POINTS.group}
          >
            <LinkButton href="/schedule" size="sm" className="mt-2">
              See sessions
            </LinkButton>
          </NextRow>
        )}
        <NextRow
          icon={<GoalRing done={g.this_week} goal={g.goal} size={22} />}
          title={goalLeft ? `Weekly goal: ${goalLeft} more this week` : "Weekly goal hit this week"}
          sub={goalLeft ? `Play ${g.goal} ${g.goal === 1 ? "session" : "sessions"} by Sunday for a bonus point.` : "Nice. Your bonus point is in."}
          pts={POINTS.goal}
        >
          <GoalPicker goal={g.goal} />
        </NextRow>
        <NextRow
          icon={<Icon name="whistle" size={18} />}
          title={`Get your ${weakest.label} moving`}
          sub={`Every skill your coach moves up is +${POINTS.skill}. Ask them to work on your ${weakest.label.toLowerCase()} next time.`}
          pts={POINTS.skill}
        />
        {badge && (
          <NextRow
            icon={<BadgeIcon b={badge} />}
            title={`Closest badge: ${badge.label}`}
            sub={badge.need > 1 ? `${badge.have} of ${badge.need}. ${badge.hint}.` : `${badge.hint}.`}
          >
            {badge.need > 1 && (
              <div className="mt-2 h-1.5 max-w-60 overflow-hidden rounded-full bg-ink/[0.07]">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(badge.have / badge.need) * 100}%` }} />
              </div>
            )}
          </NextRow>
        )}
      </ul>
    </Card>
  );
}

/** Six skills on one shape: the further out, the better. Tap a skill to see its story. */
function SkillWheel({ game, selected, onSelect }: { game: GameProgress; selected: Skill; onSelect: (k: Skill) => void }) {
  const cxy = 170;
  const cy = 128;
  const R = 92;
  const at = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [cxy + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  // The outer ring sits a little past the best skill, so early progress already fills the shape.
  const top = Math.min(MAX_SKILL_LEVEL, Math.max(4, Math.max(...game.skills.map((s) => s.level)) + 1));
  const ring = (frac: number) => game.skills.map((_, i) => at(i, R * frac).join(",")).join(" ");
  const shape = game.skills.map((s, i) => at(i, (R * s.level) / top).join(",")).join(" ");
  return (
    <svg viewBox="0 0 340 262" className="mx-auto block w-full max-w-[22rem]" role="group" aria-label="Your skills">
      {Array.from({ length: top }, (_, i) => (i + 1) / top).map((f) => (
        <polygon key={f} points={ring(f)} fill={f === 1 ? "var(--paper)" : "none"} stroke="var(--ink)" strokeOpacity={0.09} />
      ))}
      {game.skills.map((_, i) => {
        const [x, y] = at(i, R);
        return <line key={i} x1={cxy} y1={cy} x2={x} y2={y} stroke="var(--ink)" strokeOpacity={0.07} />;
      })}
      <polygon points={shape} fill="var(--accent)" fillOpacity={0.55} stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" style={{ transition: "all .5s" }} />
      {game.skills.map((s, i) => {
        const [x, y] = at(i, (R * s.level) / top);
        return <circle key={s.key} cx={x} cy={y} r={s.key === selected ? 5.5 : 3.5} fill="var(--brand)" stroke="var(--card)" strokeWidth={1.5} />;
      })}
      {game.skills.map((s, i) => {
        const [x, y] = at(i, R + 22);
        const anchor = Math.abs(x - cxy) < 4 ? "middle" : x > cxy ? "start" : "end";
        const on = s.key === selected;
        return (
          <g
            key={s.key}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${s.label}, level ${s.level}`}
            onClick={() => onSelect(s.key)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(s.key))}
            className="cursor-pointer outline-none"
          >
            <rect x={anchor === "start" ? x - 8 : anchor === "end" ? x - 92 : x - 50} y={y - 17} width={100} height={30} fill="transparent" />
            <text x={x} y={y - 2} textAnchor={anchor} className={cx("text-[13px]", on ? "font-bold" : "font-medium")} fill={on ? "var(--brand)" : "var(--ink)"} fillOpacity={on ? 1 : 0.75}>
              {s.label}
            </text>
            <text x={x} y={y + 12} textAnchor={anchor} className="text-[11px] font-semibold" fill="var(--ink)" fillOpacity={0.45}>
              Lv {s.level}
              {s.recent ? " ▲" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Skills({ data }: { data: GameData }) {
  const g = data.me;
  // Open on the skill a coach moved most recently, or the first one.
  const latest = (k: Skill) => data.history[k][0]?.at ?? "";
  const start = g.skills.reduce((best, x) => (latest(x.key) > latest(best.key) ? x : best)).key;
  const [sel, setSel] = useState<Skill>(start);
  const s = g.skills.find((x) => x.key === sel)!;
  const story = data.history[sel];
  const [all, setAll] = useState(false);
  const any = g.skills.some((x) => x.level > 1);
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50">tap a skill</span>}>Your game</SectionTitle>
      {data.focus && (
        <div className="mb-4 rounded-xl bg-sage p-4">
          <div className="flex items-center gap-2 text-[12.5px] text-ink/60">
            <Avatar name={data.focus.coach} size={24} />
            Your focus · from {data.focus.coach}, {fmtDay(data.focus.at)}
          </div>
          <p className="mt-1.5 font-display text-[16.5px] leading-snug font-semibold">&ldquo;{data.focus.tip}&rdquo;</p>
        </div>
      )}
      <div className="md:grid md:grid-cols-[1fr_1fr] md:items-center md:gap-6">
        <SkillWheel game={g} selected={sel} onSelect={(k) => (setSel(k), setAll(false))} />
        <div key={sel} className="fade-in mt-2 rounded-xl border border-ink/[0.07] p-4 md:mt-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-[19px] font-semibold">{s.label}</h3>
            <span className="text-[13px] font-semibold text-ink/55 tabular-nums">
              Lv {s.level} / {MAX_SKILL_LEVEL}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-10 gap-1" aria-hidden="true">
            {Array.from({ length: MAX_SKILL_LEVEL }, (_, i) => (
              <span key={i} className={cx("h-2 rounded-full", i < s.level ? "bg-brand" : i === s.level ? "bg-accent" : "bg-ink/[0.07]")} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-ink/60">
            {s.raised ? `Moved up ${s.raised === 1 ? "once" : `${s.raised} times`} · +${POINTS.skill * s.raised} points so far.` : "Not moved up yet."}
            {s.level < MAX_SKILL_LEVEL && ` One more tap from a coach takes it to Lv ${s.level + 1} (+${POINTS.skill}).`}
          </p>
          {story.length > 0 && (
            <ul className="mt-3 space-y-2.5 border-t border-ink/[0.06] pt-3">
              {(all ? story : story.slice(0, 2)).map((h, i) => (
                <li key={i} className="flex gap-2.5 text-[13px]">
                  <Avatar name={h.coach} size={24} />
                  <div className="min-w-0">
                    <p>
                      <b className="font-semibold">{h.coach}</b> <span className="text-ink/50">· {fmtDay(h.at)}</span>
                    </p>
                    {h.tip && <p className="mt-0.5 text-ink/70">&ldquo;{h.tip}&rdquo;</p>}
                  </div>
                </li>
              ))}
              {story.length > 2 && !all && (
                <li>
                  <button type="button" onClick={() => setAll(true)} className="text-[13px] font-semibold text-brand hover:underline">
                    Show all {story.length}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      {!any && <p className="mt-3 text-[13px] text-ink/55">After a session your coach taps the skills that got better. Each one grows your shape here and earns +{POINTS.skill}.</p>}
    </Card>
  );
}

/** Where every point came from, one line per session. */
function PointsLog({ data }: { data: GameData }) {
  const [all, setAll] = useState(false);
  const g = data.me;
  if (!data.log.length) return null;
  const rows = all ? data.log : data.log.slice(0, 4);
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50 tabular-nums">{g.points} from {plural(g.played, "session")}</span>}>Points history</SectionTitle>
      <ul className="divide-y divide-ink/[0.06]">
        {rows.map((e) => (
          <li key={e.key} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage">{e.session_type ? <SessionMark type={e.session_type} size={16} /> : <Icon name="whistle" size={16} className="text-brand" />}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13.5px]">
                  <b className="font-semibold">{e.title}</b> <span className="text-ink/50">· {fmtDay(e.at)}</span>
                </p>
                <span className={cx("font-display text-[15px] font-semibold tabular-nums", e.total ? "text-brand" : "text-ink/40")}>+{e.total}</span>
              </div>
              {e.parts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.parts.map((p, i) => (
                    <span key={i} className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-medium", p.label === "Played" ? "bg-ink/[0.05] text-ink/65" : "bg-accent/45 text-brand")}>
                      {p.label} +{p.points}
                    </span>
                  ))}
                </div>
              )}
              {e.tip && (
                <p className="mt-1 text-[12.5px] text-ink/60">
                  {e.coach}: &ldquo;{e.tip}&rdquo;
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.log.length > 4 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 text-[13px] font-semibold text-brand hover:underline">
          {all ? "Show less" : `Show all ${data.log.length}`}
        </button>
      )}
      <HowPoints />
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
  const list = [...earned, ...next];
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 8);
  const pick = list.find((b) => b.key === open);
  return (
    <Card>
      <SectionTitle action={<span className="text-[12.5px] text-ink/50 tabular-nums">{earned.length} of {game.badges.length}</span>}>Badges</SectionTitle>
      <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-8">
        {shown.map((b) => (
          <li key={b.key} className="text-center">
            <button type="button" onClick={() => setOpen(open === b.key ? null : b.key)} aria-expanded={open === b.key} className="group w-full">
              <span
                className={cx(
                  "mx-auto flex h-13 w-13 items-center justify-center rounded-full transition-transform group-hover:scale-105",
                  b.earned ? "bg-brand text-accent" : "border-[1.5px] border-dashed border-ink/25 text-ink/35",
                  open === b.key && "ring-2 ring-accent ring-offset-2",
                )}
              >
                {b.earned ? <BadgeIcon b={b} /> : <Icon name="shield" size={18} />}
              </span>
              <span className="mt-1.5 block text-[11.5px] leading-tight font-medium">{b.label}</span>
              {!b.earned && b.need > 1 && <span className="block text-[11px] text-ink/50 tabular-nums">{b.have} / {b.need}</span>}
            </button>
          </li>
        ))}
      </ul>
      {pick && (
        <p className="fade-in mt-4 rounded-xl bg-paper px-3.5 py-2.5 text-[13px]">
          <b className="font-semibold">{pick.label}</b> · {pick.earned ? "Earned." : `${pick.hint}${pick.need > 1 ? ` (${pick.have} of ${pick.need})` : ""}.`}
        </p>
      )}
      {list.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 text-[13px] font-semibold text-brand hover:underline">
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </Card>
  );
}

const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

function Leaderboard({ data }: { data: GameData }) {
  const b = data.board;
  const { run } = useAction();
  const [hidden, setHidden] = useState(b.hidden);
  useEffect(() => setHidden(b.hidden), [b.hidden]);
  const toggle = async () => {
    const next = !hidden;
    setHidden(next);
    const r = await run("setLeaderboardHidden", { hidden: next });
    if (!r.ok) setHidden(!next);
  };
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
      {b.chase && !hidden && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-sage px-3 py-2 text-[13px] font-medium">
          <Icon name="arrow" size={15} className="text-brand" /> {b.chase.gap} more {b.chase.gap === 1 ? "session" : "sessions"} to pass {b.chase.name}
        </p>
      )}
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
          {hidden ? "You're hidden from the leaderboard." : b.leading ? "You're top this month. Hold on to it!" : !b.chase ? "Play a session to get on the board." : "First name and last initial only."}
          {` · resets in ${b.resets_in} ${b.resets_in === 1 ? "day" : "days"}`}
        </span>
        <button type="button" onClick={toggle} className={btn("ghost", "sm")}>
          {hidden ? "Show me" : "Hide me"}
        </button>
      </div>
    </Card>
  );
}

function HowPoints() {
  const rows: [string, string][] = [
    ["Group Session played", `+${POINTS.group}`],
    ["Performance Accelerator played", `+${POINTS.performance_accelerator}`],
    ["A coach moves up one of your skills", `+${POINTS.skill} each`],
    ["Weekly goal hit", `+${POINTS.goal}`],
  ];
  return (
    <details className="group mt-4 border-t border-ink/[0.06] pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-ink/70">
        How points work
        <Icon name="down" size={15} className="text-ink/50 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="mt-2 divide-y divide-ink/[0.06] text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <dt className="text-ink/70">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[12.5px] text-ink/55">Every {POINTS_PER_LEVEL} points is a new level. No-shows earn nothing.</p>
    </details>
  );
}

export function MyGame({ data, meta }: { data: GameData; meta: FrameMeta }) {
  return (
    <>
      <GameHero data={data} />
      <div className="space-y-4">
        <NextUp data={data} />
        <Skills data={data} />
        <PointsLog data={data} />
        <Badges game={data.me} />
        <Leaderboard data={data} />
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
