import { useState } from "react";
import { A, useAction, withQuery } from "./nav";
import { Icon } from "./icons";
import { Badge, BookingBadge, btn, Capacity, cx, Dot, Empty, Modal, Spinner } from "./kit";
import type { SessionView } from "@/core/queries";
import { addDays, dateKey, fmtDayLong, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange, fmtWeekRange, minutesOfDay, fmtClock } from "@/core/time";
import { fmtMoney } from "@/core/util";

export function priceLabel(s: Pick<SessionView, "price_cents" | "pricing" | "capacity" | "program">) {
  if (s.price_cents === null) return "Price TBA";
  if (s.price_cents === 0) return "Free";
  if (s.pricing === "per_session" && s.capacity > 1) return `${fmtMoney(s.price_cents)} / session`;
  return s.program.kind === "private" || s.pricing === "per_session" ? fmtMoney(s.price_cents) : `${fmtMoney(s.price_cents)} / player`;
}

export const sessionName = (s: Pick<SessionView, "title" | "program">) => s.title || s.program.name;

// ───────────────────────── week navigation ─────────────────────────

export function WeekNav({ monday, base, extra = {} }: { monday: string; base: string; extra?: Record<string, string> }) {
  const thisWeek = monday;
  return (
    <div className="flex items-center gap-2">
      <A href={withQuery(base, { ...extra, week: addDays(thisWeek, -7) })} className={btn("outline", "sm")} aria-label="Previous week">
        <Icon name="left" size={16} />
      </A>
      <A href={withQuery(base, { ...extra })} className={btn("outline", "sm")}>
        Today
      </A>
      <A href={withQuery(base, { ...extra, week: addDays(thisWeek, 7) })} className={btn("outline", "sm")} aria-label="Next week">
        <Icon name="right" size={16} />
      </A>
      <span className="ml-1 text-sm font-medium text-ink/70">{fmtWeekRange(monday)}</span>
    </div>
  );
}

// ───────────────────────── booking dialog ─────────────────────────

