import { useState } from "react";
import { A, useAction, useNav, withQuery } from "../nav";
import { Icon } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Capacity, Card, cx, Dot, Empty, Field, LinkButton, Notice, PageHeader, SectionTitle, Stat, Submit } from "../kit";
import { sessionName, WeekGrid, WeekNav } from "../sessions";
import { Thread } from "./member";
import type { FrameMeta } from "../shell";
import type { loadCoachCalendar, loadCoachPlayer, loadCoachPlayers, loadCoachSession, loadCoachToday, loadStaffInbox } from "@/core/queries";
import { fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtRange, relativeFromNow } from "@/core/time";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

export function CoachToday({ data, meta }: { data: D<typeof loadCoachToday>; meta: FrameMeta }) {
  const first = meta.user!.full_name.split(" ")[0];
  const later = data.week.filter((s) => !data.today.some((t) => t.id === s.id));
  return (
    <>
      <PageHeader
        eyebrow={fmtDayLong(data.nowIso)}
        title={`Hi ${first} — here's your day`}
        subtitle={data.today.length ? `${data.today.length} session${data.today.length > 1 ? "s" : ""} on court today.` : "No sessions today. Enjoy the rest day."}
        actions={<LinkButton href="/coach/calendar" variant="outline" icon="calendar">My calendar</LinkButton>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next 7 days" value={data.stats.sessions} hint="sessions" icon="calendar" />
        <Stat label="Players booked" value={data.stats.players} icon="users" />
        <Stat label="Court hours" value={data.stats.hours} icon="clock" />
        <Stat label="Average fill" value={`${data.stats.fill}%`} icon="chart" tone="accent" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <SectionTitle>Today</SectionTitle>
          {data.today.length ? (
            data.today.map((s) => {
              const roster = data.rosters[s.id] ?? [];
              const started = s.starts_at <= data.nowIso;
              return (
                <Card key={s.id} className="!p-0">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/[0.06] p-5">
                    <div>
                      <div className="flex items-center gap-2 text-[13px] text-ink/55">
                        <Dot color={s.program.color} /> {s.program.name}
                        {started ? <Badge tone="green">In progress / done</Badge> : <Badge tone="accent">{relativeFromNow(s.starts_at)}</Badge>}
                      </div>
                      <h3 className="mt-1.5 font-display text-xl font-semibold">{sessionName(s)}</h3>
                      <p className="text-sm text-ink/60">
                        {fmtRange(s.starts_at, s.ends_at)} · {s.location}
                      </p>
                    </div>
                    <LinkButton href={`/coach/sessions/${s.id}`} size="sm" icon="clipboard">
                      Roster & attendance
                    </LinkButton>
                  </div>
                  <div className="p-5">
                    {roster.length ? (
                      <div className="flex flex-wrap gap-2">
                        {roster.map((r, i) => (
                          <span key={i} className="flex items-center gap-2 rounded-full bg-paper py-1 pr-3 pl-1 text-sm">
                            <Avatar name={r.name} size={24} /> {r.name}
                            {r.attended === true && <Icon name="check" size={14} className="text-[#2E5A2A]" />}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-ink/50">No players booked yet.</p>
                    )}
                    {s.capacity > 1 && (
                      <div className="mt-4 max-w-xs">
                        <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })
          ) : (
            <Empty icon="sun" title="Nothing on court today" body="Your upcoming sessions are listed on the right." />
          )}
        </div>
        <aside className="space-y-6">
          {data.needsAttendance.length > 0 && (
            <div>
              <SectionTitle>Attendance to record</SectionTitle>
              <div className="card divide-y divide-ink/[0.06]">
                {data.needsAttendance.map((s) => (
                  <A key={s.id} href={`/coach/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
                    <Icon name="clipboard" size={17} className="text-[#8A5A10]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{sessionName(s)}</span>
                      <span className="text-xs text-ink/50">{fmtDay(s.starts_at)}</span>
                    </span>
                    <Icon name="right" size={16} className="text-ink/35" />
                  </A>
                ))}
              </div>
            </div>
          )}
          <div>
            <SectionTitle>This week</SectionTitle>
            {later.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {later.map((s) => (
                  <A key={s.id} href={`/coach/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60">
                    <Dot color={s.program.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{sessionName(s)}</span>
                      <span className="text-xs text-ink/50">
                        {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}
                      </span>
                    </span>
                    <span className="text-xs text-ink/55 tabular-nums">
                      {s.booked}/{s.capacity}
                    </span>
                  </A>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink/55">No other sessions this week.</p>
            )}
          </div>
          {data.unread > 0 && (
            <A href="/coach/messages" className="card flex items-center gap-3 p-4 hover:shadow-md">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-ink">
                <Icon name="message" size={17} />
              </span>
              <span className="flex-1 text-sm font-medium">{data.unread} unread player message{data.unread > 1 ? "s" : ""}</span>
            </A>
          )}
        </aside>
      </div>
    </>
  );
}

export function CoachCalendar({ data, meta }: { data: D<typeof loadCoachCalendar>; meta: FrameMeta }) {
  const isAdmin = meta.user!.role === "admin";
  return (
    <>
      <PageHeader title="My teaching calendar" subtitle="Your assigned lessons and clinics. Select a session to open its roster." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekNav monday={data.monday} base="/coach/calendar" extra={data.all ? { all: "1" } : {}} />
        {isAdmin && (
          <A href={withQuery("/coach/calendar", { week: data.monday, all: data.all ? "" : "1" })} className={btn("outline", "sm")}>
            {data.all ? "Only my sessions" : "Show every coach"}
          </A>
        )}
      </div>
      <WeekGrid days={data.days} today={data.today} sessions={data.sessions} hrefFor={(s) => `/coach/sessions/${s.id}`} nowIso={new Date().toISOString()} />
    </>
  );
}

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

export function NoteComposer({ playerId, sessionId, compact }: { playerId: string; sessionId?: string; compact?: boolean }) {
  const [vis, setVis] = useState<"staff" | "shared">("shared");
  return (
    <ActionForm action="addNote" hidden={{ player_id: playerId, session_id: sessionId ?? "", visibility: vis }} reset>
      <textarea name="body" className={cx("input", compact && "!min-h-[72px]")} placeholder={vis === "shared" ? "Feedback the player will see…" : "Private note for coaches only…"} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-ink/[0.05] p-0.5 text-[13px]">
          {(["shared", "staff"] as const).map((v) => (
            <button type="button" key={v} onClick={() => setVis(v)} className={cx("rounded-md px-2.5 py-1 font-medium", vis === v ? "bg-card shadow-sm" : "text-ink/55")}>
              {v === "shared" ? "Share with player" : "Coaches only"}
            </button>
          ))}
        </div>
        <Submit size="sm" icon="note">
          Save note
        </Submit>
      </div>
    </ActionForm>
  );
}

export function NotesList({ notes, me, isAdmin }: { notes: { id: string; body: string; author: string; author_id: string; visibility: string; created_at: string }[]; me: string; isAdmin: boolean }) {
  if (!notes.length) return <p className="text-sm text-ink/50">No notes yet.</p>;
  return (
    <ul className="space-y-3">
      {notes.map((n) => (
        <li key={n.id} className="rounded-xl bg-paper p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] leading-relaxed whitespace-pre-line">{n.body}</p>
            {(n.author_id === me || isAdmin) && (
              <ActionButton action="deleteNote" input={{ note_id: n.id }} variant="ghost" icon="trash" className="!min-h-0 !px-1.5 !py-1" confirm={{ title: "Delete this note?", label: "Delete", danger: true }}>
                <span className="sr-only">Delete</span>
              </ActionButton>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-ink/50">
            {n.visibility === "shared" ? <Badge tone="green">Shared with player</Badge> : <Badge>Coaches only</Badge>}
            {n.author} · {fmtDate(n.created_at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CoachSession({ data, meta }: { data: D<typeof loadCoachSession>; meta: FrameMeta }) {
  const s = data.session;
  const [open, setOpen] = useState<string | null>(null);
  const confirmed = data.roster.filter((r) => r.booking.status === "confirmed" || r.booking.status === "pending");
  const waitlist = data.roster.filter((r) => r.booking.status === "waitlisted");
  return (
    <>
      <PageHeader
        back={{ href: "/coach", label: "Today" }}
        eyebrow={
          <span className="flex items-center gap-2">
            <Dot color={s.program.color} /> {s.program.name}
          </span>
        }
        title={sessionName(s)}
        subtitle={`${fmtDayLong(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)} · ${s.location}`}
        actions={
          <>
            {data.isAdmin && (
              <LinkButton href={`/admin/sessions/${s.id}`} variant="outline" icon="edit">
                Edit in admin
              </LinkButton>
            )}
            {confirmed.some((r) => r.booking.attended === null && r.booking.status === "confirmed") && (
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
                      <div className="min-w-0 flex-1">
                        <A href={`/coach/players/${r.player?.id}`} className="font-semibold hover:underline">
                          {r.player?.full_name}
                        </A>
                        <div className="text-[13px] text-ink/55">
                          {r.player?.skill_level}
                          {r.player?.ntrp && ` · NTRP ${r.player.ntrp}`}
                          {r.booking.guest_name && ` · + ${r.booking.guest_name}`}
                          {r.notes > 0 && ` · ${r.notes} note${r.notes > 1 ? "s" : ""}`}
                        </div>
                      </div>
                      {r.booking.status === "pending" ? <BookingBadge status="pending" /> : <AttendanceToggle bookingId={r.booking.id} value={r.booking.attended} />}
                      <button className={btn("ghost", "sm")} onClick={() => setOpen(open === r.booking.id ? null : r.booking.id)} aria-expanded={open === r.booking.id}>
                        <Icon name="down" size={16} className={cx("transition-transform", open === r.booking.id && "rotate-180")} />
                        <span className="sr-only">Details</span>
                      </button>
                    </div>
                    {open === r.booking.id && r.player && (
                      <div className="fade-in mt-4 grid gap-4 rounded-xl bg-paper p-4 sm:grid-cols-2">
                        <div className="space-y-1.5 text-sm">
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
                          {r.player.goals && <p className="pt-2 text-ink/70">Goals: {r.player.goals}</p>}
                        </div>
                        <NoteComposer playerId={r.player.id} sessionId={s.id} compact />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="users" title="No one booked yet" />
            )}
          </div>
          {waitlist.length > 0 && (
            <div>
              <SectionTitle>Waitlist</SectionTitle>
              <div className="card divide-y divide-ink/[0.06]">
                {waitlist.map((r) => (
                  <div key={r.booking.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                    <span className="w-6 text-center text-sm font-semibold text-ink/40">#{r.booking.waitlist_position}</span>
                    <Avatar name={r.player?.full_name ?? "?"} size={30} />
                    <span className="flex-1 text-sm font-medium">{r.player?.full_name}</span>
                    {data.isAdmin && (
                      <ActionButton action="adminBookingOp" input={{ booking_id: r.booking.id, op: "promote" }} size="sm">
                        Move in
                      </ActionButton>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <Card>
            <SectionTitle>Session details</SectionTitle>
            <dl className="space-y-2.5 text-sm">
              {[
                ["Level", s.skill_level || "All levels"],
                ["Coaches", s.coaches.map((c) => c.full_name).join(", ") || "—"],
                ["Visibility", s.visibility === "private" ? "Private lesson" : "Public"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink/55">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {s.internal_notes && <p className="mt-4 rounded-lg bg-[#F6EBD3] p-3 text-sm text-[#6E4A0E]">{s.internal_notes}</p>}
          </Card>
          <Card>
            <SectionTitle>Session notes</SectionTitle>
            <NotesList notes={data.sessionNotes} me={meta.user!.id} isAdmin={data.isAdmin} />
          </Card>
        </aside>
      </div>
    </>
  );
}

export function CoachPlayers({ data }: { data: D<typeof loadCoachPlayers> }) {
  const nav = useNav();
  return (
    <>
      <PageHeader title={data.everyone ? "All players" : "My players"} subtitle={data.everyone ? "Everyone in the community." : "Players who've booked your sessions."} />
      <form
        className="mb-4 max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q");
          nav.push(withQuery("/coach/players", { q: String(q ?? "") }));
        }}
      >
        <label className="relative block">
          <Icon name="search" size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" />
          <input name="q" defaultValue={data.q} className="input !pl-10" placeholder="Search players" />
        </label>
      </form>
      {data.players.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.players.map((p) => (
            <A key={p.id} href={`/coach/players/${p.id}`} className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
              <Avatar name={p.full_name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.full_name}</div>
                <div className="text-[13px] text-ink/55">
                  {p.skill_level}
                  {p.ntrp && ` · ${p.ntrp}`}
                </div>
                <div className="mt-1 text-xs text-ink/45">
                  {p.stats.count} session{p.stats.count === 1 ? "" : "s"}
                  {p.stats.next ? ` · next ${fmtDay(p.stats.next)}` : p.stats.last ? ` · last ${fmtDay(p.stats.last)}` : ""}
                </div>
              </div>
            </A>
          ))}
        </div>
      ) : (
        <Empty icon="users" title="No players found" />
      )}
    </>
  );
}

export function CoachPlayer({ data, meta }: { data: D<typeof loadCoachPlayer>; meta: FrameMeta }) {
  const p = data.player;
  void meta;
  return (
    <>
      <PageHeader back={{ href: "/coach/players", label: "Players" }} title={p.full_name} subtitle={`${p.skill_level}${p.ntrp ? ` · NTRP ${p.ntrp}` : ""} · ${p.dominant_hand}-handed`} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>Coaching notes</SectionTitle>
            <NoteComposer playerId={p.id} />
            <div className="mt-5">
              <NotesList notes={data.notes} me={data.me} isAdmin={data.isAdmin} />
            </div>
          </Card>
          <div>
            <SectionTitle>Session history</SectionTitle>
            {data.history.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {data.history.map((r) => (
                  <A key={r.booking.id} href={`/coach/sessions/${r.session.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper/60 md:px-5">
                    <Dot color={r.session.program.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{sessionName(r.session)}</span>
                      <span className="text-xs text-ink/50">{fmtDateTime(r.session.starts_at)}</span>
                    </span>
                    {r.booking.attended === true ? <Badge tone="green">Attended</Badge> : r.booking.attended === false ? <Badge tone="red">No-show</Badge> : <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />}
                  </A>
                ))}
              </div>
            ) : (
              <Empty title="No sessions yet" />
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <Card>
            <div className="flex items-center gap-3">
              <Avatar name={p.full_name} size={48} />
              <div>
                <div className="font-semibold">{p.full_name}</div>
                <div className="text-xs text-ink/50">Member since {fmtDate(p.created_at)}</div>
              </div>
            </div>
            <div className="mt-5 space-y-2 text-sm">
              {p.phone && (
                <a href={`tel:${p.phone}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="phone" size={15} /> {p.phone}
                </a>
              )}
              {p.email && (
                <a href={`mailto:${p.email}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="mail" size={15} /> {p.email}
                </a>
              )}
              {p.emergency_contact && (
                <div className="flex items-center gap-2 text-ink/70">
                  <Icon name="shield" size={15} /> {p.emergency_contact}
                </div>
              )}
            </div>
            {p.goals && (
              <div className="mt-5 border-t border-ink/[0.06] pt-4">
                <div className="text-xs text-ink/50">Goals</div>
                <p className="mt-1 text-sm">{p.goals}</p>
              </div>
            )}
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Sessions played" value={data.stats.count} />
            <Stat label="Next session" value={data.stats.next ? fmtDay(data.stats.next).split(",")[1] ?? "—" : "—"} />
          </div>
        </aside>
      </div>
    </>
  );
}

export function StaffInbox({ data, meta, base }: { data: D<typeof loadStaffInbox>; meta: FrameMeta; base: string }) {
  const nav = useNav();
  const [compose, setCompose] = useState(false);
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Conversations with players. Replies are sent by email too."
        actions={
          <button className={btn("outline")} onClick={() => setCompose(!compose)}>
            <Icon name="plus" size={17} /> New message
          </button>
        }
      />
      {compose && (
        <Card className="mb-4">
          <Field label="Message a player">
            <select className="input" defaultValue="" onChange={(e) => e.target.value && nav.push(withQuery(base, { m: e.target.value }))}>
              <option value="">Choose a player…</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </Field>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className={cx("card max-h-[70vh] overflow-y-auto", data.selected && "hidden lg:block")}>
          {data.threads.length ? (
            data.threads.map((t) => (
              <A key={t.member_id} href={withQuery(base, { m: t.member_id })} className={cx("flex items-start gap-3 border-b border-ink/[0.06] px-4 py-3.5 last:border-0", t.member_id === data.selected ? "bg-sage/40" : "hover:bg-paper/60")}>
                <Avatar name={t.member?.full_name ?? "?"} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{t.member?.full_name ?? "Former member"}</span>
                    <span className="shrink-0 text-[11px] text-ink/45">{fmtDay(t.last.created_at)}</span>
                  </div>
                  <p className="truncate text-[13px] text-ink/55">{t.last.body}</p>
                </div>
                {t.unread > 0 && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-accent/30" />}
              </A>
            ))
          ) : (
            <p className="p-6 text-sm text-ink/50">No conversations yet.</p>
          )}
        </div>
        <Card className={cx("flex min-h-[420px] flex-col", !data.selected && "hidden lg:flex")}>
          {data.selectedMember ? (
            <>
              <div className="mb-4 flex items-center gap-3 border-b border-ink/[0.06] pb-4">
                <A href={base} className="rounded-lg p-1 lg:hidden" aria-label="Back to conversations">
                  <Icon name="left" />
                </A>
                <Avatar name={data.selectedMember.full_name} size={36} />
                <div className="flex-1">
                  <div className="font-semibold">{data.selectedMember.full_name}</div>
                  <div className="text-xs text-ink/50">{data.selectedMember.skill_level}</div>
                </div>
                <A href={`/coach/players/${data.selectedMember.id}`} className={btn("ghost", "sm")}>
                  Profile
                </A>
              </div>
              <div className="flex-1">
                <Thread messages={data.messages} meId={meta.user!.id} emptyText="Start the conversation." />
              </div>
              <ActionForm action="sendMessage" hidden={{ member_id: data.selected }} reset className="mt-5 flex items-end gap-2 border-t border-ink/[0.06] pt-4">
                <textarea name="body" className="input !min-h-[48px] flex-1" rows={2} placeholder={`Reply to ${data.selectedMember.full_name.split(" ")[0]}…`} />
                <Submit icon="arrow">Send</Submit>
              </ActionForm>
            </>
          ) : (
            <Empty icon="message" title="Pick a conversation" />
          )}
        </Card>
      </div>
    </>
  );
}
