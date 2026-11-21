import { useEffect, useRef, useState } from "react";
import { A, useAction, withQuery } from "./nav";
import { bookedTakeover, EventMark, Icon, SessionMark } from "./icons";
import { ActionButton, ActionForm, Badge, BookingBadge, btn, cx, Coaches, Modal, Notice, Place, Spinner, Submit } from "./kit";
import type { ScheduleItem, SessionView } from "@/core/queries";
import { addDays, dateKey, fmtClock, fmtDateTime, fmtDay, fmtDayLong, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange, fmtTime, fmtWeekday, fmtWeekRange, minutesOfDay, relativeFromNow, timeKey } from "@/core/time";
import { courtPlan, decideBy, needsDecision, placeLabel, sessionTitle, SESSION_META } from "@/core/util";

/** Diagonal lines over a night that isn't on for the coach (a clinic someone else covered). */
// A covered clinic night on the week grid: pale grey with fine grey lines, so it reads as "not yours" without shouting.
const HATCH_SOFT = "repeating-linear-gradient(135deg, rgba(20,30,25,0.07) 0 2px, transparent 2px 8px)";
// A soft sheen and a darker stripe down the left edge give solid event blocks a little depth, as Apple Calendar does.
const EVENT_SHEEN = "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 60%)";

export const sessionColor = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].color;
const sessionLabel = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].label;
const takeoverDetails = (s: SessionView) => ({ label: sessionLabel(s), color: sessionColor(s), day: fmtDayLong(s.starts_at), time: fmtRange(s.starts_at, s.ends_at) });

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
      <span className="ml-1.5 font-display text-[17px] font-semibold tracking-tight">{fmtWeekRange(monday)}</span>
    </div>
  );
}

// ───────────────────────── booking ─────────────────────────

/** When a booking stops being free to cancel, said where the player decides. */
export function cancelNote(s: Pick<SessionView, "starts_at">, window: number, now = Date.now()) {
  const until = new Date(new Date(s.starts_at).getTime() - window * 3600000);
  if (until.getTime() > now) return `Free to cancel until ${fmtDay(until)} at ${fmtTime(until)}. After that you can offer your spot to someone else.`;
  return `It's less than ${window} hours away, so once you're booked you can't cancel. You can still offer your spot to someone else.`;
}

