import { type RefObject, useEffect, useRef, useState } from "react";
import { A, useAction, useToast, withQuery } from "./nav";
import { ballBurst, Icon, SessionMark, TennisBall } from "./icons";
import { ActionButton, Badge, BookingBadge, btn, cx, Modal, Notice, Spinner } from "./kit";
import type { ScheduleItem, SessionView } from "@/core/queries";
import { addDays, dateKey, fmtClock, fmtDateTime, fmtDayLong, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange, fmtWeekRange, minutesOfDay, relativeFromNow } from "@/core/time";
import { fmtMoney, placeLabel, sessionTitle, SESSION_META } from "@/core/util";

export function priceLabel(s: Pick<SessionView, "price_cents">) {
  if (s.price_cents === null) return "Price TBA";
  return s.price_cents === 0 ? "Free" : fmtMoney(s.price_cents);
}

export const sessionColor = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].color;
const sessionLabel = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].label;

/** "today", "tomorrow", "Thursday" or "Nov 14", counted from today. */
export function whenWord(iso: string, today: string) {
  const d = dateKey(iso);
  if (d === today) return "today";
  if (d === addDays(today, 1)) return "tomorrow";
  if (d < addDays(today, 7)) return fmtKeyLong(d).split(",")[0];
  return fmtKeyLong(d).split(", ")[1] ?? fmtKeyLong(d);
}

/** "in 3 hr" for anything within a day and a half; further out, the day name says enough. */
export function countdown(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms < 36 * 3600000 ? relativeFromNow(iso) : null;
}

// ───────────────────────── week navigation ─────────────────────────

export function WeekNav({ monday, base }: { monday: string; base: string }) {
  return (
    <div className="flex items-center gap-2">
      <A href={withQuery(base, { week: addDays(monday, -7) })} className={btn("outline", "sm")} aria-label="Previous week">
        <Icon name="left" size={16} />
      </A>
      <A href={base} className={btn("outline", "sm")}>
        Today
      </A>
      <A href={withQuery(base, { week: addDays(monday, 7) })} className={btn("outline", "sm")} aria-label="Next week">
        <Icon name="right" size={16} />
      </A>
      <span className="ml-1 text-sm font-medium text-ink/70">{fmtWeekRange(monday)}</span>
    </div>
  );
}

// ───────────────────────── booking ─────────────────────────

