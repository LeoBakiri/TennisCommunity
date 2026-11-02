import { SessionMark } from "../icons";
import { ActionForm, Badge, BookingBadge, Card, Empty, LinkButton, PageHeader, SectionTitle, Submit } from "../kit";
import { CancelButton, SessionCard } from "../sessions";
import { ProfileFields } from "./public";
import type { FrameMeta } from "../shell";
import type { BookingRow, loadMySessions, loadProfile, loadSchedule } from "@/core/queries";
import { fmtDate, fmtDayRange, fmtKeyLong } from "@/core/time";
import { sessionTitle } from "@/core/util";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

// ───────────────────────── schedule ─────────────────────────

export function ScheduleView({ data, meta }: { data: D<typeof loadSchedule>; meta: FrameMeta }) {
  return (
    <>
      <PageHeader title="Schedule" subtitle="Upcoming Group Sessions and Performance Accelerators. Times are Pacific." />
      {data.days.length ? (
        <div className="space-y-5">
          {data.days.map(({ day, sessions }) => (
            <section key={day} className="card overflow-hidden">
              <h2 className="flex items-center justify-between border-b border-ink/[0.06] bg-paper/60 px-4 py-2.5 text-sm font-semibold md:px-5">
                {fmtKeyLong(day)}
                {day === data.today && <Badge tone="accent">Today</Badge>}
              </h2>
              <div className="divide-y divide-ink/[0.06]">
                {sessions.map((s) => (
                  <SessionCard key={s.id} s={s} signedIn={meta.signedIn} window={data.window} />
                ))}
              </div>
            </section>
          ))}
          <p className="px-1 text-sm text-ink/55">{data.policy}</p>
        </div>
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
              <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />
              <CancelButton bookingId={r.booking.id} status={r.booking.status} session={r.session} window={window} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MySessions({ data }: { data: D<typeof loadMySessions> }) {
  const empty = !data.confirmed.length && !data.waitlisted.length;
  return (
    <>
      <PageHeader title="My Sessions" />
      <div className="space-y-6">
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