export function BookButton({ s, signedIn, window }: { s: SessionView; signedIn: boolean; window: number }) {
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
            <Place p={s} />
          </div>
        </div>
        {!isFull && (
          <p className="mt-3 flex items-start gap-2 px-1 text-sm text-ink/65">
            <Icon name="clock" size={15} className="mt-0.5 shrink-0" />
            <span>{cancelNote(s, window)}</span>
          </p>
        )}
        {!isFull && courtHeadsUp(s) && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#B5672C]/25 bg-[#FBEEE2] p-3.5 text-sm text-[#7A3E12]">
            <Icon name="flag" size={15} className="mt-0.5 shrink-0" />
            <span>{courtHeadsUp(s)}</span>
          </div>
        )}
        {isFull && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-[#B5672C]/25 bg-[#FBEEE2] p-3.5 text-sm text-[#7A3E12]">
            <span>
              <span className="flex items-center gap-1 text-[10.5px] font-bold tracking-wider text-[#B5672C] uppercase">
                <Icon name="clock" size={12} strokeWidth={2.4} /> Waitlist
              </span>
              <span className="mt-0.5 block font-semibold">{s.waitlist === 0 ? "You'd be next in" : `You'd be #${s.waitlist + 1} on the waitlist`}</span>
              <span className="text-[#7A3E12]/70">The moment a spot opens, the next player moves in automatically. No need to check back.</span>
            </span>
            <span className="font-display text-[34px] leading-none font-semibold text-[#B5672C] tabular-nums">#{s.waitlist + 1}</span>
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
            onClick={async () => {
              const headsUp = !isFull && courtHeadsUp(s);
              const r = await run("bookSession", { session_id: s.id });
              if (r.ok) {
                setOpen(false);
                // Someone may have booked or left since the page loaded, so go by where the player actually landed.
                const placed = r.data as { status: string; waitlist_position: number | null } | undefined;
                const waiting = placed ? placed.status === "waitlisted" : isFull;
                const position = placed?.waitlist_position ?? s.waitlist + 1;
                bookedTakeover({
                  ...takeoverDetails(s),
                  title: waiting ? "You're on the waitlist" : "You're booked",
                  note: waiting ? `#${position} in line. We'll move you in if a spot opens.` : headsUp ? `${courtPlan(s).minimum - s.booked - 1} more needed. Your coach confirms by ${shortWhen(decideBy(s))}.` : "See you on court!",
                });
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

const hoursUntil = (s: Pick<SessionView, "starts_at">) => (new Date(s.starts_at).getTime() - Date.now()) / 3600000;

export function CancelButton({ bookingId, status, session, position }: { bookingId: string; status: string; session: SessionView; position?: number | null }) {
  const leaving = status === "waitlisted";
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

/** Inside the cancellation window a booked player can't cancel, only offer the spot to someone else. */
function OfferSpotButton({ bookingId, session, window }: { bookingId: string; session: SessionView; window: number }) {
  return (
    <ActionButton
      action="offerSpot"
      input={{ booking_id: bookingId }}
      variant="ghost"
      size="sm"
      confirm={{
        title: "Offer your spot?",
        body: (
          <div className="space-y-3">
            <p>
              {sessionLabel(session)} · {fmtDayRange(session.starts_at, session.ends_at)}
            </p>
            <Notice tone="warn">It's less than {window} hours to the session, so you can't cancel.</Notice>
            <p>We'll offer your spot to {session.waitlist > 0 ? `the ${plural(session.waitlist, "player")} on the waitlist` : "the waitlist"} and anyone else who wants it. Until then, you're still booked.</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-semibold text-ink">Someone takes it:</span> they play instead of you, and you don't pay.
              </li>
              <li>
                <span className="font-semibold text-ink">Nobody takes it:</span> you're still booked and you pay for the session.
              </li>
            </ul>
          </div>
        ),
        label: "Offer my spot",
      }}
    >
      Offer my spot
    </ActionButton>
  );
}

function shareOfferHref(s: SessionView) {
  const link = `${window.location.origin}${window.location.pathname}#/schedule`;
  const text = `I can't make ${sessionLabel(s)} on ${fmtDateTime(s.starts_at)}. My spot is free, first to take it gets it: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Someone booked can't make it and is offering their spot. The first to tap gets it. */
export function TakeSpotButton({ s, signedIn }: { s: SessionView; signedIn: boolean }) {
  const style = cx(btn("primary", "sm"), "min-w-[112px]");
  if (!signedIn) {
    return (
      <A href={withQuery("/login", { next: "/schedule" })} className={style}>
        Take spot
      </A>
    );
  }
  return (
    <ActionButton
      action="takeSpot"
      input={{ session_id: s.id }}
      variant="primary"
      size="sm"
      className="min-w-[112px]"
      confirm={{
        title: "Take this spot?",
        body: (
          <div className="space-y-3">
            <p>
              {sessionLabel(s)} · {fmtDayRange(s.starts_at, s.ends_at)}
            </p>
            <p>A player can't make it, so their spot is free. Take it and you're booked in.</p>
          </div>
        ),
        label: "Take spot",
      }}
    >
      Take spot
    </ActionButton>
  );
}

/** The badge and buttons for a session the player is booked or waitlisted on. */
/** Where the player stands: booked, on the waitlist, or offering their spot. */
export function MyBookingStatus({ s }: { s: SessionView }) {
  const mine = s.my_booking!;
  if (mine.status === "confirmed" && mine.spot_offered_at) return <Badge tone="amber">Spot offered</Badge>;
  return <BookingBadge status={mine.status} position={mine.waitlist_position} />;
}

export function MyBookingActions({ s, window, status = true }: { s: SessionView; window: number; status?: boolean }) {
  const mine = s.my_booking!;
  // Without the status, the buttons join the caller's row so each one wraps on its own.
  const wrap = status ? "flex flex-wrap items-center gap-2" : "contents";
  if (mine.status === "confirmed" && mine.spot_offered_at) {
    return (
      <div className={wrap}>
        {status && <MyBookingStatus s={s} />}
        <a href={shareOfferHref(s)} target="_blank" rel="noreferrer" className={btn("ghost", "sm")} title="Share on WhatsApp">
          <Icon name="message" size={15} /> Share
        </a>
        <ActionButton action="withdrawOffer" input={{ booking_id: mine.id }} variant="ghost" size="sm">
          Take it back
        </ActionButton>
      </div>
    );
  }
  const late = mine.status === "confirmed" && hoursUntil(s) < window;
  return (
    <div className={wrap}>
      {status && <MyBookingStatus s={s} />}
      {mine.status === "waitlisted" && s.offered > 0 && <TakeSpotButton s={s} signedIn />}
      {late ? <OfferSpotButton bookingId={mine.id} session={s} window={window} /> : <CancelButton bookingId={mine.id} status={mine.status} session={s} position={mine.waitlist_position} />}
    </div>
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
    return { heat: "full" as const, title: "Full", sub: place === 1 ? "First open spot is yours" : `${plural(place - 1, "player")} ahead of you` };
  }
  const others = s.booked - (imIn ? 1 : 0);
  const heat = left === 0 ? ("full" as const) : left <= 2 && s.booked > 0 ? ("low" as const) : ("open" as const);
  if (left === 0) return { heat, title: "Full", sub: imIn ? `You + ${plural(others, "other")}` : s.waitlist > 0 ? `${s.waitlist} waiting` : "Waitlist open" };
  if (s.booked === 0) return { heat, title: "Be the first in", sub: `${plural(left, "spot")} open` };
  const title = left === 1 ? "Last spot" : left === 2 ? "Only 2 spots left" : `${left} spots left`;
  if (imIn) return { heat, title, sub: others === 0 ? "You're the first in" : `You + ${plural(others, "other")}` };
  return { heat, title, sub: `Join ${others} other ${others === 1 ? "player" : "players"}` };
}

/** Two-court sessions say so, and until they have enough players, how many more they need. */
/** Only while a two-court session is short of its minimum; the dots already show the two courts. */
export function courtNote(s: Pick<SessionView, "session_type" | "capacity" | "booked" | "status" | "decided_at" | "decide_by" | "starts_at">, now = Date.now()) {
  if (!needsDecision(s)) return null;
  const by = decideBy(s);
  return new Date(by).getTime() <= now ? "Coach is confirming" : `${courtPlan(s).minimum - s.booked} more needed by ${shortWhen(by)}`;
}
/** "Sat 6 AM": close enough to read at a glance, since the session itself is within days. */
const shortWhen = (iso: string) => `${fmtWeekday(iso)} ${fmtTime(iso)}`;

/** Booking a two-court session that your spot won't fill to its minimum. */
export function courtHeadsUp(s: SessionView) {
  if (!needsDecision(s) || s.booked + 1 >= courtPlan(s).minimum) return null;
  return `Needs ${courtPlan(s).minimum} players to run on 2 courts. Your coach confirms by ${shortWhen(decideBy(s))}.`;
}

const HEAT_TEXT = { open: "text-ink", low: "text-[#8A5A10]", full: "text-[#8E3326]" };
const HEAT_FILL = { low: "#B5672C", full: "#B9574A" };

function SeatMeter({ s }: { s: SessionView }) {
  const { heat, title, sub } = seatCopy(s);
  const fill = heat === "open" ? sessionColor(s) : HEAT_FILL[heat];
  const taken = Math.min(s.booked, s.capacity);
  const imIn = s.my_booking?.status === "confirmed";
  const { courts, minimum } = courtPlan(s);
  // Spots are shared evenly between courts: 8 on two courts is 4 | 4, not 6 | 2.
  const perCourt = Math.ceil(s.capacity / courts);
  // Two courts keep the same big dots as one; they're a touch smaller on a phone so all 12 fit on a line.
  const twoCourts = courts === 2;
  const large = s.capacity <= 8 || twoCourts;
  const note = courtNote(s);
  const short = !!note; // still under the minimum: those empty seats get an amber ring
  const seat = (i: number) => {
    const isTaken = i < taken;
    const size = twoCourts ? "h-5 w-5 sm:h-[22px] sm:w-[22px]" : large ? "h-[22px] w-[22px]" : "h-3.5 w-3.5";
    if (!isTaken) {
      const isNext = i === taken && !s.my_booking;
      const needed = short && i < minimum;
      return <span key={i} className={cx("shrink-0 rounded-full border-[1.5px] border-dashed", needed ? "border-[#B5672C]/55" : "border-ink/20", size, isNext && "seat-next")} style={{ borderColor: isNext ? fill : undefined, color: fill }} />;
    }
    return (
      <span key={i} className={cx("seat-taken flex shrink-0 items-center justify-center rounded-full text-white", size)} style={{ background: fill, animationDelay: `${i * 45}ms` }}>
        {large && <Icon name={imIn && i === 0 ? "check" : "user"} size={13} strokeWidth={2.4} />}
      </span>
    );
  };
  return (
    <>
      {s.capacity <= 14 ? (
        <div className={cx("flex w-full items-center sm:w-auto sm:justify-end", large ? "gap-1" : "gap-[3px]")} aria-hidden="true">
          {/* One run of dots per court, with a short net line between courts. */}
          {Array.from({ length: courts }, (_, c) => (
            <span key={c} className={cx("flex items-center", large ? "gap-1" : "gap-[3px]")}>
              {c > 0 && <span className="mx-1 h-7 w-[2px] shrink-0 rounded-full bg-ink/25" />}
              {Array.from({ length: Math.min(perCourt, s.capacity - c * perCourt) }, (_, j) => seat(c * perCourt + j))}
            </span>
          ))}
        </div>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.07] sm:w-40" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${(taken / s.capacity) * 100}%`, background: fill }} />
        </div>
      )}
      <div className="min-w-0 sm:text-right">
        <div className={cx("text-sm leading-tight font-semibold", HEAT_TEXT[heat])}>{title}</div>
        <div className="mt-0.5 text-xs text-ink/55">{sub}</div>
        {note && <div className="mt-0.5 text-xs font-medium text-[#8A5A10]">{note}</div>}
      </div>
    </>
  );
}

/** The decide-by line, with a way to move it. Players see whatever time is set here. */
function DecideBy({ s, by, late }: { s: SessionView; by: string; late: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ActionForm action="setDecideBy" hidden={{ session_id: s.id }} onDone={(r) => r.ok && setEditing(false)} className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input w-auto bg-white py-1.5 text-sm" type="datetime-local" name="at" step={900} defaultValue={`${dateKey(by)}T${timeKey(by)}`} max={`${dateKey(s.starts_at)}T${timeKey(s.starts_at)}`} aria-label="Decide by" />
        <Submit size="sm">Save</Submit>
        <button type="button" className={btn("ghost", "sm")} onClick={() => setEditing(false)}>
          Keep time
        </button>
      </ActionForm>
    );
  }
  return (
    <p className="mt-0.5 text-sm">
      {late ? "The decide-by time has passed. Decide now so players know." : `Decide by ${fmtDateTime(by)}${s.decide_by ? "" : ", 12 hours before"}. Players see this time.`}{" "}
      <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setEditing(true)}>
        Change
      </button>
    </p>
  );
}

