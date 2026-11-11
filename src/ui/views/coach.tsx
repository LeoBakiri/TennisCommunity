import { useEffect, useState } from "react";
import { A, useAction, useNav, withQuery } from "../nav";
import { Icon, SessionMark } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, btn, Card, cx, Dot, Empty, Field, HeroPanel, HeroStat, LinkButton, Notice, PageHeader, Place, SectionTitle, Spinner, Stat, Submit, Tabs, Toggle } from "../kit";
import { countdown, WeekGrid, WeekNav, whenWord } from "../sessions";
import { LocationCourt, TimeSelect } from "./admin";
import type { loadCoachClient, loadCoachClients, loadCoachEarnings, loadCoachSchedule, loadCoachSession, loadLessonEditor } from "@/core/queries";
import type { Client, CoachCalendar, CommissionRule, Lesson, LessonKind, Skill } from "@/core/types";
import { addDays, dateKey, fmtClock, fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtKeyLong, fmtKeyWeekday, fmtRange, fmtTime, fmtWeekRange, startOfWeek, timeKey } from "@/core/time";
import { LESSON_META, lessonTitle, placeLabel, SESSION_META, sessionTitle } from "@/core/util";
import { commissionUnder, ruleFor, type Period } from "@/core/earnings";
import { CLIENT_STATUS, nameKey, REBOOK_DAYS, whatsappHref } from "@/core/clients";
import { POINTS, SKILLS } from "@/core/progress";

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

function CoachHero({ data }: { data: D<typeof loadCoachSchedule> }) {
  const s = data.summary;
  const p = data.players;
  const thisWeek = data.monday === startOfWeek(data.today);
  const next = thisWeek ? data.next : null;
  const onNow = next && next.starts_at <= data.nowIso;
  return (
    <HeroPanel eyebrow={`Hi ${data.first_name}`} compact>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2 className="mt-1 font-display text-2xl leading-tight font-semibold tracking-tight md:text-[1.75rem]">
            {!thisWeek ? `Week of ${fmtWeekRange(data.monday)}` : onNow ? "You're on court now." : next ? `Next up ${whenWord(next.starts_at, data.today)}.` : "Nothing else on this week."}
          </h2>
          {next && (
            <A href={next.href} className="mt-2.5 inline-flex max-w-full items-center gap-2 rounded-full bg-paper/10 py-1.5 pr-3 pl-2 text-sm ring-1 ring-paper/15 hover:bg-paper/15">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper">
                {next.session_type ? <SessionMark type={next.session_type} size={14} /> : <Dot color={next.color} />}
              </span>
              <span className="truncate">
                {next.title} · {fmtRange(next.starts_at, next.ends_at)}
              </span>
              {(onNow || countdown(next.starts_at)) && <span className="shrink-0 text-accent">{onNow ? "now" : countdown(next.starts_at)}</span>}
            </A>
          )}
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[30rem]">
          <HeroStat value={s.community} label={s.community === 1 ? "community session" : "community sessions"} />
          <HeroStat value={s.lessons} label={s.lessons === 1 ? "lesson" : "lessons"} />
          <HeroStat value={s.hours} label="hours on court" />
          <HeroStat value={p.booked} label={`players booked${p.waitlist ? ` · ${p.waitlist} waiting` : ""}`}>
            {p.capacity > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper/15">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (p.booked / p.capacity) * 100)}%` }} />
              </div>
            )}
          </HeroStat>
        </dl>
      </div>
    </HeroPanel>
  );
}

export function CoachSchedule({ data }: { data: D<typeof loadCoachSchedule> }) {
  const addHref = (kind: LessonKind, date?: string, time?: string) => withQuery("/coach/lessons/new", { kind, date, time });
  const nav = useNav();
  const calendarCard = <GoogleCalendarCard calendar={data.calendar} live={data.live} />;
  // Up top only when it needs the coach; once syncing fine it sits under the week so the calendar shows first.
  const calendarUp = !data.calendar || data.calendar.status === "needs_reconnect" || !!CONNECT_RESULT[nav.search.google];
  return (
    <>
      <PageHeader
        title="My Schedule"
        actions={
          <LinkButton href={addHref("private")} icon="plus">
            Add Lesson
          </LinkButton>
        }
      />
      <CoachHero data={data} />
      {calendarUp && calendarCard}
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
      {!calendarUp && <div className="mt-5">{calendarCard}</div>}
    </>
  );
}

// ───────────────────────── lesson ─────────────────────────

/** Live "you keep" line under the price, with the club's commission when the place has one. */
function LessonTakeHome({ lesson, rules, draft }: { lesson: Lesson | null; rules: CommissionRule[]; draft: { price: string; location: string; minutes: number } }) {
  const dollars = Number(draft.price.replace(/[$,]/g, ""));
  if (!draft.price.trim() || !Number.isFinite(dollars)) return null;
  const start = lesson ? new Date(lesson.starts_at) : new Date(0);
  const priced = { price_cents: Math.round(dollars * 100), location: draft.location, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + draft.minutes * 60000).toISOString() };
  // Same rule as saving: an unchanged lesson keeps the commission it was saved with.
  const unchanged = lesson && lesson.commission_cents !== null && lesson.price_cents === priced.price_cents && lesson.location === priced.location && lesson.ends_at === priced.ends_at;
  const rule = ruleFor(draft.location, rules);
  const cut = unchanged ? lesson.commission_cents! : rule ? commissionUnder(rule, priced) : 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-sage/50 px-4 py-3 text-sm sm:col-span-2">
      <span className="text-ink/65">{rule || unchanged ? `${rule?.place ?? "Club"} commission${rule ? ` (${ruleText(rule)})` : ""}: −${usd(cut)}` : "No club commission at this location"}</span>
      <span className="font-semibold">You keep {usd(priced.price_cents - cut)}</span>
    </div>
  );
}

