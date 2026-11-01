import { useState } from "react";
import { A, useAction, withQuery } from "./nav";
import { Icon } from "./icons";
import { ActionButton, Badge, BookingBadge, btn, cx, Dot, Modal, Notice, Spinner } from "./kit";
import type { ScheduleItem, SessionView } from "@/core/queries";
import { addDays, dateKey, fmtClock, fmtDateTime, fmtDayLong, fmtDayRange, fmtKeyLong, fmtKeyNum, fmtKeyWeekday, fmtRange, fmtWeekRange, minutesOfDay } from "@/core/time";
import { fmtMoney, SESSION_META } from "@/core/util";

export function priceLabel(s: Pick<SessionView, "price_cents">) {
  if (s.price_cents === null) return "Price TBA";
  return s.price_cents === 0 ? "Free" : fmtMoney(s.price_cents);
}

const sessionColor = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].color;
const sessionLabel = (s: Pick<SessionView, "session_type">) => SESSION_META[s.session_type ?? "group"].label;

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
            <Dot color={sessionColor(s)} /> {sessionLabel(s)}
          </div>
          {s.title && <div className="mt-1 text-sm font-medium">{s.title}</div>}
          <div className="mt-2 space-y-1 text-sm text-ink/70">
            <div className="flex items-center gap-2">
              <Icon name="calendar" size={15} /> {fmtDayLong(s.starts_at)}, {fmtRange(s.starts_at, s.ends_at)}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="pin" size={15} /> {s.location}
            </div>
            <div className="flex items-center gap-2">
              <Icon name="card" size={15} /> {priceLabel(s)}
            </div>
          </div>
        </div>
        {isFull && <p className="mt-4 text-sm text-ink/70">This session is full. If a spot opens, the first player on the waitlist moves in automatically.</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className={btn("ghost")} onClick={() => setOpen(false)}>
            Not now
          </button>
          <button
            className={btn("primary")}
            disabled={pending}
            data-autofocus
            onClick={async () => {
              const r = await run("bookSession", { session_id: s.id });
              if (r.ok) setOpen(false);
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

export function CancelButton({ bookingId, status, session, window }: { bookingId: string; status: string; session: SessionView; window: number }) {
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
            {late && <Notice tone="warn">This is within {window} hours of the start, so it counts as a late cancellation.</Notice>}
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

// ───────────────────────── session card (players) ─────────────────────────

export function SessionCard({ s, signedIn, window, showDay }: { s: SessionView; signedIn: boolean; window: number; showDay?: boolean }) {
  const mine = s.my_booking;
  return (
    <article className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: sessionColor(s) }}>
          <Dot color={sessionColor(s)} /> {sessionLabel(s)}
        </div>
        {s.title && <h3 className="mt-1 text-[17px] leading-snug font-semibold">{s.title}</h3>}
        <div className="mt-1.5 space-y-0.5 text-sm text-ink/70">
          <div className="font-medium text-ink">{showDay ? fmtDateTime(s.starts_at) : fmtRange(s.starts_at, s.ends_at)}</div>
          <div>{s.location}</div>
          <div>
            {s.coaches.length > 0 && `${s.coaches.map((c) => c.full_name.split(" ")[0]).join(" & ")} · `}
            {priceLabel(s)}
          </div>
        </div>
        {s.description && <p className="mt-2 text-sm whitespace-pre-line text-ink/60">{s.description}</p>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
        <div className="text-sm">
          <span className={cx("font-semibold tabular-nums", s.spots_left === 0 && "text-[#8E3326]")}>
            {s.booked} / {s.capacity} booked
          </span>
          {s.waitlist > 0 && <span className="block text-xs text-ink/50 sm:text-right">{s.waitlist} waiting</span>}
        </div>
        {mine ? (
          <div className="flex items-center gap-2">
            <BookingBadge status={mine.status} position={mine.waitlist_position} />
            <CancelButton bookingId={mine.id} status={mine.status} session={s} window={window} />
          </div>
        ) : (
          <BookButton s={s} signedIn={signedIn} />
        )}
      </div>
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
                        <span className={cx("block truncate text-[15px] font-semibold", s.cancelled && "line-through")}>{s.title}</span>
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
                          <span className={cx("relative block truncate font-semibold text-ink", s.cancelled && "line-through")}>{s.title}</span>
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