const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]);

/** Coaches and admins: a two-court session under its minimum needs a call by 12 hours before. */
export function DecisionCard({ s, booked = [] }: { s: SessionView; booked?: { name: string; at: string }[] }) {
  if (!needsDecision(s) || new Date(s.starts_at).getTime() <= Date.now()) return null;
  const { size, minimum } = courtPlan(s);
  const by = decideBy(s);
  const late = new Date(by).getTime() <= Date.now();
  const bumped = Math.max(0, s.booked - size);
  // Same order as the move itself: the earliest sign-ups keep their spots.
  const names = [...booked].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(size).map((p) => p.name);
  const who = names.length === bumped && bumped ? listNames(names) : `the other ${bumped}`;
  return (
    <div className="rounded-2xl bg-[#F6EBD3] p-4 text-[#6E4A0E] md:p-5">
      <div className="flex items-start gap-3">
        <Icon name="flag" size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="font-semibold">
            {s.booked} of {minimum} signed up for two courts
          </h3>
          <DecideBy s={s} by={by} late={late} />
        </div>
      </div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        <ActionButton action="decideSession" input={{ session_id: s.id, choice: "run" }} variant="primary" icon="check" confirm={{ title: "Run it on two courts?", body: `It goes ahead with ${s.booked} player${s.booked === 1 ? "" : "s"}.`, label: "Run it" }}>
          Run on 2 courts
        </ActionButton>
        <ActionButton
          action="decideSession"
          input={{ session_id: s.id, choice: "one_court" }}
          confirm={{ title: "Move to one court?", body: bumped ? `Capacity drops to ${size}. The first ${size} sign-ups keep their spots; ${who} ${bumped === 1 ? "goes" : "go"} to the front of the waitlist.` : `Capacity drops to ${size}. Everyone booked keeps their spot.`, label: "Move to 1 court" }}
        >
          Move to 1 court
        </ActionButton>
        <ActionButton action="decideSession" input={{ session_id: s.id, choice: "cancel" }} variant="danger" confirm={{ title: "Cancel this session?", body: `${s.booked + s.waitlist} booking(s) will be cancelled. Tell players on WhatsApp.`, label: "Cancel session", danger: true }}>
          Cancel
        </ActionButton>
      </div>
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
function usePromotedCelebration(s: SessionView) {
  const booking = s.my_booking;
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
        setTimeout(
          () => bookedTakeover({ ...takeoverDetails(s), title: "A spot opened. You're in!", note: "See you on court!" }),
          250,
        );
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
  const promoted = usePromotedCelebration(s);
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
            <Place p={s} />
            <Coaches people={s.coaches} className="py-0.5" />
          </div>
          {s.description && <p className="mt-2 text-sm whitespace-pre-line text-ink/60">{s.description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2.5 sm:flex-col sm:flex-nowrap sm:items-end">
          <SeatMeter s={s} />
          {mine ? (
            <MyBookingActions s={s} window={window} />
          ) : s.spots_left <= 0 && s.offered > 0 ? (
            <TakeSpotButton s={s} signedIn={signedIn} />
          ) : (
            <BookButton s={s} signedIn={signedIn} window={window} />
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
          <BookButton s={skip} signedIn={signedIn} window={window} />
        </div>
      )}
    </article>
  );
}

// ───────────────────────── time grid (coaches) ─────────────────────────

const HOUR_PX = 64;
const SNAP = 30; // minutes: every drag lands on a half hour
const TIME_COL = 52;
const COLS = `${TIME_COL}px repeat(7, minmax(0, 1fr))`;

/** A stretch of one day on the grid, in minutes from midnight. */
export interface GridSlot {
  day: string;
  start: number;
  end: number;
}

export const slotTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const slotLabel = (s: GridSlot) => `${fmtClock(slotTime(s.start))} – ${fmtClock(slotTime(s.end))}`;

type Drag = { kind: "new"; anchor: number; slot: GridSlot; moved: boolean } | { kind: "move" | "resize"; item: ScheduleItem; from: GridSlot; grab: number; x0: number; y0: number; slot: GridSlot; moved: boolean };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The coach's week. On a computer, dragging over empty time picks a slot for a new lesson, dragging a lesson
 * moves it, and pulling its bottom edge changes its length, all in half-hour steps. A tap picks an hour.
 * Phones get the same grid, scrolled sideways, with the times pinned on the left.
 */
export function WeekGrid({
  days,
  today,
  items,
  nowIso,
  onCreate,
  onMove,
  draft,
}: {
  days: string[];
  today: string;
  items: ScheduleItem[];
  nowIso?: string;
  onCreate?: (slot: GridSlot) => void;
  onMove?: (item: ScheduleItem, slot: GridSlot) => Promise<unknown>;
  draft?: GridSlot | null;
}) {
  const mins = items.flatMap((s) => [minutesOfDay(s.starts_at), minutesOfDay(s.ends_at) || 24 * 60]);
  const startH = Math.min(7, ...mins.map((m) => Math.floor(m / 60)));
  const endH = Math.max(21, ...mins.map((m) => Math.ceil(m / 60)));
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const height = hours.length * HOUR_PX;
  const lo = startH * 60;
  const hi = endH * 60;
  const nowMin = nowIso ? minutesOfDay(nowIso) : null;
  const nowDay = nowIso ? dateKey(nowIso) : null;
  // On a phone only two or three days fit, so the week opens scrolled to today.
  const scroller = useRef<HTMLDivElement>(null);
  const todayAt = days.indexOf(today);
  useEffect(() => {
    const el = scroller.current;
    const col = cols.current[todayAt];
    if (el && col && todayAt > 0 && el.scrollWidth > el.clientWidth) el.scrollLeft = col.offsetLeft - TIME_COL;
  }, [todayAt, days[0]]);

  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [hover, setHover] = useState<{ day: string; min: number } | null>(null);
  // Where a lesson was just dropped, shown until the saved schedule comes back.
  const [placed, setPlaced] = useState<Record<string, GridSlot>>({});
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const skipClick = useRef(false);
  const swallowClick = () => {
    skipClick.current = true;
    setTimeout(() => (skipClick.current = false), 0);
  };

  const slotOf = (s: ScheduleItem): GridSlot => {
    const start = minutesOfDay(s.starts_at);
    return placed[s.id] ?? { day: dateKey(s.starts_at), start, end: start + Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000) };
  };
  const busy = (slot: GridSlot, skipId?: string) =>
    items.some((i) => {
      if (i.cancelled || i.id === skipId) return false;
      const p = slotOf(i);
      return p.day === slot.day && p.start < slot.end && slot.start < p.end;
    });
  const minAt = (col: HTMLElement, y: number) => lo + ((y - col.getBoundingClientRect().top) / HOUR_PX) * 60;
  const dayAt = (x: number) => {
    let best = 0;
    cols.current.forEach((c, i) => {
      if (c && x >= c.getBoundingClientRect().left) best = i;
    });
    return best;
  };
  const box = (s: GridSlot) => ({ top: ((s.start - lo) / 60) * HOUR_PX + 1, height: Math.max(26, ((s.end - s.start) / 60) * HOUR_PX - 3) });

  // A click or tap on empty time books an hour, or half an hour when something follows straight after.
  const pick = (day: string, start: number) => {
    const hour = { day, start, end: Math.min(hi, start + 60) };
    const slot = busy(hour) ? { day, start, end: start + SNAP } : hour;
    if (!busy(slot)) onCreate?.(slot);
  };

  const grabItem = (kind: "move" | "resize", item: ScheduleItem) => (e: React.PointerEvent) => {
    if (!onMove || !item.movable || e.pointerType === "touch" || e.button !== 0) return;
    e.stopPropagation();
    const from = slotOf(item);
    const col = cols.current[days.indexOf(from.day)];
    if (!col) return;
    dragRef.current = { kind, item, from, grab: minAt(col, e.clientY) - from.start, x0: e.clientX, y0: e.clientY, slot: from, moved: false };
    const len = from.end - from.start;
    const move = (ev: PointerEvent) => {
      const g = dragRef.current;
      if (!g || g.kind === "new") return;
      if (!g.moved && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 5) return;
      let slot: GridSlot;
      if (g.kind === "move") {
        const di = dayAt(ev.clientX);
        const start = clamp(Math.round((minAt(cols.current[di]!, ev.clientY) - g.grab) / SNAP) * SNAP, lo, Math.max(lo, hi - len));
        slot = { day: days[di], start, end: start + len };
      } else {
        const end = clamp(Math.round(minAt(col, ev.clientY) / SNAP) * SNAP, lo, hi);
        slot = { ...from, end: Math.max(end, from.start + SNAP) };
      }
      setDrag({ ...g, slot, moved: true });
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const g = dragRef.current;
      setDrag(null);
      if (!g || g.kind === "new" || !g.moved) return;
      swallowClick();
      const same = g.slot.day === from.day && g.slot.start === from.start && g.slot.end === from.end;
      if (same || busy(g.slot, item.id)) return;
      setPlaced((p) => ({ ...p, [item.id]: g.slot }));
      try {
        await onMove(item, g.slot);
      } finally {
        setPlaced((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== item.id)));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const ghost = drag && (drag.kind === "new" || drag.moved) ? drag.slot : (draft ?? null);
  const ghostBusy = !!drag && !!ghost && busy(ghost, drag.kind === "new" ? undefined : drag.item.id);

  return (
    <>
      <div ref={scroller} className="card overflow-x-auto overscroll-x-contain">
        <div className="min-w-[820px]">
          <div className="sticky top-0 z-10 grid border-b border-ink/[0.07] bg-card" style={{ gridTemplateColumns: COLS }}>
            <div className="sticky left-0 z-[9] bg-card" />
            {days.map((d) => (
              <div key={d} className="border-l border-ink/[0.05] px-2 py-2 text-center">
                <div className={cx("text-[11px] font-semibold tracking-wide uppercase", d === today ? "text-brand" : "text-ink/45")}>{fmtKeyWeekday(d)}</div>
                <div className={cx("mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full font-display text-[17px] font-semibold tabular-nums", d === today ? "bg-brand text-paper" : d < today ? "text-ink/45" : "text-ink")}>{fmtKeyNum(d)}</div>
              </div>
            ))}
          </div>
          <div className={cx("relative grid select-none", drag?.moved && (drag.kind === "resize" ? "cursor-ns-resize" : "cursor-grabbing"))} style={{ gridTemplateColumns: COLS, height }}>
            <div className="sticky left-0 z-[25] bg-card">
              {hours.map((h, i) => (
                <div key={h}>
                  {i > 0 && (
                    <div className="absolute right-2.5 -translate-y-1/2 text-[10.5px] font-medium tracking-wide text-ink/40 tabular-nums" style={{ top: i * HOUR_PX }}>
                      {fmtClock(`${String(h).padStart(2, "0")}:00`)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {days.map((d, di) => {
              const dayItems = items.filter((s) => slotOf(s).day === d);
              return (
                <div
                  key={d}
                  ref={(el) => {
                    cols.current[di] = el;
                  }}
                  className={cx("relative touch-pan-y border-l border-ink/[0.05]", d === today ? "bg-sage/25" : di > 4 && "bg-ink/[0.015]", onCreate && "cursor-cell")}
                  onPointerDown={(e) => {
                    if (!onCreate || e.pointerType === "touch" || e.button !== 0 || e.target !== e.currentTarget) return;
                    const anchor = Math.floor(clamp(minAt(e.currentTarget, e.clientY), lo, hi - SNAP) / SNAP) * SNAP;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setHover(null);
                    setDrag({ kind: "new", anchor, slot: { day: d, start: anchor, end: anchor + SNAP }, moved: false });
                  }}
                  onPointerMove={(e) => {
                    const g = dragRef.current;
                    const at = Math.floor(clamp(minAt(e.currentTarget, e.clientY), lo, hi - SNAP) / SNAP) * SNAP;
                    if (g?.kind === "new") {
                      const start = Math.min(g.anchor, at);
                      const end = Math.max(g.anchor, at) + SNAP;
                      if (start !== g.slot.start || end !== g.slot.end) setDrag({ ...g, slot: { day: d, start, end }, moved: true });
                    } else if (!g && onCreate && e.pointerType !== "touch") {
                      const free = e.target === e.currentTarget;
                      if (free ? hover?.day !== d || hover.min !== at : hover) setHover(free ? { day: d, min: at } : null);
                    }
                  }}
                  onPointerUp={() => {
                    const g = dragRef.current;
                    if (g?.kind !== "new") return;
                    setDrag(null);
                    swallowClick();
                    if (!g.moved) pick(d, g.anchor);
                    else if (!busy(g.slot)) onCreate?.(g.slot);
                  }}
                  onPointerCancel={() => dragRef.current?.kind === "new" && setDrag(null)}
                  onPointerLeave={() => setHover(null)}
                  onClick={(e) => {
                    // Taps on a touch screen land here; a mouse press was already handled above.
                    if (skipClick.current || !onCreate || e.target !== e.currentTarget) return;
                    pick(d, Math.floor(clamp(minAt(e.currentTarget, e.clientY), lo, hi - SNAP) / SNAP) * SNAP);
                  }}
                >
                  {hours.map((h, i) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-ink/[0.06]" style={{ top: i * HOUR_PX, height: HOUR_PX }}>
                      <div className="absolute inset-x-0 top-1/2 border-t border-dotted border-ink/[0.05]" />
                    </div>
                  ))}
                  {hover?.day === d && !drag && !draft && (
                    <div className="pointer-events-none absolute inset-x-1 rounded-md bg-sage/50 px-1.5 text-[11px] leading-[30px] font-medium text-brand" style={{ top: ((hover.min - lo) / 60) * HOUR_PX + 1, height: HOUR_PX / 2 - 2 }}>
                      + {fmtClock(slotTime(hover.min))}
                    </div>
                  )}
                  {nowDay === d && nowMin !== null && nowMin >= lo && nowMin <= hi && (
                    <div className="pointer-events-none absolute inset-x-0 z-[7] h-0.5 bg-[#D9483B]" style={{ top: ((nowMin - lo) / 60) * HOUR_PX - 1 }}>
                      <span className="absolute -top-[4px] -left-[5px] h-2.5 w-2.5 rounded-full bg-[#D9483B] ring-2 ring-card" />
                    </div>
                  )}
                  {dayItems.map((s) => {
                    const p = slotOf(s);
                    const { top, height: h } = box(p);
                    const can = !!onMove && !!s.movable;
                    const lifted = drag && drag.kind !== "new" && drag.moved && drag.item.id === s.id;
                    const range = placed[s.id] ? slotLabel(p) : fmtRange(s.starts_at, s.ends_at);
                    const small = h < 44;
                    const over = !!nowIso && s.ends_at < nowIso; // already finished: shown paler, as calendars do
                    const covered = !!s.faded;
                    const lines = h >= 80 ? 2 : 1; // room for the title to wrap onto a second line
                    return (
                      <div
                        key={s.id}
                        className={cx(
                          "absolute right-1.5 left-1 z-[6] overflow-hidden rounded-lg transition-[filter,box-shadow,opacity] hover:z-20 hover:opacity-100",
                          covered ? "border border-dashed border-ink/20" : "shadow-[0_1px_2px_rgba(16,24,20,0.18),inset_3px_0_0_rgba(0,0,0,0.16)] hover:shadow-lg hover:brightness-110",
                          (over || s.cancelled) && !covered && "opacity-60",
                          can && "cursor-grab",
                          lifted && "opacity-35",
                        )}
                        style={{ top, height: h, background: covered ? `${HATCH_SOFT}, #F1F3F1` : `${EVENT_SHEEN}, ${s.color}`, color: covered ? "rgba(20,30,25,0.55)" : "#fff" }}
                        onPointerDown={grabItem("move", s)}
                        onDragStart={(e) => e.preventDefault()}
                        onClickCapture={(e) => {
                          if (!skipClick.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <A
                          href={s.href}
                          title={`${s.title === s.label ? s.label : `${s.label}: ${s.title}`} · ${range}${s.draft ? " · draft" : covered ? " · covered" : ""}${can ? " · drag to move" : ""}`}
                          className={cx("flex h-full flex-col pr-1.5 pl-2.5 text-left leading-tight", small ? "justify-center py-0.5" : "py-1.5")}
                        >
                          <span className="flex min-w-0 items-start gap-1.5">
                            <EventMark type={s.session_type} semi={s.semi} clinic={s.clinic} color={covered ? "#9A9F9B" : s.color} size={small ? 14 : 15} invert={!covered} className="mt-px" />
                            <span className={cx("min-w-0 flex-1 text-[12px] font-semibold", lines === 2 ? "line-clamp-2 break-words" : "truncate", (s.cancelled || (covered && !s.draft)) && "line-through decoration-1")}>{s.title}</span>
                          </span>
                          {!small && <span className="mt-0.5 block truncate text-[11px] font-medium opacity-85 tabular-nums">{range}</span>}
                          {h > 56 && <span className="mt-auto block truncate pt-0.5 text-[11px] opacity-75">{s.cancelled ? "Cancelled" : s.detail}</span>}
                        </A>
                        {can && <span className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" onPointerDown={grabItem("resize", s)} aria-hidden="true" />}
                      </div>
                    );
                  })}
                  {ghost?.day === d && (
                    <div
                      className={cx("pointer-events-none absolute inset-x-1 z-30 overflow-hidden rounded-lg border-2 border-dashed px-2 py-1 text-[11.5px] leading-tight font-semibold shadow-md", ghostBusy ? "border-[#B9574A] bg-[#F5E1DC]/90 text-[#8E3326]" : "border-brand bg-sage/80 text-brand")}
                      style={box(ghost)}
                    >
                      <span className="block truncate">{slotLabel(ghost)}</span>
                      {ghost.end - ghost.start > SNAP && <span className="block truncate font-medium opacity-75">{ghostBusy ? "You're busy then" : `${(ghost.end - ghost.start) / 60} hr`}</span>}
                    </div>
                  )}
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