export function LessonEditor({ data }: { data: D<typeof loadLessonEditor> }) {
  const l = data.lesson;
  const p = data.prefill;
  const [kind, setKind] = useState<LessonKind>(l?.kind ?? p!.kind);
  const date = l ? dateKey(l.starts_at) : p!.date;
  const time = l ? timeKey(l.starts_at) : p!.time;
  const duration = l ? Math.round((new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime()) / 60000) : p!.duration;
  const semi = kind === "semi_private";
  const [money, setMoney] = useState({ price: l ? (l.price_cents == null ? "" : String(l.price_cents / 100)) : p!.price, location: l?.location ?? p!.location, minutes: duration });
  const [repeat, setRepeat] = useState(1);
  const [day, setDay] = useState(date);
  const cards = (l?.client_names ?? []).flatMap((n) => (data.cardIds[nameKey(n)] ? [{ name: n, id: data.cardIds[nameKey(n)] }] : []));
  return (
    <>
      <PageHeader
        back={data.back ? { href: data.back, label: "Client" } : { href: "/coach", label: "My Schedule" }}
        title={l ? LESSON_META[l.kind].label : "Add Lesson"}
        subtitle={l ? `${fmtDayLong(l.starts_at)} · ${fmtRange(l.starts_at, l.ends_at)}` : `${fmtKeyLong(date)} · ${fmtClock(time)}`}
      />
      <div className="max-w-2xl space-y-4">
        <Card>
          <ActionForm action="saveLesson" hidden={{ id: l?.id ?? "", kind, back: data.back, repeat_weeks: l ? 1 : repeat }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1 sm:col-span-2" role="radiogroup" aria-label="Lesson type">
                {(["private", "semi_private"] as const).map((k) => (
                  <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("rounded-lg py-2 text-sm font-semibold", kind === k ? "bg-card shadow-sm" : "text-ink/55")}>
                    {LESSON_META[k].label}
                  </button>
                ))}
              </div>
              <Field label={semi ? "Players / clients" : "Player / client name"} hint={semi ? "Separate names with commas" : "Doesn't need to be a community member"} className="sm:col-span-2">
                <input className="input" name="client_names" list="lesson-clients" defaultValue={l?.client_names.join(", ") ?? p!.client} required />
                <datalist id="lesson-clients">
                  {data.clients.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                {cards.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px]">
                    {cards.map((c) => (
                      <A key={c.id} href={`/coach/clients/${c.id}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                        <Icon name="user" size={13} /> {c.name}'s card
                      </A>
                    ))}
                  </span>
                )}
              </Field>
              <Field label="Date">
                <input className="input" type="date" name="date" defaultValue={date} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label="Start time (Pacific)">
                <TimeSelect name="time" value={time} />
              </Field>
              <Field label="Duration (minutes)">
                <input className="input" type="number" name="duration_min" min={15} step={15} defaultValue={duration} onChange={(e) => setMoney({ ...money, minutes: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Price (USD)" hint={semi ? "Total for all players" : "Leave empty if it's not set yet"}>
                <input className="input" name="price" inputMode="decimal" defaultValue={money.price} onChange={(e) => setMoney({ ...money, price: e.target.value })} />
              </Field>
              <LocationCourt location={money.location} court={l?.court ?? null} wide places={data.places} onLocation={(v) => setMoney({ ...money, location: v })} />
              <LessonTakeHome lesson={l} rules={data.rules} draft={money} />
              {!l && (
                <Field label="Repeat" hint={repeat > 1 && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${repeat} lessons, the last on ${fmtKeyLong(addDays(day, (repeat - 1) * 7))}. Weeks you're already busy are skipped.` : "Book the same time every week, up to six months ahead"} className="sm:col-span-2">
                  <select className="input" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} aria-label="Repeat">
                    <option value={1}>Just this once</option>
                    {[2, 3, 4, 6, 8, 10, 12, 16, 20, 26].map((w) => (
                      <option key={w} value={w}>
                        Every week for {w} weeks
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="sm:col-span-2">
                <Toggle name="paid" defaultChecked={!!l?.paid_at} label="Paid" hint={repeat > 1 ? "Marks only the first lesson paid. Unpaid past lessons show under Owed to you in Earnings." : "Turn on once the player has paid you. Unpaid past lessons show under Owed to you in Earnings."} />
              </div>
              <Field label="Notes" hint="What you worked on and what's next. Shows on the client's card." className="sm:col-span-2">
                <textarea className="input" name="notes" defaultValue={l?.notes ?? ""} />
              </Field>
            </div>
            <Submit className="mt-6" icon="check">
              {l ? "Save lesson" : repeat > 1 ? `Add ${repeat} lessons` : "Add lesson"}
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

/** After a session: tap what got better for a player who came, and leave a tip they'll see as their focus. */
function SkillTaps({ bookingId, name, saved }: { bookingId: string; name: string; saved: { skills: Skill[]; tip: string } | undefined }) {
  const { run, pending } = useAction();
  const [skills, setSkills] = useState<Skill[]>(saved?.skills ?? []);
  const [tip, setTip] = useState(saved?.tip ?? "");
  const [writing, setWriting] = useState(false);
  const savedKey = JSON.stringify(saved ?? null);
  useEffect(() => {
    setSkills(saved?.skills ?? []);
    setTip(saved?.tip ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const save = (next: Skill[], nextTip: string) => run("saveFeedback", { booking_id: bookingId, skills: next, tip: nextTip });
  const toggle = (k: Skill) => {
    const next = skills.includes(k) ? skills.filter((x) => x !== k) : [...skills, k];
    setSkills(next);
    save(next, saved?.tip ?? "");
  };
  const tipDirty = tip.trim() !== (saved?.tip ?? "");
  const first = name.split(" ")[0];
  return (
    <div className="mt-3 rounded-xl bg-paper p-3">
      <div className="mb-2 text-[12px] font-semibold text-ink/55">What got better today? (optional)</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Skills ${first} improved`}>
        {SKILLS.map((s) => {
          const on = skills.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              disabled={pending}
              aria-pressed={on}
              onClick={() => toggle(s.key)}
              className={cx("rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors", on ? "border-brand bg-brand text-paper" : "border-ink/12 bg-card text-ink/75 hover:border-ink/30")}
            >
              {s.label}
              {on && <span className="ml-1 font-bold text-accent">+{POINTS.skill}</span>}
            </button>
          );
        })}
      </div>
      {writing || saved?.tip ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (tipDirty) save(skills, tip.trim());
          }}
        >
          <input className="input min-h-10 flex-1 py-2 text-[13.5px]" value={tip} maxLength={300} onChange={(e) => setTip(e.target.value)} placeholder={`A tip for ${first} to work on`} aria-label={`Tip for ${first}`} autoFocus={writing && !saved?.tip} />
          {tipDirty && (
            <button type="submit" className={btn("primary", "sm")} disabled={pending}>
              {pending ? <Spinner /> : "Save"}
            </button>
          )}
        </form>
      ) : (
        <button type="button" onClick={() => setWriting(true)} className="mt-2 text-[12.5px] font-medium text-brand hover:underline">
          + Add a tip
        </button>
      )}
      {(saved?.skills.length || saved?.tip) && !tipDirty ? (
        <p className="mt-2 flex items-center gap-1 text-[12px] text-[#2E5A2A]">
          <Icon name="check" size={13} strokeWidth={2.5} /> Saved. {first} sees it in My Game.
        </p>
      ) : null}
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
        subtitle={
          <>
            {fmtDayLong(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}
            <Place p={s} className="mt-1" />
          </>
        }
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
                      {/* Wide enough that on a phone the attendance buttons wrap below instead of covering the name. */}
                      <div className="min-w-[7.5rem] flex-1 font-semibold">{r.player?.full_name}</div>
                      {r.booking.spot_offered_at && <Badge tone="amber">Offering spot</Badge>}
                      <AttendanceToggle bookingId={r.booking.id} value={r.booking.attended} />
                      <button className={btn("ghost", "sm")} onClick={() => setOpen(open === r.booking.id ? null : r.booking.id)} aria-expanded={open === r.booking.id}>
                        <Icon name="down" size={16} className={cx("transition-transform", open === r.booking.id && "rotate-180")} />
                        <span className="sr-only">Contact details</span>
                      </button>
                    </div>
                    {data.feedback && r.booking.attended === true && r.player && <SkillTaps bookingId={r.booking.id} name={r.player.full_name} saved={data.feedback[r.player.id]} />}
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

// ───────────────────────── earnings ─────────────────────────

/** Dollars for money screens: "$0", "$1,240", "$12.50". */
export function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const d = Math.abs(cents) / 100;
  return `${sign}$${d.toLocaleString("en-US", { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
const usdShort = (cents: number) => (Math.abs(cents) >= 100000 ? `$${(cents / 100000).toFixed(1).replace(/\.0$/, "")}k` : usd(cents));

export function ruleText(r: CommissionRule): string {
  return [r.percent ? `${r.percent}%` : "", r.per_hour_cents ? `${usd(r.per_hour_cents)}/hr` : "", r.per_lesson_cents ? `${usd(r.per_lesson_cents)}/lesson` : ""].filter(Boolean).join(" + ");
}

const PERIOD_WORD: Record<Period, string> = { week: "week", month: "month", year: "year" };

type Earnings = D<typeof loadCoachEarnings>;

function EarningsHero({ data }: { data: Earnings }) {
  const t = data.totals;
  const word = PERIOD_WORD[data.period];
  const diff = t.net - data.previous.net;
  return (
    <HeroPanel eyebrow={data.current ? `This ${word}` : data.label}>
      <h2 className="mt-2 font-display text-4xl leading-tight font-semibold tracking-tight tabular-nums md:text-5xl">{usd(t.net)}</h2>
      <p className="mt-1 text-sm text-paper/70">
        {data.current ? "earned so far, after commission" : "earned, after commission"}
        {data.scheduled.lessons > 0 && <span className="text-accent"> · {usd(data.scheduled.net)} more booked</span>}
      </p>
      {(data.previous.lessons > 0 || t.lessons > 0) && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1 text-[13px] ring-1 ring-paper/15">
          <span className={cx("font-semibold", diff > 0 ? "text-accent" : diff < 0 ? "text-[#F3B7A8]" : "")}>{diff > 0 ? "▲" : diff < 0 ? "▼" : "="} {usd(Math.abs(diff))}</span>
          <span className="text-paper/65">vs last {word}{data.current ? " at this point" : ""}</span>
        </div>
      )}
      <dl className="mt-6 grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-4">
        <HeroStat value={t.lessons} label={t.lessons === 1 ? "lesson taught" : "lessons taught"} />
        <HeroStat value={t.hours} label="hours" />
        <HeroStat value={t.hours ? usd(t.per_hour) : "—"} label="per hour" />
        <HeroStat value={usd(t.commission)} label="club commission" />
      </dl>
    </HeroPanel>
  );
}

function EarningsChart({ data }: { data: Earnings }) {
  const max = Math.max(1, ...data.chart.map((b) => b.earned + b.scheduled));
  const title = { week: "By day", month: "By week", year: "By month" }[data.period];
  return (
    <Card className="mb-6">
      <SectionTitle
        action={
          <span className="flex items-center gap-3 text-[12.5px] text-ink/60">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Earned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand/25" /> Booked
            </span>
          </span>
        }
      >
        {title}
      </SectionTitle>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2.5" role="img" aria-label={`${title}: ${data.chart.map((b) => `${b.label} ${usd(b.earned + b.scheduled)}`).join(", ")}`}>
        {data.chart.map((b) => {
          const sum = b.earned + b.scheduled;
          return (
            <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className={cx("text-[11px] tabular-nums", sum ? "text-ink/60" : "text-transparent")}>{usdShort(sum)}</span>
              <div className="flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-md" style={{ height: `${(Math.max(0, sum) / max) * 100}%`, minHeight: sum ? 4 : 0 }}>
                {b.scheduled > 0 && <div className="bg-brand/25" style={{ flexGrow: b.scheduled }} />}
                {b.earned > 0 && <div className="bg-brand" style={{ flexGrow: b.earned }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-ink/[0.07] pt-2 sm:gap-2.5">
        {data.chart.map((b) => (
          <span key={b.key} className={cx("min-w-0 flex-1 truncate text-center text-[11px]", b.current ? "font-semibold text-brand" : "text-ink/50")}>
            {b.label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function PaidButton({ lessonId, paid }: { lessonId: string; paid: boolean }) {
  return paid ? (
    <ActionButton action="setLessonPaid" input={{ lesson_id: lessonId, paid: "no" }} variant="ghost" size="sm" icon="check">
      Paid
    </ActionButton>
  ) : (
    <ActionButton action="setLessonPaid" input={{ lesson_id: lessonId, paid: "yes" }} variant="outline" size="sm">
      Mark paid
    </ActionButton>
  );
}

function LessonMoneyRow({ r }: { r: Earnings["lessons"][number] }) {
  const l = r.lesson;
  const m = r.money;
  return (
    <div className="flex items-center gap-3 px-4 py-3 md:px-5">
      <Dot color={LESSON_META[l.kind].color} className="shrink-0" />
      <A href={`/coach/lessons/${l.id}`} className="min-w-0 flex-1 hover:underline">
        <div className="truncate text-sm font-semibold">{lessonTitle(l)}</div>
        <div className="truncate text-[12.5px] text-ink/55">
          {fmtDay(l.starts_at)} · {fmtTime(l.starts_at)}
          {l.location && ` · ${r.place ?? l.location}`}
        </div>
      </A>
      <div className="shrink-0 text-right">
        {m.priced ? (
          <>
            <div className="text-sm font-semibold tabular-nums">{usd(m.net)}</div>
            {m.commission > 0 && <div className="text-[11.5px] text-ink/50 tabular-nums">{usd(m.gross)} − {usd(m.commission)}</div>}
          </>
        ) : (
          <Badge tone="amber">No price</Badge>
        )}
      </div>
      <div className="hidden w-[104px] shrink-0 justify-end sm:flex">{!r.done ? <Badge>Upcoming</Badge> : m.gross > 0 ? <PaidButton lessonId={l.id} paid={!!l.paid_at} /> : null}</div>
    </div>
  );
}

function downloadCsv(data: Earnings) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    ["Date", "Start", "End", "Type", "Players", "Location", "Price", "Commission", "You keep", "Paid"],
    ...[...data.lessons].reverse().map(({ lesson: l, money: m }) => [dateKey(l.starts_at), timeKey(l.starts_at), timeKey(l.ends_at), LESSON_META[l.kind].label, l.client_names.join(", "), l.location, m.priced ? (m.gross / 100).toFixed(2) : "", (m.commission / 100).toFixed(2), m.priced ? (m.net / 100).toFixed(2) : "", l.paid_at ? dateKey(l.paid_at) : ""]),
  ];
  const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `earnings-${data.period}-${data.chart[0]?.key ?? data.at}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Breakdown({ data }: { data: Earnings }) {
  const max = Math.max(1, ...data.byKind.map((k) => k.net));
  return (
    <Card>
      <SectionTitle>Breakdown</SectionTitle>
      <div className="space-y-3">
        {data.byKind.map((k) => (
          <div key={k.kind}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Dot color={LESSON_META[k.kind].color} /> {LESSON_META[k.kind].label}
                <span className="text-ink/45">· {k.lessons}</span>
              </span>
              <span className="font-semibold tabular-nums">{usd(k.net)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${(Math.max(0, k.net) / max) * 100}%`, background: LESSON_META[k.kind].color }} />
            </div>
          </div>
        ))}
      </div>
      {data.byPlace.length > 0 && (
        <div className="mt-5 border-t border-ink/[0.07] pt-4">
          <h3 className="mb-2 text-[13px] font-medium text-ink/55">By place</h3>
          <div className="space-y-2">
            {data.byPlace.map((p) => (
              <div key={p.name} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{p.name}</span>
                  <span className="block text-[12px] text-ink/50">
                    {p.lessons} {p.lessons === 1 ? "lesson" : "lessons"}
                    {p.commission > 0 && ` · ${usd(p.commission)} commission`}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{usd(p.net)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.clients.length > 0 && (
        <div className="mt-5 border-t border-ink/[0.07] pt-4">
          <h3 className="mb-2 text-[13px] font-medium text-ink/55">Top players</h3>
          <div className="space-y-2">
            {data.clients.map((c) => (
              <div key={c.name} className="flex items-center gap-2.5 text-sm">
                <Avatar name={c.name} size={26} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[12px] text-ink/45">{c.lessons}×</span>
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{usd(c.net)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function CoachEarnings({ data }: { data: Earnings }) {
  const base = "/coach/earnings";
  const word = PERIOD_WORD[data.period];
  const go = (at: string) => withQuery(base, { period: data.period, at });
  const unpriced = data.totals.unpriced;
  return (
    <>
      <PageHeader
        title="Earnings"
        actions={
          <>
            <button className={btn("outline")} onClick={() => downloadCsv(data)} disabled={!data.lessons.length}>
              <Icon name="download" size={16} /> Download CSV
            </button>
            <LinkButton href="/coach/lessons/new" icon="plus">
              Add lesson
            </LinkButton>
          </>
        }
      />
      <Tabs current={data.period} items={(["week", "month", "year"] as const).map((p) => ({ key: p, label: p === "week" ? "Weekly" : p === "month" ? "Monthly" : "Yearly", href: withQuery(base, { period: p, at: data.at }) }))} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <A href={go(data.prev)} className={btn("outline", "sm")} aria-label={`Previous ${word}`}>
          <Icon name="left" size={16} />
        </A>
        <A href={withQuery(base, { period: data.period })} className={btn("outline", "sm")}>
          This {word}
        </A>
        <A href={go(data.next)} className={btn("outline", "sm")} aria-label={`Next ${word}`}>
          <Icon name="right" size={16} />
        </A>
        <span className="ml-1 text-sm font-medium text-ink/70">{data.label}</span>
      </div>
      <EarningsHero data={data} />
      {unpriced.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            {unpriced.length === 1 ? "1 lesson" : `${unpriced.length} lessons`} this {word} {unpriced.length === 1 ? "has" : "have"} no price, so {unpriced.length === 1 ? "it isn't" : "they aren't"} counted:{" "}
            {unpriced.slice(0, 4).map((r, i) => (
              <span key={r.lesson.id}>
                {i > 0 && ", "}
                <A href={`/coach/lessons/${r.lesson.id}`} className="font-medium underline">
                  {lessonTitle(r.lesson)} ({fmtDay(r.lesson.starts_at)})
                </A>
              </span>
            ))}
            {unpriced.length > 4 && "…"}
          </Notice>
        </div>
      )}
      <EarningsChart data={data} />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <SectionTitle action={<span className="text-sm text-ink/55">{data.lessons.length} {data.lessons.length === 1 ? "lesson" : "lessons"}</span>}>Lessons</SectionTitle>
          {data.lessons.length ? (
            <div className="card divide-y divide-ink/[0.06]">
              {data.lessons.map((r) => (
                <LessonMoneyRow key={r.lesson.id} r={r} />
              ))}
            </div>
          ) : (
            <Empty icon="chart" title={`No lessons this ${word}`} body="Private and semi-private lessons you add to My Schedule show up here with what you earned." action={<LinkButton href="/coach/lessons/new" icon="plus" size="sm">Add lesson</LinkButton>} />
          )}
          {data.community.sessions > 0 && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ink/55">
              <SessionMark type="group" size={14} /> Plus {data.community.sessions} community {data.community.sessions === 1 ? "session" : "sessions"} ({data.community.hours} hours), not counted in earnings.
            </p>
          )}
        </div>
        <aside className="space-y-4">
          <Card>
            <SectionTitle action={data.owed.lessons.length > 0 && <span className="font-display text-lg font-semibold tabular-nums">{usd(data.owed.total)}</span>}>Owed to you</SectionTitle>
            {data.owed.lessons.length ? (
              <div className="-mx-1 space-y-1">
                {data.owed.lessons.slice(0, 8).map(({ lesson: l, money: m }) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                    <A href={`/coach/lessons/${l.id}`} className="min-w-0 flex-1 hover:underline">
                      <div className="truncate text-sm font-medium">{lessonTitle(l)}</div>
                      <div className="text-[12px] text-ink/50">
                        {fmtDay(l.starts_at)} · {usd(m.gross)}
                      </div>
                    </A>
                    <PaidButton lessonId={l.id} paid={false} />
                  </div>
                ))}
                {data.owed.lessons.length > 8 && <p className="px-1 text-[12.5px] text-ink/50">and {data.owed.lessons.length - 8} more</p>}
              </div>
            ) : (
              <p className="text-sm text-ink/55">All caught up. Every past lesson is marked paid.</p>
            )}
          </Card>
          <Breakdown data={data} />
          <Card>
            <SectionTitle>Club commission</SectionTitle>
            {data.rules.length ? (
              <ul className="space-y-1 text-sm text-ink/70">
                {data.rules.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span>{r.place}</span>
                    <span className="font-medium">{ruleText(r) || "None"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink/55">No club commission is set yet, so you keep the full price.</p>
            )}
            <p className="mt-2 text-[12px] text-ink/45">Applied automatically by lesson location. Set by the admin.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

// ───────────────────────── clients ─────────────────────────

type Clients = D<typeof loadCoachClients>;
type ClientData = D<typeof loadCoachClient>;

const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : `${Math.round(days / 30)} months ago`);
const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** A friendly WhatsApp opener asking a client to book their next lesson. */
const nudgeText = (name: string, again?: { date: string; time: string } | null) =>
  `Hi ${firstName(name)}, want to get your next lesson on the calendar?${again ? ` I can do ${fmtKeyWeekday(again.date)} at ${fmtClock(again.time)} again.` : " Let me know what works for you."}`;

function ContactButtons({ phone, email, nudge, labels }: { phone: string | null; email: string | null; nudge?: string; labels?: boolean }) {
  const links = [
    phone && { href: `tel:${phone}`, icon: "phone" as const, label: "Call" },
    phone && { href: `${whatsappHref(phone)}${nudge ? `?text=${encodeURIComponent(nudge)}` : ""}`, icon: "message" as const, label: "WhatsApp", external: true },
    phone && labels && { href: `sms:${phone}`, icon: "message" as const, label: "Text" },
    email && { href: `mailto:${email}`, icon: "mail" as const, label: "Email" },
  ].filter(Boolean) as { href: string; icon: "phone" | "message" | "mail"; label: string; external?: boolean }[];
  if (!links.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-1">
      {links.map((l) => (
        <a key={l.label} href={l.href} target={l.external ? "_blank" : undefined} rel={l.external ? "noreferrer" : undefined} className={btn(labels ? "outline" : "ghost", "sm")} aria-label={l.label} title={l.label}>
          <Icon name={l.icon} size={15} />
          {labels && l.label}
        </a>
      ))}
    </div>
  );
}

const CLIENT_TAB_LABEL: Record<Clients["tab"], string> = { all: "All", booked: "Booked", rebook: "To rebook", lapsed: "Lapsed", owes: "Owe you", community: "Community players" };

const CLIENT_EMPTY: Record<Clients["tab"], { title: string; body: string }> = {
  all: { title: "No clients yet", body: "Everyone you add to a lesson gets a client card here. You can also add someone before their first lesson." },
  booked: { title: "No one has a lesson booked", body: "Clients with an upcoming lesson show here." },
  rebook: { title: "Everyone recent is booked", body: `Clients who had a lesson in the last ${REBOOK_DAYS} days but have nothing booked show here.` },
  lapsed: { title: "No lapsed clients", body: `Clients whose last lesson was over ${REBOOK_DAYS} days ago, with nothing booked, show here.` },
  owes: { title: "Nobody owes you", body: "Every past lesson is marked paid." },
  community: { title: "No community players yet", body: "Players who came to your community sessions in the last six months show here, so you can offer them a private lesson." },
};

function clientLine(s: Clients["clients"][number]["summary"]) {
  const when = s.next ? `Next ${fmtDay(s.next.starts_at)}, ${fmtTime(s.next.starts_at)}` : s.days_since !== null ? `Last lesson ${ago(s.days_since)}` : "No lessons yet";
  return [when, s.lessons ? `${s.lessons} ${s.lessons === 1 ? "lesson" : "lessons"}` : "", s.every_days ? `about every ${s.every_days === 7 ? "week" : `${s.every_days} days`}` : ""].filter(Boolean).join(" · ");
}

export function CoachClients({ data }: { data: Clients }) {
  const nav = useNav();
  const base = "/coach/clients";
  const t = data.totals;
  const c = data.counts;
  const empty = CLIENT_EMPTY[data.tab];
  return (
    <>
      <PageHeader
        title="Clients"
        actions={
          <>
            <LinkButton href={`${base}/new`} variant="outline" icon="plus">
              Add client
            </LinkButton>
            <LinkButton href="/coach/lessons/new" icon="plus">
              Add Lesson
            </LinkButton>
          </>
        }
      />
      <HeroPanel eyebrow="Your clients">
        <h2 className="mt-2 max-w-md font-display text-3xl leading-tight font-semibold tracking-tight md:text-[2.2rem]">
          {c.rebook ? `${c.rebook} recent ${c.rebook === 1 ? "client has" : "clients have"} nothing booked.` : c.all ? "Every recent client is booked." : "Your client list starts here."}
        </h2>
        {c.rebook > 0 && (
          <A href={withQuery(base, { tab: "rebook" })} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1.5 text-sm ring-1 ring-paper/15 hover:bg-paper/15">
            See who to message <Icon name="arrow" size={15} className="text-accent" />
          </A>
        )}
        <dl className="mt-6 grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat value={t.active} label={t.active === 1 ? "active client" : "active clients"} />
          <HeroStat value={t.booked_ahead} label="lessons booked ahead" />
          <HeroStat value={t.lessons_30d} label="lessons, last 30 days" />
          <HeroStat value={usd(t.owed)} label="owed to you" />
        </dl>
      </HeroPanel>
      <form
        className="mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          nav.push(withQuery(base, { tab: data.tab === "all" ? undefined : data.tab, q: String(new FormData(e.currentTarget).get("q") ?? "") || undefined }));
        }}
      >
        <label className="relative block">
          <Icon name="search" size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" />
          <input name="q" defaultValue={data.q} className="input !pl-10" placeholder="Search name, phone, email or level" />
        </label>
      </form>
      <Tabs current={data.tab} items={(Object.keys(CLIENT_TAB_LABEL) as Clients["tab"][]).map((k) => ({ key: k, label: CLIENT_TAB_LABEL[k], href: withQuery(base, { tab: k === "all" ? undefined : k, q: data.q || undefined }), count: k === "all" ? undefined : c[k] }))} />
      {data.tab === "community" ? (
        data.community.length ? (
          <div className="card divide-y divide-ink/[0.06]">
            {data.community.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
                <Avatar name={p.full_name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.full_name}</div>
                  <div className="truncate text-[12.5px] text-ink/55">
                    {p.sessions} {p.sessions === 1 ? "session" : "sessions"} with you · last {fmtDay(p.last)}
                  </div>
                </div>
                <ContactButtons phone={p.phone} email={p.email} />
                {p.client_id ? (
                  <LinkButton href={`${base}/${p.client_id}`} variant="ghost" size="sm" icon="user">
                    Client card
                  </LinkButton>
                ) : (
                  <>
                    <LinkButton href={withQuery(`${base}/new`, { member: p.id })} variant="outline" size="sm" icon="plus">
                      Add as client
                    </LinkButton>
                    <LinkButton href={withQuery("/coach/lessons/new", { member: p.id })} size="sm">
                      Book a lesson
                    </LinkButton>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="users" title={data.q ? "No one matches that search" : empty.title} body={data.q ? undefined : empty.body} />
        )
      ) : data.clients.length ? (
        <div className="card divide-y divide-ink/[0.06]">
          {data.clients.map(({ client: cl, summary: s }) => (
            <div key={cl.id} className="flex items-center gap-3 px-4 py-3.5 md:px-5">
              <Avatar name={cl.full_name} size={38} />
              <A href={`${base}/${cl.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{cl.full_name}</span>
                  {cl.level && <Badge className="shrink-0">{cl.level}</Badge>}
                </div>
                <div className="truncate text-[12.5px] text-ink/55">{clientLine(s)}</div>
              </A>
              {s.owed > 0 && <Badge tone="amber">Owes {usd(s.owed)}</Badge>}
              <Badge tone={CLIENT_STATUS[s.status].tone} className="hidden sm:inline-flex">
                {CLIENT_STATUS[s.status].label}
              </Badge>
              <div className="hidden md:block">
                <ContactButtons phone={cl.phone} email={cl.email} nudge={s.status === "rebook" || s.status === "lapsed" ? nudgeText(cl.full_name) : undefined} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon="users"
          title={data.q ? "No one matches that search" : empty.title}
          body={data.q ? undefined : empty.body}
          action={
            !data.q &&
            data.tab === "all" && (
              <LinkButton href={`${base}/new`} icon="plus" size="sm">
                Add client
              </LinkButton>
            )
          }
        />
      )}
    </>
  );
}

function ClientForm({ client, prefill }: { client: Client | null; prefill: { full_name: string; phone: string; email: string } | null }) {
  return (
    <ActionForm action="saveClient" hidden={{ id: client?.id ?? "" }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint={client ? "Changing it also renames them on their lessons" : "As you'd write it on a lesson"} className="sm:col-span-2">
          <input className="input" name="full_name" defaultValue={client?.full_name ?? prefill?.full_name ?? ""} required />
        </Field>
        <Field label="Mobile">
          <input className="input" name="phone" type="tel" inputMode="tel" defaultValue={client?.phone ?? prefill?.phone ?? ""} placeholder="(619) 555-0123" />
        </Field>
        <Field label="Email">
          <input className="input" name="email" type="email" defaultValue={client?.email ?? prefill?.email ?? ""} />
        </Field>
        <Field label="Level" hint="e.g. Beginner, 3.5, Junior high school team" className="sm:col-span-2">
          <input className="input" name="level" defaultValue={client?.level ?? ""} />
        </Field>
        <Field label="Goals" className="sm:col-span-2">
          <textarea className="input" name="goals" rows={2} defaultValue={client?.goals ?? ""} placeholder="What they want from lessons" />
        </Field>
        <Field label="Private notes" hint="Only you see these: injuries, preferences, how they like to pay" className="sm:col-span-2">
          <textarea className="input" name="notes" rows={3} defaultValue={client?.notes ?? ""} />
        </Field>
      </div>
      <Submit className="mt-5" size={client ? "sm" : "md"} icon="check">
        {client ? "Save card" : "Add client"}
      </Submit>
    </ActionForm>
  );
}

function ClientLessonRow({ r, clientId }: { r: ClientData["lessons"][number]; clientId: string }) {
  const l = r.lesson;
  const others = l.client_names.length > 1;
  return (
    <div className="px-4 py-3 md:px-5">
      <div className="flex items-center gap-3">
        <Dot color={LESSON_META[l.kind].color} className="shrink-0" />
        <A href={withQuery(`/coach/lessons/${l.id}`, { back: `/coach/clients/${clientId}` })} className="min-w-0 flex-1 hover:underline">
          <div className="truncate text-sm font-semibold">
            {fmtDay(l.starts_at)} · {fmtRange(l.starts_at, l.ends_at)}
          </div>
          <div className="truncate text-[12.5px] text-ink/55">
            {others ? `Semi-private with ${l.client_names.length} players` : LESSON_META[l.kind].label}
            {l.location && ` · ${placeLabel(l)}`}
          </div>
        </A>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{r.money.priced ? usd(r.money.gross) : <Badge tone="amber">No price</Badge>}</div>
        <div className="hidden w-[104px] shrink-0 justify-end sm:flex">{!r.done ? <Badge>Upcoming</Badge> : r.money.gross > 0 ? <PaidButton lessonId={l.id} paid={!!l.paid_at} /> : null}</div>
      </div>
      {l.notes && <p className="mt-2 ml-5 border-l-2 border-sage pl-3 text-[13px] whitespace-pre-line text-ink/70">{l.notes}</p>}
    </div>
  );
}

export function CoachClient({ data }: { data: ClientData }) {
  const cl = data.client;
  if (!cl) {
    return (
      <>
        <PageHeader back={{ href: "/coach/clients", label: "Clients" }} title="Add client" subtitle="A card for someone you teach: how to reach them, their level and goals." />
        <Card className="max-w-2xl">
          <ClientForm client={null} prefill={data.prefill} />
        </Card>
      </>
    );
  }
  const s = data.summary!;
  const self = `/coach/clients/${cl.id}`;
  const bookHref = withQuery("/coach/lessons/new", { client: cl.id, back: self, ...(data.again ?? {}) });
  const upcoming = data.lessons.filter((r) => !r.done).reverse();
  const history = data.lessons.filter((r) => r.done);
  const phone = cl.phone ?? data.member?.phone ?? null;
  const email = cl.email ?? data.member?.email ?? null;
  const quiet = s.status === "rebook" || s.status === "lapsed";
  return (
    <>
      <PageHeader
        back={{ href: "/coach/clients", label: "Clients" }}
        title={cl.full_name}
        subtitle={[cl.level, s.first ? `Client since ${fmtDate(s.first)}` : "No lessons yet"].filter(Boolean).join(" · ")}
        actions={
          <LinkButton href={bookHref} icon={data.again ? "repeat" : "plus"}>
            {data.again ? "Book again" : "Book a lesson"}
          </LinkButton>
        }
      />
      {quiet && (
        <div className="mb-5">
          <Notice tone="warn">
            Nothing booked. {firstName(cl.full_name)}'s last lesson was {ago(s.days_since!)}
            {data.again && `, ${fmtKeyWeekday(dateKey(data.lessons[0].lesson.starts_at))}s at ${fmtClock(data.again.time)}`}.{" "}
            {phone ? (
              <a href={`${whatsappHref(phone)}?text=${encodeURIComponent(nudgeText(cl.full_name, data.again))}`} target="_blank" rel="noreferrer" className="font-medium underline">
                Message them on WhatsApp
              </a>
            ) : (
              <A href={bookHref} className="font-medium underline">
                Book the next one
              </A>
            )}
          </Notice>
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lessons" icon="ball" value={s.lessons} hint={s.upcoming ? `${s.upcoming} more booked` : `${s.hours} hours on court`} />
        <Stat label="Comes" icon="repeat" value={s.every_days ? (s.every_days === 7 ? "Weekly" : `Every ${s.every_days}d`) : "—"} hint={s.every_days ? "from their last lessons" : "after a few lessons"} />
        <Stat label="Paid you" icon="card" value={usd(s.paid)} hint="all time, before commission" />
        <Stat label="Owes you" icon="flag" value={usd(s.owed)} hint={s.owed_lessons ? `${s.owed_lessons} unpaid ${s.owed_lessons === 1 ? "lesson" : "lessons"}` : "all paid up"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <div>
            <SectionTitle action={<span className="text-sm text-ink/55">{upcoming.length || ""}</span>}>Booked</SectionTitle>
            {upcoming.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {upcoming.map((r) => (
                  <ClientLessonRow key={r.lesson.id} r={r} clientId={cl.id} />
                ))}
              </div>
            ) : (
              <Empty icon="calendar" title="No lesson booked" body={data.again ? `Book again repeats their last lesson: ${fmtKeyWeekday(data.again.date)} at ${fmtClock(data.again.time)}, every week if you like.` : undefined} action={<LinkButton href={bookHref} size="sm" icon="plus">{data.again ? "Book again" : "Book a lesson"}</LinkButton>} />
            )}
          </div>
          <div>
            <SectionTitle action={<span className="text-sm text-ink/55">{history.length ? `${history.length} ${history.length === 1 ? "lesson" : "lessons"}` : ""}</span>}>Lesson history and notes</SectionTitle>
            {history.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {history.map((r) => (
                  <ClientLessonRow key={r.lesson.id} r={r} clientId={cl.id} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/50">No lessons yet. Notes you write on each lesson build up here as a progress log.</p>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          {(cl.goals || phone || email || data.member) && (
            <Card>
              {cl.goals && (
                <>
                  <SectionTitle>Goals</SectionTitle>
                  <p className="mb-4 text-sm whitespace-pre-line text-ink/75">{cl.goals}</p>
                </>
              )}
              <SectionTitle>Contact</SectionTitle>
              {phone || email ? (
                <>
                  <div className="space-y-1 text-sm text-ink/70">
                    {phone && <div>{phone}</div>}
                    {email && <div className="break-all">{email}</div>}
                  </div>
                  <div className="mt-3">
                    <ContactButtons phone={phone} email={email} nudge={quiet ? nudgeText(cl.full_name, data.again) : undefined} labels />
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink/55">No phone or email yet. Add them below.</p>
              )}
              {data.member && (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-ink/60">
                  <SessionMark type="group" size={14} />
                  {data.member.sessions ? `Also in the community: ${data.member.sessions} ${data.member.sessions === 1 ? "session" : "sessions"} with you in the last six months.` : "Also has a community account."}
                </p>
              )}
            </Card>
          )}
          <Card>
            <SectionTitle>Client card</SectionTitle>
            <ClientForm client={cl} prefill={null} />
          </Card>
          <ActionButton action="deleteClient" input={{ client_id: cl.id }} variant="ghost" icon="trash" confirm={{ title: `Remove ${cl.full_name}?`, body: "Their card, contact details and private notes are deleted. Their lessons stay on your schedule and in Earnings.", label: "Remove", danger: true }}>
            Remove client
          </ActionButton>
        </aside>
      </div>
    </>
  );
}