export function BookButton({ s, signedIn, full = false }: { s: SessionView; signedIn: boolean; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const [guest, setGuest] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const mine = s.my_booking;
  const isFull = s.spots_left <= 0;

  if (mine) {
    return (
      <A href={`/app/sessions/${s.id}`} className="inline-flex">
        <BookingBadge status={mine.status} position={mine.waitlist_position} />
      </A>
    );
  }
  if (!signedIn) {
    return (
      <A href={withQuery("/login", { next: `/app/sessions/${s.id}` })} className={cx(btn(isFull ? "outline" : "primary", "sm"), full && "w-full")}>
        {isFull ? "Join waitlist" : "Book"}
      </A>
    );
  }
  const seats = s.program.kind === "semi_private" && guest ? 2 : 1;
  const price = s.price_cents === null ? 0 : s.pricing === "per_session" ? Math.round((s.price_cents * seats) / Math.max(1, s.capacity)) : s.price_cents * seats;
  const action = isFull ? "Join waitlist" : s.program.requires_approval ? "Request spot" : "Book";
  return (
    <>
      <button className={cx(btn(isFull ? "outline" : "primary", "sm"), full && "w-full")} onClick={() => setOpen(true)}>
        {action}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={isFull ? "Join the waitlist" : "Confirm your booking"}>
        <div className="rounded-xl bg-paper p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Dot color={s.program.color} /> {sessionName(s)}
          </div>
          <div className="mt-2 space-y-1 text-sm text-ink/70">
            <div className="flex items-center gap-2">
              <Icon name="calendar" size={15} /> {fmtDayLong(s.starts_at)}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="clock" size={15} /> {fmtRange(s.starts_at, s.ends_at)}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="pin" size={15} /> {s.location}
            </div>
            {s.coaches.length > 0 && (
              <div className="flex items-center gap-2">
                <Icon name="whistle" size={15} /> {s.coaches.map((c) => c.full_name).join(" & ")}
              </div>
            )}
          </div>
        </div>

        {isFull ? (
          <p className="mt-4 text-sm text-ink/70">
            This session is full. Join the waitlist and you&apos;ll be moved in automatically — and notified — if a spot opens.
          </p>
        ) : (
          <>
            {s.program.kind === "semi_private" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Partner&apos;s name</span>
                  <input className="input" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Optional" />
                </label>
                <label className="block">
                  <span className="label">Partner&apos;s email</span>
                  <input className="input" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Optional" />
                </label>
              </div>
            )}
            {price > 0 && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-ink/10 px-4 py-3 text-sm">
                <span className="text-ink/60">Price{seats > 1 ? " (2 players)" : ""}</span>
                <span className="font-semibold">{fmtMoney(price)}</span>
              </div>
            )}
            {s.program.requires_approval && <p className="mt-4 text-sm text-ink/60">The coach confirms this booking — your spot is held while it&apos;s reviewed.</p>}
          </>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className={btn("ghost")} onClick={() => setOpen(false)}>
            Not now
          </button>
          <button
            className={btn("primary")}
            disabled={pending}
            data-autofocus
            onClick={async () => {
              const r = await run("bookSession", { session_id: s.id, guest_name: guest, guest_email: guestEmail });
              if (r.ok) setOpen(false);
            }}
          >
            {pending && <Spinner />}
            {isFull ? "Join waitlist" : s.program.requires_approval ? "Send request" : "Confirm booking"}
          </button>
        </div>
      </Modal>
    </>
  );
}

// ───────────────────────── agenda (players) ─────────────────────────

export function SessionRow({ s, signedIn, now }: { s: SessionView; signedIn: boolean; now: string }) {
  const past = s.starts_at <= now;
  return (
    <div className="group flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-5 md:px-5">
      <div className="w-[118px] shrink-0">
        <div className="text-[15px] font-semibold tabular-nums">{fmtRange(s.starts_at, s.ends_at)}</div>
        <div className="text-xs text-ink/50">{s.program.duration_min ? `${Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000)} min` : ""}</div>
      </div>
      <div className="min-w-0 flex-1">
        <A href={signedIn ? `/app/sessions/${s.id}` : `/programs/${s.program.slug}`} className="flex items-center gap-2 font-semibold hover:underline">
          <Dot color={s.program.color} /> <span className="truncate">{sessionName(s)}</span>
        </A>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink/55">
          {s.title && <span>{s.program.name}</span>}
          {s.coaches.length > 0 && <span>with {s.coaches.map((c) => c.full_name.split(" ")[0]).join(" & ")}</span>}
          {s.skill_level && <span>Level {s.skill_level}</span>}
          <span className="font-medium text-ink/70">{priceLabel(s)}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 sm:w-[260px] sm:justify-end">
        <div className="flex-1 sm:max-w-[140px]">
          {s.capacity > 1 ? <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} /> : <span className={cx("text-xs font-medium", s.spots_left ? "text-ink/60" : "text-[#8E3326]")}>{s.spots_left ? "Open slot" : "Taken"}</span>}
        </div>
        {past ? <Badge>Started</Badge> : <BookButton s={s} signedIn={signedIn} />}
      </div>
    </div>
  );
}

