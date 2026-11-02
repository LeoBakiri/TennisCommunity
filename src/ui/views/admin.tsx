import { useState } from "react";
import { A, useNav, withQuery } from "../nav";
import { Icon, SessionMark } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Capacity, Card, cx, Empty, Field, LinkButton, Modal, Notice, PageHeader, SectionTitle, Submit, Tabs } from "../kit";
import { priceLabel } from "../sessions";
import type { FrameMeta } from "../shell";
import type { loadAdminCoaches, loadAdminMember, loadAdminMembers, loadAdminSchedule, loadSessionEditor, loadSettingsPage } from "@/core/queries";
import type { SessionType } from "@/core/types";
import { dateKey, fmtClock, fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtKeyLong, fmtRange, timeKey } from "@/core/time";
import { SESSION_META, sessionTitle } from "@/core/util";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

const TIMES = Array.from({ length: 64 }, (_, i) => {
  const h = 6 + Math.floor(i / 4);
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${m}`;
});

export function TimeSelect({ name, value }: { name: string; value: string }) {
  const opts = TIMES.includes(value) ? TIMES : [value, ...TIMES];
  return (
    <select className="input" name={name} defaultValue={value}>
      {opts.map((t) => (
        <option key={t} value={t}>
          {fmtClock(t)}
        </option>
      ))}
    </select>
  );
}

const dollarsField = (cents: number | null | undefined) => (cents == null ? "" : cents / 100);

// ───────────────────────── community schedule ─────────────────────────

export function AdminSchedule({ data }: { data: D<typeof loadAdminSchedule> }) {
  const nav = useNav();
  const tabHref = (tab: string) => withQuery("/admin", { tab: tab === "upcoming" ? "" : tab });
  return (
    <>
      <PageHeader title="Community Schedule" subtitle="Group Sessions and Performance Accelerators." actions={<LinkButton href="/admin/sessions/new" icon="plus">New session</LinkButton>} />
      <Tabs
        current={data.tab}
        items={[
          { key: "upcoming", label: "Upcoming", href: tabHref("upcoming"), count: data.counts.upcoming },
          { key: "draft", label: "Drafts", href: tabHref("draft"), count: data.counts.draft },
          { key: "past", label: "Past", href: tabHref("past") },
          { key: "cancelled", label: "Cancelled", href: tabHref("cancelled") },
        ]}
      />
      {data.sessions.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>When</th>
                <th className="hidden md:table-cell">Coach</th>
                <th>Players</th>
                <th className="hidden sm:table-cell">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => nav.push(`/admin/sessions/${s.id}`)}>
                  <td>
                    <div className="flex items-center gap-2 font-medium">
                      <SessionMark type={s.session_type} /> {SESSION_META[s.session_type!].label}
                    </div>
                    {s.title && <div className="mt-0.5 pl-5 text-xs text-ink/55">{s.title}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    <div>{fmtDay(s.starts_at)}</div>
                    <div className="text-xs text-ink/50">{fmtRange(s.starts_at, s.ends_at)}</div>
                  </td>
                  <td className="hidden text-ink/70 md:table-cell">{s.coaches.map((c) => c.full_name.split(" ")[0]).join(", ") || <Badge tone="amber">No coach</Badge>}</td>
                  <td className="w-36">
                    <Capacity booked={s.booked} capacity={s.capacity} waitlist={s.waitlist} />
                  </td>
                  <td className="hidden whitespace-nowrap text-ink/70 sm:table-cell">{priceLabel(s)}</td>
                  <td className="text-right">
                    <Icon name="right" size={16} className="text-ink/35" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="calendar" title="No sessions here" action={<LinkButton href="/admin/sessions/new" size="sm">Create a session</LinkButton>} />
      )}
    </>
  );
}

// ───────────────────────── session editor ─────────────────────────

function AddPlayer({ sessionId, members }: { sessionId: string; members: { id: string; full_name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={btn("outline", "sm")} onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} /> Add player
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a player to this session">
        <ActionForm action="adminAddBooking" hidden={{ session_id: sessionId }} onDone={(r) => r.ok && setOpen(false)}>
          <Field label="Player">
            <select className="input" name="user_id" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Add as" className="mt-4">
            <select className="input" name="mode" defaultValue="auto">
              <option value="auto">Automatic (confirmed if there&apos;s room, otherwise waitlist)</option>
              <option value="confirmed">Confirmed, even if over capacity</option>
              <option value="waitlisted">Waitlist</option>
            </select>
          </Field>
          <Submit className="mt-5 w-full">Add player</Submit>
        </ActionForm>
      </Modal>
    </>
  );
}

export function AdminSession({ data }: { data: D<typeof loadSessionEditor> }) {
  const s = data.session;
  const [type, setType] = useState<SessionType>(s?.session_type ?? data.prefill!.session_type);
  const defaults = data.defaults[type];
  const date = s ? dateKey(s.starts_at) : data.prefill!.date;
  const time = s ? timeKey(s.starts_at) : data.prefill!.time;
  const duration = s ? Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000) : defaults.duration_min;
  const coachIds = s ? s.coach_ids : data.prefill!.coach_ids;
  const active = data.roster.filter((r) => r.booking.status !== "cancelled");
  const inactive = data.roster.filter((r) => r.booking.status === "cancelled");

  const form = (
    <ActionForm action="saveSession" hidden={{ id: s?.id ?? "", session_type: type }} key={s ? s.id : type}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1 sm:col-span-2" role="radiogroup" aria-label="Session type">
          {(["group", "performance_accelerator"] as const).map((t) => (
            <button type="button" key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cx("flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold", type === t ? "bg-card shadow-sm" : "text-ink/55")}>
              <SessionMark type={t} className={type === t ? "" : "opacity-50"} /> {SESSION_META[t].label}
            </button>
          ))}
        </div>
        {type === "performance_accelerator" && (
          <Field label="Focus" hint="For example: Groundstrokes + Movement" className="sm:col-span-2">
            <input className="input" name="title" defaultValue={s?.title ?? ""} />
          </Field>
        )}
        <Field label="Date">
          <input className="input" type="date" name="date" defaultValue={date} />
        </Field>
        <Field label="Start time (Pacific)">
          <TimeSelect name="time" value={time} />
        </Field>
        <Field label="Duration (minutes)">
          <input className="input" type="number" name="duration_min" min={15} step={15} defaultValue={duration} />
        </Field>
        <Field label="Capacity">
          <input className="input" type="number" name="capacity" min={1} defaultValue={s?.capacity ?? defaults.capacity} />
        </Field>
        <Field label="Price per player (USD)" hint="Blank for “Price TBA”, 0 for free">
          <input className="input" name="price" inputMode="decimal" defaultValue={dollarsField(s ? s.price_cents : defaults.price_cents)} />
        </Field>
        <Field label="Location">
          <input className="input" name="location" defaultValue={s?.location ?? data.defaults.location} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">Coach</legend>
          <div className="flex flex-wrap gap-2">
            {data.coaches.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink/12 bg-card px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                <input type="checkbox" name="coach_ids[]" value={c.id} defaultChecked={coachIds.includes(c.id)} className="check" />
                {c.full_name}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Notes for players" hint="A sunset, doubles or themed session is a Group Session with a note here." className="sm:col-span-2">
          <textarea className="input" name="description" defaultValue={s?.description ?? ""} />
        </Field>
        <Field label="Session notes (coaches only)" className="sm:col-span-2">
          <textarea className="input !min-h-[72px]" name="internal_notes" defaultValue={s?.internal_notes ?? ""} />
        </Field>
        {!s ? (
          <>
            <Field label="Repeat weekly">
              <select className="input" name="repeat_weeks" defaultValue="0">
                {[0, 1, 2, 3, 4, 5, 7, 11].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Don't repeat" : `${n} more week${n > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" name="status" defaultValue="published">
                <option value="published">Publish now (bookable)</option>
                <option value="draft">Save as draft</option>
              </select>
            </Field>
          </>
        ) : (
          <input type="hidden" name="status" value={s.status === "cancelled" ? "draft" : s.status} />
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Submit icon="check">{s ? "Save changes" : "Create session"}</Submit>
      </div>
    </ActionForm>
  );

  if (!s) {
    return (
      <>
        <PageHeader back={{ href: "/admin", label: "Community Schedule" }} title="New session" subtitle={`${fmtKeyLong(date)} · ${fmtClock(time)}`} />
        <div className="max-w-3xl">
          <Card>{form}</Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/admin", label: "Community Schedule" }}
        eyebrow={
          <span className="flex items-center gap-2">
            {s.status === "draft" && <Badge>Draft</Badge>}
            {s.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
          </span>
        }
        title={sessionTitle(s)}
        subtitle={`${fmtDayLong(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)}`}
        actions={
          <>
            {s.status === "draft" && (
              <ActionButton action="setSessionStatus" input={{ session_id: s.id, status: "published" }} variant="primary" size="md" icon="check">
                Publish
              </ActionButton>
            )}
            {s.status === "published" && (
              <ActionButton action="setSessionStatus" input={{ session_id: s.id, status: "draft" }} variant="outline" size="md" confirm={{ title: "Unpublish this session?", body: "It will disappear from the schedule. Existing bookings are kept." }}>
                Unpublish
              </ActionButton>
            )}
            <ActionButton action="duplicateSession" input={{ session_id: s.id, days: 7 }} variant="outline" size="md" icon="copy">
              Copy to next week
            </ActionButton>
            <LinkButton href={`/coach/sessions/${s.id}`} variant="outline" icon="clipboard">
              Attendance
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">
              Players <span className="font-normal text-ink/50">· {s.booked}/{s.capacity}</span>
            </h2>
            {s.status !== "cancelled" && <AddPlayer sessionId={s.id} members={data.members} />}
          </div>
          {active.length ? (
            <div className="card divide-y divide-ink/[0.06]">
              {active.map((r) => (
                <div key={r.booking.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={r.player?.full_name ?? "?"} size={34} />
                  <div className="min-w-0 flex-1">
                    <A href={`/admin/members/${r.player?.id}`} className="text-sm font-semibold hover:underline">
                      {r.player?.full_name}
                    </A>
                    <div className="truncate text-xs text-ink/50">{r.player?.email ?? r.player?.phone}</div>
                  </div>
                  <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />
                  <div className="flex gap-1">
                    {r.booking.status === "waitlisted" && <ActionButton action="promoteBooking" input={{ booking_id: r.booking.id }}>Move in</ActionButton>}
                    <ActionButton
                      action="cancelBooking"
                      input={{ booking_id: r.booking.id, reason: "Removed by coach" }}
                      variant="ghost"
                      icon="x"
                      className="!px-2"
                      confirm={{ title: `Remove ${r.player?.full_name ?? "this player"}?`, body: "The waitlist moves up automatically.", label: "Remove", danger: true }}
                    >
                      <span className="sr-only">Remove</span>
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="users" title="No players yet" body={s.status === "draft" ? "Publish the session so players can book." : undefined} />
          )}
          {inactive.length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink/70">{inactive.length} cancelled</summary>
              <ul className="mt-3 space-y-2">
                {inactive.map((r) => (
                  <li key={r.booking.id} className="flex items-center justify-between gap-2">
                    <span>{r.player?.full_name}</span>
                    <span className="flex items-center gap-2 text-xs text-ink/50">
                      {r.booking.late_cancel && <Badge tone="amber">Late</Badge>}
                      {r.booking.cancel_reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {s.status !== "cancelled" && (
            <Card className="border-[#F5E1DC]">
              <h3 className="font-semibold">Cancel or delete</h3>
              <p className="mt-1 text-sm text-ink/60">Cancelling removes every booking. Tell players on WhatsApp. Sessions without bookings can be deleted.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionButton
                  action="setSessionStatus"
                  input={{ session_id: s.id, status: "cancelled" }}
                  variant="danger"
                  confirm={{ title: "Cancel this session?", body: `${s.booked + s.waitlist} booking(s) will be cancelled.`, label: "Cancel session", danger: true, reason: true }}
                >
                  Cancel session
                </ActionButton>
                {data.roster.length === 0 && (
                  <ActionButton action="deleteSession" input={{ session_id: s.id }} variant="ghost" icon="trash" confirm={{ title: "Delete this session?", body: "This can't be undone.", label: "Delete", danger: true }}>
                    Delete
                  </ActionButton>
                )}
              </div>
            </Card>
          )}
        </div>
        <div>
          <h2 className="mb-4 text-[15px] font-semibold">Details</h2>
          {s.status === "cancelled" ? <Notice tone="warn">This session is cancelled. Use “Copy to next week” to reschedule it.</Notice> : <Card>{form}</Card>}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── coaches ─────────────────────────

export function AdminCoaches({ data }: { data: D<typeof loadAdminCoaches> }) {
  return (
    <>
      <PageHeader title="Coaches" subtitle="Who's assigned to what. Open a coach to edit their settings. To add a coach, open their member page and change their role." actions={<LinkButton href="/admin/members" variant="outline" icon="users">Members</LinkButton>} />
      {data.unassigned.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            {data.unassigned.length} upcoming session{data.unassigned.length > 1 ? "s have" : " has"} no coach:{" "}
            {data.unassigned.slice(0, 5).map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <A href={`/admin/sessions/${s.id}`} className="font-medium underline">
                  {fmtDay(s.starts_at)}
                </A>
              </span>
            ))}
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.coaches.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start gap-3">
              <Avatar name={c.full_name} size={40} />
              <div className="min-w-0 flex-1">
                <A href={`/admin/members/${c.id}`} className="font-semibold hover:underline">
                  {c.full_name}
                </A>
                <div className="truncate text-xs text-ink/50">{c.email}</div>
              </div>
              {c.calendar ? c.calendar.status === "connected" ? <Badge tone="green">Calendar synced</Badge> : <Badge tone="amber">Calendar needs reconnecting</Badge> : <Badge>No calendar</Badge>}
            </div>
            <div className="mt-4 text-sm text-ink/60">
              {c.sessions.length} upcoming community session{c.sessions.length === 1 ? "" : "s"} · {c.lessons} upcoming lesson{c.lessons === 1 ? "" : "s"}
            </div>
            {c.sessions.length > 0 && (
              <ul className="mt-3 divide-y divide-ink/[0.06] border-t border-ink/[0.06]">
                {c.sessions.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <A href={`/admin/sessions/${s.id}`} className="flex items-center gap-2 py-2.5 text-sm hover:underline">
                      <SessionMark type={s.session_type} />
                      <span className="min-w-0 flex-1 truncate">{sessionTitle(s)}</span>
                      <span className="shrink-0 text-xs text-ink/50">{fmtDateTime(s.starts_at)}</span>
                    </A>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── members ─────────────────────────

export function AdminMembers({ data }: { data: D<typeof loadAdminMembers> }) {
  const nav = useNav();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Members"
        subtitle={data.total === 1 ? "1 person" : `${data.total} people`}
        actions={
          <button className={btn("primary")} onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} /> Add player
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <form
          className="min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            nav.push(withQuery("/admin/members", { q: String(new FormData(e.currentTarget).get("q") ?? ""), role: data.role }));
          }}
        >
          <label className="relative block">
            <Icon name="search" size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" />
            <input name="q" defaultValue={data.q} className="input !pl-10" placeholder="Search name, email or phone" />
          </label>
        </form>
        <select className="input !w-auto" value={data.role} onChange={(e) => nav.push(withQuery("/admin/members", { q: data.q, role: e.target.value }))} aria-label="Role">
          <option value="">Everyone</option>
          <option value="member">Players</option>
          <option value="coach">Coaches</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      {data.members.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden md:table-cell">Contact</th>
                <th className="hidden sm:table-cell">Bookings</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => nav.push(`/admin/members/${m.id}`)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} size={32} />
                      <div>
                        <div className="font-medium">{m.full_name}</div>
                        <div className="flex gap-1">
                          {m.role !== "member" && <Badge tone="dark">{m.role}</Badge>}
                          {m.status === "inactive" && <Badge>Inactive</Badge>}
                          {!m.onboarded && <Badge tone="amber">Invited</Badge>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden text-ink/65 md:table-cell">
                    <div>{m.email}</div>
                    <div className="text-xs">{m.phone}</div>
                  </td>
                  <td className="hidden tabular-nums sm:table-cell">{m.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="users" title="No one matches" />
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a player">
        <ActionForm action="adminCreateMember" onDone={(r) => r.ok && setAdding(false)}>
          <p className="mb-4 text-sm text-ink/60">Bring players over from WhatsApp. They can sign in later with the same email to claim their account.</p>
          <div className="grid gap-4">
            <Field label="Full name">
              <input className="input" name="full_name" required />
            </Field>
            <Field label="Email">
              <input className="input" type="email" name="email" />
            </Field>
            <Field label="Mobile">
              <input className="input" type="tel" name="phone" />
            </Field>
          </div>
          <Submit className="mt-5 w-full">Add player</Submit>
        </ActionForm>
      </Modal>
    </>
  );
}

export function AdminMember({ data, meta }: { data: D<typeof loadAdminMember>; meta: FrameMeta }) {
  const p = data.profile;
  const isMe = p.id === meta.user!.id;
  const isCoach = p.role !== "member";
  return (
    <>
      <PageHeader back={{ href: "/admin/members", label: "Members" }} title={p.full_name} subtitle={`Joined ${fmtDate(p.created_at)}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card>
            <SectionTitle>Contact</SectionTitle>
            <div className="space-y-2 text-sm">
              {p.email && (
                <a href={`mailto:${p.email}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="mail" size={15} /> {p.email}
                </a>
              )}
              {p.phone && (
                <a href={`tel:${p.phone}`} className="flex items-center gap-2 hover:underline">
                  <Icon name="phone" size={15} /> {p.phone}
                </a>
              )}
              {p.emergency_contact && (
                <div className="flex items-center gap-2 text-ink/70">
                  <Icon name="shield" size={15} /> {p.emergency_contact}
                </div>
              )}
            </div>
          </Card>
          <Card>
            <SectionTitle>{p.role === "member" ? "Edit player" : "Edit coach settings"}</SectionTitle>
            <ActionForm action="adminUpdateMember" hidden={{ user_id: p.id }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" className="sm:col-span-2">
                  <input className="input" name="full_name" defaultValue={p.full_name} required />
                </Field>
                <Field label="Email" hint={p.onboarded ? "Changes the contact email, not the one they sign in with." : undefined}>
                  <input className="input" type="email" name="email" defaultValue={p.email ?? ""} />
                </Field>
                <Field label="Mobile">
                  <input className="input" type="tel" name="phone" defaultValue={p.phone ?? ""} />
                </Field>
                <Field label="Emergency contact" className="sm:col-span-2">
                  <input className="input" name="emergency_contact" defaultValue={p.emergency_contact} />
                </Field>
                <Field label="Role" hint="Coaches get My Schedule; admins also get this admin area.">
                  <select className="input" name="role" defaultValue={p.role} disabled={isMe}>
                    <option value="member">Player</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                  </select>
                  {isMe && <input type="hidden" name="role" value={p.role} />}
                </Field>
                <Field label="Status">
                  <select className="input" name="status" defaultValue={p.status} disabled={isMe}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive (can't book)</option>
                  </select>
                  {isMe && <input type="hidden" name="status" value={p.status} />}
                </Field>
              </div>
              <Submit className="mt-5">Save</Submit>
            </ActionForm>
          </Card>
          {isCoach && (
            <Card>
              <SectionTitle>Coaching</SectionTitle>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink/70">
                <span>
                  {data.coaching.sessions} upcoming community session{data.coaching.sessions === 1 ? "" : "s"} · {data.coaching.lessons} upcoming lesson{data.coaching.lessons === 1 ? "" : "s"}
                </span>
                {data.coaching.calendar ? data.coaching.calendar.status === "connected" ? <Badge tone="green">Calendar synced</Badge> : <Badge tone="amber">Calendar needs reconnecting</Badge> : <Badge>No calendar</Badge>}
              </div>
            </Card>
          )}
          {!isMe && (
            <Card>
              <SectionTitle>Remove from the platform</SectionTitle>
              <p className="mb-4 text-sm text-ink/60">Deletes the account and login. To keep their history, set Status to Inactive instead.</p>
              <ActionButton
                action="adminRemoveMember"
                input={{ user_id: p.id }}
                variant="danger"
                icon="trash"
                confirm={{
                  title: `Remove ${p.full_name}?`,
                  label: "Remove permanently",
                  danger: true,
                  body: (
                    <div className="space-y-2">
                      <p>This deletes their account, login and booking history. Their upcoming seats go to the waitlist. This can't be undone, though they can sign up again as a new player.</p>
                      {data.coaching.sessions > 0 && <p>They'll also come off {data.coaching.sessions} upcoming session{data.coaching.sessions === 1 ? "" : "s"}, which may then have no coach.</p>}
                      {data.coaching.lessons > 0 && <p>Their {data.coaching.lessons} upcoming private lesson{data.coaching.lessons === 1 ? "" : "s"} will be deleted.</p>}
                      {data.coaching.calendar && <p>Events already on their Google Calendar will stay there. To clear them first, ask them to disconnect it.</p>}
                    </div>
                  ),
                }}
              >
                Remove {p.role === "member" ? "player" : p.role}
              </ActionButton>
            </Card>
          )}
        </div>
        <div>
          <SectionTitle>Bookings</SectionTitle>
          {data.history.length ? (
            <div className="card divide-y divide-ink/[0.06]">
              {data.history.slice(0, 25).map((r) => (
                <A key={r.booking.id} href={`/admin/sessions/${r.session.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-paper/60">
                  <SessionMark type={r.session.session_type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{sessionTitle(r.session)}</span>
                    <span className="text-xs text-ink/50">{fmtDateTime(r.session.starts_at)}</span>
                  </span>
                  {r.booking.attended === true ? <Badge tone="green">Attended</Badge> : r.booking.attended === false ? <Badge tone="red">No-show</Badge> : <BookingBadge status={r.booking.status} position={r.booking.waitlist_position} />}
                </A>
              ))}
            </div>
          ) : (
            <Empty title="No bookings yet" />
          )}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── settings ─────────────────────────

export function AdminSettings({ data }: { data: D<typeof loadSettingsPage> }) {
  const s = data.settings;
  const color = (name: "color_primary" | "color_accent" | "color_background" | "color_ink" | "color_sage", label: string) => (
    <Field label={label}>
      <input className="input !p-1.5" type="color" name={name} defaultValue={s[name]} />
    </Field>
  );
  const defaults = (label: string, prefix: "group" | "pa") => (
    <div>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Capacity">
          <input className="input" type="number" name={`default_${prefix}_capacity`} defaultValue={s[`default_${prefix}_capacity`]} min={1} />
        </Field>
        <Field label="Price (USD)">
          <input className="input" name={`default_${prefix}_price`} inputMode="decimal" defaultValue={dollarsField(s[`default_${prefix}_price_cents`])} />
        </Field>
        <Field label="Minutes">
          <input className="input" type="number" name={`default_${prefix}_duration_min`} defaultValue={s[`default_${prefix}_duration_min`]} min={15} step={15} />
        </Field>
      </div>
    </div>
  );
  return (
    <>
      <PageHeader title="Settings" />
      <ActionForm action="updateSettings" className="max-w-3xl space-y-6">
        <Card>
          <SectionTitle>Booking</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cancellation window (hours)">
              <input className="input" type="number" name="cancellation_window_hours" defaultValue={s.cancellation_window_hours} min={0} />
            </Field>
            <Field label="Default location">
              <input className="input" name="default_location" defaultValue={s.default_location} />
            </Field>
            <Field label="Cancellation policy" className="sm:col-span-2">
              <textarea className="input" name="cancellation_policy" defaultValue={s.cancellation_policy} />
            </Field>
          </div>
        </Card>
        <Card>
          <SectionTitle>New session defaults</SectionTitle>
          <div className="space-y-4">
            {defaults("Group Session", "group")}
            {defaults("Performance Accelerator", "pa")}
          </div>
        </Card>
        <Card>
          <SectionTitle>Branding</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Business name">
              <input className="input" name="brand_name" defaultValue={s.brand_name} />
            </Field>
            <Field label="Logo letters">
              <input className="input" name="logo_mark" defaultValue={s.logo_mark} maxLength={4} />
            </Field>
            <Field label="WhatsApp community link" className="sm:col-span-2">
              <input className="input" name="community_url" defaultValue={s.community_url} placeholder="https://chat.whatsapp.com/…" />
            </Field>
            <Field label="Footer disclaimer" className="sm:col-span-2">
              <textarea className="input" name="club_disclaimer" defaultValue={s.club_disclaimer} />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {color("color_primary", "Primary")}
            {color("color_accent", "Accent")}
            {color("color_background", "Background")}
            {color("color_ink", "Text")}
            {color("color_sage", "Secondary")}
          </div>
        </Card>
        <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
          <Submit size="lg" icon="check" className="shadow-lg">
            Save settings
          </Submit>
        </div>
      </ActionForm>
    </>
  );
}