export function BookButton({ s, signedIn }: { s: SessionView; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const isFull = s.spots_left <= 0;
  const label = isFull ? "Join Waitlist" : "Book";
  const style = cx(btn(isFull ? "outline" : "primary", "sm"), "min-w-[112px]");
  if (!signedIn) {
    return (
      <A href={withQuery("/login", { next: "/schedule" })} className={style}>
        {label}
      </A>
    );
  }
  return (
    <>
      <button className={style} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={isFull ? "Join the waitlist" : "Confirm your booking"}>
        <div className="rounded-xl bg-paper p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SessionMark type={s.session_type} /> {sessionLabel(s)}
          </div>
          {s.title && <div className="mt-1 text-sm font-medium">{s.title}</div>}
          <div className="mt-2 space-y-1 text-sm text-ink/70">
            <div className="flex items-center gap-2">
              <Icon name="calendar" size={15} /> {fmtDayLong(s.starts_at)}, {fmtRange(s.starts_at, s.ends_at)}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="pin" size={15} /> {placeLabel(s)}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="card" size={15} /> {priceLabel(s)}
            </div>
          </div>
        </div>
        {isFull && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#E1EAF0] p-3 text-sm text-[#2D5068]">
            <TennisBall size={26} className="ball-bounce shrink-0" />
            <span>
              <span className="block font-semibold">{s.waitlist === 0 ? "You'd be first in line" : `You'd be #${s.waitlist + 1} in line`}</span>
              The moment a spot opens, the first player in line moves in automatically. No need to check back.
            </span>
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className={btn("ghost")} onClick={() => setOpen(false)}>
            Not now
          </button>
          <button
            className={btn("primary")}
            disabled={pending}
            data-autofocus
            onClick={async (e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const r = await run("bookSession", { session_id: s.id });
              if (r.ok) {
                setOpen(false);
                ballBurst({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
              }
            }}
          >
            {pending && <Spinner />}
            {isFull ? "Join waitlist" : "Confirm booking"}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function CancelButton({ bookingId, status, session, window, position }: { bookingId: string; status: string; session: SessionView; window: number; position?: number | null }) {
  const hours = (new Date(session.starts_at).getTime() - Date.now()) / 3600000;
  const leaving = status === "waitlisted";
  const late = !leaving && hours < window;
  return (
    <ActionButton
      action="cancelBooking"
      input={{ booking_id: bookingId }}
      variant="ghost"
      size="sm"
      confirm={{
        title: leaving ? "Leave the waitlist?" : "Cancel this booking?",
        body: (
          <div className="space-y-3">
            <p>
              {sessionLabel(session)} · {fmtDayRange(session.starts_at, session.ends_at)}
            </p>
            {leaving && position ? <p className="text-ink/60">{position === 1 ? "You're next in line. If a spot opens, it goes to the next player instead." : `You'd give up your #${position} place in line.`}</p> : null}
            {late && <Notice tone="warn">This is within {window} hours of the start, so it counts as a late cancellation.</Notice>}
          </div>
        ),
        label: leaving ? "Leave the line" : "Cancel booking",
        danger: true,
      }}
    >
      {leaving ? "Leave" : "Cancel"}
    </ActionButton>
  );
}

// ───────────────────────── seats left (players) ─────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The wording tightens as a session fills. Every line comes from the real counts. */
export function seatCopy(s: Pick<SessionView, "booked" | "capacity" | "spots_left" | "waitlist" | "my_booking">) {
  const left = s.spots_left;
  const imIn = s.my_booking?.status === "confirmed";
  const place = s.my_booking?.status === "waitlisted" ? (s.my_booking.waitlist_position ?? null) : null;
  if (place !== null) {
    const behind = Math.max(0, s.waitlist - place);
    if (place === 1) return { heat: "line" as const, title: "You're next in", sub: behind ? `First open spot is yours · ${behind} behind you` : "First open spot is yours" };
    return { heat: "line" as const, title: `#${place} in line`, sub: `${plural(place - 1, "player")} ahead of you` };
  }
  const others = s.booked - (imIn ? 1 : 0);
  const heat = left === 0 ? ("full" as const) : left <= 2 && s.booked > 0 ? ("low" as const) : ("open" as const);
  if (left === 0) return { heat, title: "Full", sub: imIn ? `You + ${plural(others, "other")}` : s.waitlist > 0 ? `${s.waitlist} waiting` : "Waitlist open" };
  if (s.booked === 0) return { heat, title: "Be the first in", sub: `${plural(left, "spot")} open` };
  const title = left === 1 ? "Last spot" : left === 2 ? "Only 2 spots left" : `${left} spots left`;
  if (imIn) return { heat, title, sub: others === 0 ? "You're the first in" : `You + ${plural(others, "other")}` };
  return { heat, title, sub: `Join ${others} other ${others === 1 ? "player" : "players"}` };
}

const HEAT_TEXT = { open: "text-ink", low: "text-[#8A5A10]", full: "text-[#8E3326]", line: "text-[#2D5068]" };
const HEAT_FILL = { low: "#B5672C", full: "#B9574A" };

function SeatMeter({ s }: { s: SessionView }) {
  const { heat, title, sub } = seatCopy(s);
  const fill = heat === "open" ? sessionColor(s) : HEAT_FILL[heat === "line" ? "full" : heat];
  const taken = Math.min(s.booked, s.capacity);
  const imIn = s.my_booking?.status === "confirmed";
  const large = s.capacity <= 8;
  return (
    <>
      {s.capacity <= 14 ? (
        <div className={cx("flex w-full sm:w-auto sm:justify-end", large ? "gap-1" : "gap-[3px]")} aria-hidden="true">
          {Array.from({ length: s.capacity }, (_, i) => {
            const isTaken = i < taken;
            const size = large ? "h-[22px] w-[22px]" : "h-3.5 w-3.5";
            if (!isTaken) {
              const isNext = i === taken && !s.my_booking;
              return <span key={i} className={cx("shrink-0 rounded-full border-[1.5px] border-dashed border-ink/20", size, isNext && "seat-next")} style={{ borderColor: isNext ? fill : undefined, color: fill }} />;
            }
            return (
              <span key={i} className={cx("seat-taken flex shrink-0 items-center justify-center rounded-full text-white", size)} style={{ background: fill, animationDelay: `${i * 45}ms` }}>
                {large && <Icon name={imIn && i === 0 ? "check" : "user"} size={13} strokeWidth={2.4} />}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.07] sm:w-40" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${(taken / s.capacity) * 100}%`, background: fill }} />
        </div>
      )}
      {heat === "line" && <WaitLine place={s.my_booking!.waitlist_position ?? 1} total={Math.max(s.waitlist, s.my_booking!.waitlist_position ?? 1)} />}
      <div className="min-w-0 sm:text-right">
        <div className={cx("text-sm leading-tight font-semibold", HEAT_TEXT[heat])}>{title}</div>
        <div className="mt-0.5 text-xs text-ink/55">{sub}</div>
      </div>
    </>
  );
}

/** The line to get in, front first: the players ahead, you as a tennis ball (bouncing when you're next), and whoever is behind. */
function WaitLine({ place, total }: { place: number; total: number }) {
  const ahead = place - 1;
  const behind = Math.max(0, total - place);
  const dot = "h-3.5 w-3.5 shrink-0 rounded-full";
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto sm:justify-end" aria-hidden="true">
      <span className="mr-1 text-[10.5px] font-semibold tracking-wide text-ink/40 uppercase">Line</span>
      {ahead > 3 && <span className="text-[11px] text-ink/45 tabular-nums">+{ahead - 3}</span>}
      {Array.from({ length: Math.min(ahead, 3) }, (_, i) => (
        <span key={`a${i}`} className={cx(dot, "bg-ink/25")} />
      ))}
      <span className="relative mx-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#E1EAF0] ring-2 ring-[#2D5068]/30">
        <TennisBall size={20} className={place === 1 ? "ball-bounce" : undefined} />
      </span>
      {Array.from({ length: Math.min(behind, 3) }, (_, i) => (
        <span key={`b${i}`} className={cx(dot, "border-[1.5px] border-dashed border-ink/20")} />
      ))}
      {behind > 3 && <span className="text-[11px] text-ink/45 tabular-nums">+{behind - 3}</span>}
    </div>
  );
}

/** Another session of the same kind with room right now, so a waiting player can skip the line. */
export function skipTheLine(s: SessionView, all: SessionView[]) {
  if (s.my_booking?.status !== "waitlisted") return undefined;
  const now = Date.now();
  const at = new Date(s.starts_at).getTime();
  return all
    .filter((o) => o.id !== s.id && o.session_type === s.session_type && o.spots_left > 0 && !o.my_booking && new Date(o.starts_at).getTime() > now)
    .sort((a, b) => Math.abs(new Date(a.starts_at).getTime() - at) - Math.abs(new Date(b.starts_at).getTime() - at))[0];
}

const SEEN_WAITING = "waitlist-seen";

/** Remembers which bookings this browser saw on a waitlist, so the move in can be celebrated once. */
function usePromotedCelebration(booking: SessionView["my_booking"], ref: RefObject<HTMLElement | null>) {
  const toast = useToast();
  const [promoted, setPromoted] = useState(false);
  useEffect(() => {
    if (!booking) return;
    try {
      const seen: string[] = JSON.parse(localStorage.getItem(SEEN_WAITING) || "[]");
      if (booking.status === "waitlisted" && !seen.includes(booking.id)) {
        localStorage.setItem(SEEN_WAITING, JSON.stringify([...seen, booking.id].slice(-30)));
      } else if (booking.status === "confirmed" && seen.includes(booking.id)) {
        localStorage.setItem(SEEN_WAITING, JSON.stringify(seen.filter((x) => x !== booking.id)));
        setPromoted(true);
        toast("A spot opened and you're in. See you on court!");
        const box = ref.current?.getBoundingClientRect();
        if (box) setTimeout(() => ballBurst({ x: box.right - 80, y: box.top + box.height / 2 }), 250);
      }
    } catch {
      // Storage can be blocked; the card still shows "You're in".
    }
  }, [booking?.id, booking?.status]);
  return promoted;
}

// ───────────────────────── session card (players) ─────────────────────────

export function SessionCard({ s, signedIn, window, showDay, skip }: { s: SessionView; signedIn: boolean; window: number; showDay?: boolean; skip?: SessionView }) {
  const mine = s.my_booking;
  const imIn = mine?.status === "confirmed";
  const hoursAway = (new Date(s.starts_at).getTime() - Date.now()) / 3600000;
  const ref = useRef<HTMLElement>(null);
  const promoted = usePromotedCelebration(mine, ref);
  return (
    <article ref={ref} className="relative px-4 py-4 md:px-5" style={imIn ? { background: `color-mix(in oklab, ${sessionColor(s)} 7%, white)` } : undefined}>
      {imIn && <span className="absolute inset-y-0 left-0 w-1" style={{ background: sessionColor(s) }} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold" style={{ color: sessionColor(s) }}>
            <SessionMark type={s.session_type} /> {sessionLabel(s)}
            {imIn && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] text-white" style={{ background: sessionColor(s) }}>
                <Icon name="check" size={12} strokeWidth={2.6} /> {promoted ? "Off the waitlist. You're in!" : <>You&apos;re in</>}
              </span>
            )}
            {hoursAway > 0 && hoursAway < 12 && <Badge tone="amber">Starts {relativeFromNow(s.starts_at)}</Badge>}
          </div>
          {s.title && <h3 className="mt-1 text-[17px] leading-snug font-semibold">{s.title}</h3>}
          <div className="mt-1.5 space-y-0.5 text-sm text-ink/70">
            <div className="font-medium text-ink">{showDay ? fmtDateTime(s.starts_at) : fmtRange(s.starts_at, s.ends_at)}</div>
            <div>{placeLabel(s)}</div>
            <div>
              {s.coaches.length > 0 && `${s.coaches.map((c) => c.full_name.split(" ")[0]).join(" & ")} · `}
              {priceLabel(s)}
            </div>
          </div>
          {s.description && <p className="mt-2 text-sm whitespace-pre-line text-ink/60">{s.description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2.5 sm:flex-col sm:flex-nowrap sm:items-end">
          <SeatMeter s={s} />
          {mine ? (
            <div className="flex items-center gap-2">
              {mine.status !== "waitlisted" && <BookingBadge status={mine.status} position={mine.waitlist_position} />}
              <CancelButton bookingId={mine.id} status={mine.status} session={s} window={window} position={mine.waitlist_position} />
            </div>
          ) : (
            <BookButton s={s} signedIn={signedIn} />
          )}
        </div>
      </div>
      {skip && (
        <div className="mt-3 flex flex-col gap-2.5 rounded-xl bg-paper p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm">
            <Icon name="spark" size={17} className="mt-0.5 shrink-0 text-[#B5672C]" />
            <span>
              <span className="font-semibold">Skip the line.</span>{" "}
              <span className="text-ink/70">
                {skip.title || sessionLabel(skip)} {whenWord(skip.starts_at, dateKey(new Date().toISOString()))}, {fmtRange(skip.starts_at, skip.ends_at)} has {plural(skip.spots_left, "spot")} open.
              </span>
            </span>
          </div>
          <BookButton s={skip} signedIn={signedIn} />
        </div>
      )}
    </article>
  );
}

// ───────────────────────── time grid (coaches) ─────────────────────────

const HOUR_PX = 54;

export function WeekGrid({
  days,
  today,
  items,
  newHref,
  nowIso,
}: {
  days: string[];
  today: string;
  items: ScheduleItem[];
  newHref?: (day: string, time: string) => string;
  nowIso?: string;
}) {
  const mins = items.flatMap((s) => [minutesOfDay(s.starts_at), minutesOfDay(s.ends_at) || 24 * 60]);
  const startH = Math.min(7, ...mins.map((m) => Math.floor(m / 60)));
  const endH = Math.max(21, ...mins.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const height = hours.length * HOUR_PX;
  const nowMin = nowIso ? minutesOfDay(nowIso) : null;
  const nowDay = nowIso ? dateKey(nowIso) : null;
  // On a phone, this week's list starts today rather than with days already gone.
  const phoneDays = days.includes(today) ? days.filter((d) => d >= today) : days;

  return (
    <>
      {/* Phones: a simple day-by-day list */}
      <div className="space-y-4 md:hidden">
        {phoneDays.map((d) => {
          const list = items.filter((s) => dateKey(s.starts_at) === d);
          return (
            <section key={d} className="card overflow-hidden">
              <div className={cx("flex items-center justify-between border-b border-ink/[0.06] px-4 py-2.5", d === today ? "bg-sage/50" : "bg-paper/60")}>
                <h3 className="text-sm font-semibold">{fmtKeyLong(d)}</h3>
                {newHref && (
                  <A href={newHref(d, "08:00")} className="rounded-lg p-1 text-brand" aria-label={`Add a lesson on ${fmtKeyLong(d)}`}>
                    <Icon name="plus" size={18} />
                  </A>
                )}
              </div>
              {list.length ? (
                <div className="divide-y divide-ink/[0.06]">
                  {list.map((s) => (
                    <A key={s.id} href={s.href} className={cx("flex items-center gap-3 px-4 py-3 active:bg-paper", s.cancelled && "opacity-50")}>
                      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="min-w-0 flex-1">
                        <span className={cx("flex items-center gap-1.5 text-[15px] font-semibold", s.cancelled && "line-through")}>
                          {s.session_type && <SessionMark type={s.session_type} size={14} />}
                          <span className="truncate">{s.title}</span>
                        </span>
                        <span className="block truncate text-[13px] text-ink/55">
                          {fmtRange(s.starts_at, s.ends_at)} · {s.label}
                        </span>
                      </span>
                      <Icon name="right" size={16} className="text-ink/30" />
                    </A>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-ink/40">Nothing scheduled</p>
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
              const dayItems = items.filter((s) => dateKey(s.starts_at) === d);
              return (
                <div key={d} className={cx("relative border-l border-ink/[0.05]", d === today && "bg-sage/20")}>
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-ink/[0.05]" style={{ top: i * HOUR_PX, height: HOUR_PX }}>
                      {newHref && (
                        <A href={newHref(d, `${String(h).padStart(2, "0")}:00`)} className="group block h-full w-full hover:bg-sage/30" aria-label={`Add a lesson on ${d} at ${h}:00`}>
                          <span className="hidden px-1.5 pt-1 text-[11px] font-medium text-brand group-hover:block">+ Lesson</span>
                        </A>
                      )}
                    </div>
                  ))}
                  {nowDay === d && nowMin !== null && nowMin >= startH * 60 && nowMin <= endH * 60 && (
                    <div className="pointer-events-none absolute inset-x-0 z-[5] h-px bg-[#B9574A]" style={{ top: ((nowMin - startH * 60) / 60) * HOUR_PX }}>
                      <span className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-[#B9574A]" />
                    </div>
                  )}
                  {dayItems.map((s) => {
                    const top = ((minutesOfDay(s.starts_at) - startH * 60) / 60) * HOUR_PX;
                    const h = Math.max(26, ((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000) * HOUR_PX - 3);
                    return (
                      <div key={s.id} className="absolute inset-x-1 z-[6] hover:z-20" style={{ top: top + 1, height: h }}>
                        <A
                          href={s.href}
                          title={`${s.title === s.label ? s.label : `${s.label}: ${s.title}`} · ${fmtRange(s.starts_at, s.ends_at)}`}
                          className={cx("relative block h-full overflow-hidden rounded-lg px-2 py-1.5 pl-2.5 text-left text-[12px] leading-tight shadow-sm transition-transform hover:-translate-y-px hover:shadow-md", s.cancelled && "opacity-50")}
                        >
                          <span className="absolute inset-0" style={{ background: s.color, opacity: 0.15 }} />
                          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.color }} />
                          {s.session_type && h > 56 && <SessionMark type={s.session_type} size={44} className="absolute right-1.5 bottom-1 opacity-[0.14]" />}
                          <span className={cx("relative flex items-center gap-1 font-semibold text-ink", s.cancelled && "line-through")}>
                            {s.session_type && <SessionMark type={s.session_type} size={12} />}
                            <span className="truncate">{s.title}</span>
                          </span>
                          <span className="relative block truncate text-ink/60">{fmtRange(s.starts_at, s.ends_at)}</span>
                          {h > 56 && <span className="relative mt-1 block truncate text-ink/60">{s.cancelled ? <Badge>Cancelled</Badge> : s.detail}</span>}
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

// ───────────────────────── add to calendar ─────────────────────────

const gcalStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A Google Calendar "add event" link, filled in from the session. Nothing is sent until the player opens it. */
export function calendarHref(s: Pick<SessionView, "session_type" | "title" | "starts_at" | "ends_at" | "location" | "court" | "description">) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: sessionTitle(s), dates: `${gcalStamp(s.starts_at)}/${gcalStamp(s.ends_at)}`, location: placeLabel(s), details: s.description });
  return `https://calendar.google.com/calendar/render?${q}`;
}