export function ScheduleBoard({
  data,
  signedIn,
  base,
}: {
  data: { monday: string; days: string[]; today: string; filter: string; programs: { id: string; slug: string; name: string; color: string }[]; sessions: SessionView[]; nowIso: string };
  signedIn: boolean;
  base: string;
}) {
  const byDay = data.days.map((d) => ({ day: d, sessions: data.sessions.filter((s) => dateKey(s.starts_at) === d) }));
  const [day, setDay] = useState<string | null>(null);
  const shown = day ? byDay.filter((d) => d.day === day) : byDay.filter((d) => d.sessions.length > 0 && (d.day >= data.today || addDays(data.monday, 6) < data.today));
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <WeekNav monday={data.monday} base={base} extra={data.filter ? { program: data.filter } : {}} />
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <A href={withQuery(base, { week: data.monday })} className={cx("shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium", !data.filter ? "border-brand bg-brand text-paper" : "border-ink/12 bg-card text-ink/70 hover:border-ink/25")}>
            All programs
          </A>
          {data.programs.map((p) => (
            <A
              key={p.id}
              href={withQuery(base, { week: data.monday, program: p.slug })}
              className={cx("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium", data.filter === p.slug ? "border-brand bg-brand text-paper" : "border-ink/12 bg-card text-ink/70 hover:border-ink/25")}
            >
              <Dot color={p.color} /> {p.name}
            </A>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-7 gap-1.5">
        {byDay.map(({ day: d, sessions }) => {
          const active = day === d;
          const isToday = d === data.today;
          const open = sessions.filter((s) => s.spots_left > 0 && s.starts_at > data.nowIso).length;
          return (
            <button
              key={d}
              onClick={() => setDay(active ? null : d)}
              className={cx(
                "flex flex-col items-center rounded-xl border py-2.5 transition-colors",
                active ? "border-brand bg-brand text-paper" : "border-ink/[0.08] bg-card hover:border-ink/20",
                d < data.today && !active && "opacity-50",
              )}
              aria-pressed={active}
            >
              <span className={cx("text-[11px] font-medium uppercase", active ? "text-paper/70" : "text-ink/50")}>{fmtKeyWeekday(d)}</span>
              <span className={cx("font-display text-lg font-semibold tabular-nums", isToday && !active && "text-brand")}>{fmtKeyNum(d)}</span>
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {sessions.slice(0, 4).map((s) => (
                  <span key={s.id} className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "var(--accent)" : s.program.color, opacity: s.spots_left ? 1 : 0.35 }} />
                ))}
              </span>
              <span className="sr-only">{open} open sessions</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 || shown.every((d) => d.sessions.length === 0) ? (
        <Empty
          icon="calendar"
          title={day ? "Nothing scheduled this day" : "No sessions this week yet"}
          body="New sessions are added every week. Try the next week, or request a private lesson at a time that suits you."
          action={
            <A href={withQuery(base, { week: addDays(data.monday, 7), program: data.filter })} className={btn("outline", "sm")}>
              Next week <Icon name="right" size={15} />
            </A>
          }
        />
      ) : (
        <div className="space-y-5">
          {shown.map(({ day: d, sessions }) => (
            <section key={d} className="card overflow-hidden">
              <h3 className="flex items-center justify-between border-b border-ink/[0.06] bg-paper/60 px-4 py-2.5 text-sm font-semibold md:px-5">
                {fmtKeyLong(d)}
                {d === data.today && <Badge tone="accent">Today</Badge>}
              </h3>
              {sessions.length ? (
                <div className="divide-y divide-ink/[0.06]">
                  {sessions.map((s) => (
                    <SessionRow key={s.id} s={s} signedIn={signedIn} now={data.nowIso} />
                  ))}
                </div>
              ) : (
                <p className="px-5 py-6 text-sm text-ink/50">No sessions on this day.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── time grid (staff) ─────────────────────────

const HOUR_PX = 54;

export function WeekGrid({
  days,
  today,
  sessions,
  hrefFor,
  newHref,
  nowIso,
}: {
  days: string[];
  today: string;
  sessions: SessionView[];
  hrefFor: (s: SessionView) => string;
  newHref?: (day: string, time: string) => string;
  nowIso?: string;
}) {
  const mins = sessions.flatMap((s) => [minutesOfDay(s.starts_at), minutesOfDay(s.ends_at) || 24 * 60]);
  const startH = Math.min(7, ...mins.map((m) => Math.floor(m / 60)));
  const endH = Math.max(21, ...mins.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const height = hours.length * HOUR_PX;
  const nowMin = nowIso ? minutesOfDay(nowIso) : null;
  const nowDay = nowIso ? dateKey(nowIso) : null;

  return (
    <>
    {/* Phones: a simple day-by-day list */}
    <div className="space-y-4 md:hidden">
      {days.map((d) => {
        const list = sessions.filter((s) => dateKey(s.starts_at) === d);
        return (
          <section key={d} className="card overflow-hidden">
            <div className={cx("flex items-center justify-between border-b border-ink/[0.06] px-4 py-2.5", d === today ? "bg-sage/50" : "bg-paper/60")}>
              <h3 className="text-sm font-semibold">{fmtKeyLong(d)}</h3>
              {newHref && (
                <A href={newHref(d, "17:00")} className="rounded-lg p-1 text-brand" aria-label={`New session on ${fmtKeyLong(d)}`}>
                  <Icon name="plus" size={18} />
                </A>
              )}
            </div>
            {list.length ? (
              <div className="divide-y divide-ink/[0.06]">
                {list.map((s) => (
                  <A key={s.id} href={hrefFor(s)} className={cx("flex items-center gap-3 px-4 py-3 active:bg-paper", s.status === "cancelled" && "opacity-50")}>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: s.program.color }} />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-[15px] font-semibold", s.status === "cancelled" && "line-through")}>{sessionName(s)}</span>
                      <span className="block text-[13px] text-ink/55">
                        {fmtRange(s.starts_at, s.ends_at)}
                        {s.status === "draft" && " · Draft"}
                        {s.visibility === "private" && " · Private"}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-ink/70 tabular-nums">
                      {s.booked}/{s.capacity}
                      {s.waitlist > 0 && <span className="block text-right text-[11px] text-ink/45">+{s.waitlist} wl</span>}
                    </span>
                    <Icon name="right" size={16} className="text-ink/30" />
                  </A>
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-ink/40">No sessions</p>
            )}
          </section>
        );
      })}
    </div>
    <div className="card hidden overflow-x-auto md:block">
      <div className="min-w-[820px]">
        <div className="sticky top-0 z-10 grid border-b border-ink/[0.07] bg-card" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
          <div />
          {days.map((d) => (
            <div key={d} className={cx("border-l border-ink/[0.05] px-2 py-2.5 text-center", d === today && "bg-sage/40")}>
              <div className="text-[11px] font-medium text-ink/50 uppercase">{fmtKeyWeekday(d)}</div>
              <div className={cx("font-display text-lg leading-tight font-semibold tabular-nums", d === today && "text-brand")}>{fmtKeyNum(d)}</div>
            </div>
          ))}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)`, height }}>
          <div className="relative">
            {hours.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink/40 tabular-nums" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : fmtClock(`${String(h).padStart(2, "0")}:00`)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const daySessions = sessions.filter((s) => dateKey(s.starts_at) === d);
            return (
              <div key={d} className={cx("relative border-l border-ink/[0.05]", d === today && "bg-sage/20")}>
                {hours.map((h, i) => (
                  <div key={h} className="absolute inset-x-0 border-t border-ink/[0.05]" style={{ top: i * HOUR_PX, height: HOUR_PX }}>
                    {newHref && (
                      <A href={newHref(d, `${String(h).padStart(2, "0")}:00`)} className="group block h-full w-full hover:bg-sage/30" aria-label={`New session on ${d} at ${h}:00`}>
                        <span className="hidden px-1.5 pt-1 text-[11px] font-medium text-brand group-hover:block">+ New</span>
                      </A>
                    )}
                  </div>
                ))}
                {nowDay === d && nowMin !== null && nowMin >= startH * 60 && nowMin <= endH * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-[5] h-px bg-[#B9574A]" style={{ top: ((nowMin - startH * 60) / 60) * HOUR_PX }}>
                    <span className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-[#B9574A]" />
                  </div>
                )}
                {daySessions.map((s) => {
                  const top = ((minutesOfDay(s.starts_at) - startH * 60) / 60) * HOUR_PX;
                  const h = Math.max(26, ((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000) * HOUR_PX - 3);
                  const cancelled = s.status === "cancelled";
                  const draft = s.status === "draft";
                  return (
                    <div key={s.id} className="absolute inset-x-1 z-[6] hover:z-20" style={{ top: top + 1, height: h }}>
                      <A
                        href={hrefFor(s)}
                        title={`${sessionName(s)} · ${fmtRange(s.starts_at, s.ends_at)}`}
                        className={cx(
                          "relative block h-full overflow-hidden rounded-lg px-2 py-1.5 pl-2.5 text-left text-[12px] leading-tight shadow-sm transition-transform hover:-translate-y-px hover:shadow-md",
                          cancelled && "opacity-50",
                          draft && "outline-1 outline-dashed outline-ink/25",
                        )}
                      >
                        <span className="absolute inset-0" style={{ background: s.program.color, opacity: draft ? 0.07 : 0.15 }} />
                        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.program.color }} />
                        <span className={cx("relative block truncate font-semibold text-ink", cancelled && "line-through")}>{sessionName(s)}</span>
                        <span className="relative block text-ink/60">{fmtRange(s.starts_at, s.ends_at)}</span>
                        {h > 56 && (
                          <span className="relative mt-1 flex flex-wrap items-center gap-1 text-ink/70">
                            <Icon name="users" size={12} /> {s.booked}/{s.capacity}
                            {s.waitlist > 0 && <span className="text-ink/50">+{s.waitlist} wl</span>}
                            {draft && <span className="rounded bg-ink/10 px-1 text-[10px]">Draft</span>}
                            {cancelled && <span className="rounded bg-ink/10 px-1 text-[10px]">Cancelled</span>}
                            {s.visibility === "private" && <span className="rounded bg-ink/10 px-1 text-[10px]">Private</span>}
                          </span>
                        )}
                      </A>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}
