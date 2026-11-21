import { useState, type ReactNode } from "react";
import { A, useNav, withQuery } from "../nav";
import { Icon, SessionMark } from "../icons";
import { ActionButton, ActionForm, Avatar, Badge, BookingBadge, btn, Capacity, Card, cx, Empty, Field, HeroPanel, HeroStat, LinkButton, Modal, Notice, PageHeader, SectionTitle, Stat, Submit, Tabs } from "../kit";
import { DecisionCard, priceLabel, slotTime, WeekGrid, whenWord } from "../sessions";
import { Dropdown } from "../picker";
import type { FrameMeta } from "../shell";
import type { loadAdminCoaches, loadAdminMember, loadAdminMembers, loadAdminSchedule, loadSessionEditor, loadSettingsPage } from "@/core/queries";
import type { SessionType } from "@/core/types";
import { addDays, dateKey, fmtClock, fmtDate, fmtDateTime, fmtDay, fmtDayLong, fmtKeyLong, fmtKeyMonth, fmtKeyNum, fmtKeyWeekday, fmtRange, fmtTime, fmtWeekday, fmtWeekRange, startOfWeek, timeKey } from "@/core/time";
import { COURT_SIZE, courtPlan, COURTS, fmtMoney, fullPlace, isBalboa, placeLabel, placeOptions, shortPlace, SESSION_META, sessionTitle } from "@/core/util";
import { applyBulkEdit, BLANK_EDIT, changedParts, hasChanges, type BulkEdit as BulkEditInput } from "@/core/bulkedit";
import { COMMISSION_ROWS, fmtPayroll, usd } from "@/core/earnings";
import { levelLabel } from "@/core/members";
import { LevelPicker } from "./public";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

const TIMES = Array.from({ length: 64 }, (_, i) => {
  const h = 6 + Math.floor(i / 4);
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${m}`;
});

/** Location as a dropdown (BTC, Emerald Hills, past places, or Other), plus a court picker once the location is BTC. */
export function LocationCourt({ location, court, wide, places, onLocation, onCourt, span = "sm:col-span-2" }: { location: string; court: number | null; wide?: boolean; places?: string[]; onLocation?: (v: string) => void; onCourt?: (v: string) => void; span?: string }) {
  const choices = places ?? placeOptions();
  const [where, setWhere] = useState(shortPlace(location));
  const [other, setOther] = useState(!!where && !choices.includes(where));
  const balboa = isBalboa(where);
  const pick = (v: string) => {
    setWhere(v);
    onLocation?.(v);
  };
  return (
    <>
      <Field label="Location" className={wide && !balboa ? span : undefined}>
        <Dropdown
          label="Location"
          value={other ? "__other" : where}
          placeholder="Pick a place"
          options={[...choices.map((c) => ({ value: c, label: c, hint: isBalboa(c) ? "Courts 1–4" : undefined })), { value: "__other", label: "Other…" }]}
          onChange={(v) => {
            setOther(v === "__other");
            pick(v === "__other" ? "" : v);
          }}
        />
        {other && <input className="input mt-2" placeholder="Where?" value={where} onChange={(e) => pick(e.target.value)} autoFocus />}
        <input type="hidden" name="location" value={where} />
      </Field>
      {balboa && (
        <Field label="Court">
          <Dropdown name="court" label="Court" defaultValue={court ? String(court) : ""} onChange={onCourt} options={[{ value: "", label: "Not set yet" }, ...COURTS.map((n) => ({ value: String(n), label: `Court ${n}` }))]} />
        </Field>
      )}
    </>
  );
}

export function TimeSelect({ name, value }: { name: string; value: string }) {
  const opts = TIMES.includes(value) ? TIMES : [value, ...TIMES];
  return <Dropdown name={name} label="Start time" defaultValue={value} options={opts.map((t) => ({ value: t, label: fmtClock(t) }))} />;
}

const dollarsField = (cents: number | null | undefined) => (cents == null ? "" : cents / 100);

// ───────────────────────── community schedule ─────────────────────────

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function WeekPulse({ pulse }: { pulse: D<typeof loadAdminSchedule>["pulse"] }) {
  const pct = pulse.capacity ? Math.round((pulse.filled / pulse.capacity) * 100) : 0;
  const open = pulse.capacity - pulse.filled;
  const tallest = Math.max(1, ...pulse.days.map((d) => d.capacity));
  const today = pulse.days[0].day;
  const { next, revenue } = pulse;
  const money = (cents: number) => fmtMoney(cents, { free: "$0" });
  return (
    <HeroPanel eyebrow="Next 7 days">
      <h2 className="mt-2 max-w-lg font-display text-3xl leading-tight font-semibold tracking-tight sm:pr-24 md:text-[2.2rem]">
        {pulse.sessions ? `${plural(pulse.booked, "player")} booked across ${plural(pulse.sessions, "session")}.` : "Nothing posted for the week yet."}
      </h2>
      {next && (
        <A href={`/admin/sessions/${next.id}`} className="mt-3 flex max-w-xl items-center gap-1.5 text-sm text-paper/75 hover:text-paper">
          <span className="min-w-0">
            <span className="font-semibold text-accent">Next up</span> {sessionTitle(next)}, {whenWord(next.starts_at, today)} at {fmtTime(next.starts_at)} · {next.spots_left ? `${plural(next.spots_left, "spot")} left` : next.waitlist ? `full, ${next.waitlist} waiting` : "full"}
          </span>
          <Icon name="right" size={14} className="shrink-0" />
        </A>
      )}
      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_auto] xl:items-end">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat value={`${pct}%`} label={`filled · ${open} open${pulse.waitlist ? ` · ${pulse.waitlist} waiting` : ""}`}>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper/15">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </HeroStat>
          <HeroStat
            value={revenue.unpriced === pulse.sessions && pulse.sessions ? "TBA" : money(revenue.booked)}
            label={revenue.full > revenue.booked ? `booked · ${money(revenue.full)} if full` : revenue.unpriced ? `booked · ${plural(revenue.unpriced, "session")} unpriced` : "booked"}
          />
          <HeroStat value={pulse.new_bookings ? `+${pulse.new_bookings}` : 0} label="booked in last 7 days" />
          <HeroStat value={pulse.last_week} label={`${pulse.last_week === 1 ? "player" : "players"} last week`} />
        </dl>
        <div className="flex items-end gap-1.5 sm:gap-2" aria-label="Spots filled by day">
          {pulse.days.map((d, i) => (
            <div key={d.day} className="flex w-8 flex-col items-center gap-1 sm:w-9" title={`${fmtKeyLong(d.day)}: ${d.booked}/${d.capacity} booked`}>
              <span className={cx("text-[10px] font-semibold tabular-nums text-paper/80", !d.capacity && "invisible")}>
                {d.booked}/{d.capacity}
              </span>
              <div className="flex h-20 w-full items-end">
                {d.capacity > 0 ? (
                  <div className="relative w-full overflow-hidden rounded-md bg-paper/15" style={{ height: `${(d.capacity / tallest) * 100}%` }}>
                    <div className="seat-taken absolute inset-x-0 bottom-0 rounded-md bg-accent" style={{ height: `${(d.booked / d.capacity) * 100}%`, animationDelay: `${i * 50}ms` }} />
                  </div>
                ) : (
                  <div className="h-1 w-full rounded-full bg-paper/15" />
                )}
              </div>
              <span className="text-[10px] font-medium text-paper/60 uppercase">{i === 0 ? "Today" : fmtKeyWeekday(d.day)}</span>
              <span className="-mt-1 text-[11px] font-semibold tabular-nums">{fmtKeyNum(d.day)}</span>
            </div>
          ))}
        </div>
      </div>
    </HeroPanel>
  );
}

function NeedsAttention({ items, today }: { items: D<typeof loadAdminSchedule>["pulse"]["attention"]; today: string }) {
  if (!items.length) return null;
  return (
    <section className="mb-6">
      <SectionTitle>Needs a look</SectionTitle>
      <div className="card divide-y divide-ink/[0.06]">
        {items.map(({ session: s, tone, text }) => (
          <A key={s.id} href={`/admin/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sage/20 md:px-5">
            <SessionMark type={s.session_type} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{sessionTitle(s)}</span>
              <span className="block text-[13px] text-ink/55 capitalize">
                {whenWord(s.starts_at, today)} · {fmtRange(s.starts_at, s.ends_at)}
              </span>
            </span>
            <Badge tone={tone}>{text}</Badge>
            <Icon name="right" size={16} className="shrink-0 text-ink/30" />
          </A>
        ))}
      </div>
    </section>
  );
}

export function AdminSchedule({ data }: { data: D<typeof loadAdminSchedule> }) {
  const nav = useNav();
  const today = data.pulse.days[0].day;
  const tabHref = (tab: string) => withQuery("/admin", { tab: tab === "upcoming" ? "" : tab });
  // Ticked rows for bulk publish / cancel / delete. Only ids still on screen count, so a reload or tab change drops the rest.
  const [ticked, setTicked] = useState<string[]>([]);
  const canPick = data.tab !== "past";
  const picked = canPick ? data.sessions.filter((s) => ticked.includes(s.id)) : [];
  const allPicked = picked.length > 0 && picked.length === data.sessions.length;
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <>
      <PageHeader title="Community Schedule" subtitle="Group Sessions and Performance Accelerators." actions={<LinkButton href="/admin/sessions/new" icon="plus">New session</LinkButton>} />
      <WeekPulse pulse={data.pulse} />
      <NeedsAttention items={data.pulse.attention} today={today} />
      {data.calendar ? (
        <ScheduleCalendar cal={data.calendar} />
      ) : (
        <>
      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <div className="min-w-0">
          <Tabs
            current={data.tab}
            items={[
              { key: "upcoming", label: "Upcoming", href: tabHref("upcoming"), count: data.counts.upcoming },
              { key: "draft", label: "Drafts", href: tabHref("draft"), count: data.counts.draft },
              { key: "past", label: "Past", href: tabHref("past") },
            ]}
          />
        </div>
        <ViewSwitch current="list" />
      </div>
      {picked.length > 0 && <BulkBar picked={picked} drafts={data.tab === "draft"} coaches={data.coaches} places={data.places} onDone={() => setTicked([])} />}
      {data.sessions.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {canPick && (
                  <th className="w-10 !pr-0">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand align-middle" aria-label="Select all" checked={allPicked} onChange={() => setTicked(allPicked ? [] : data.sessions.map((s) => s.id))} />
                  </th>
                )}
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
                <tr key={s.id} className={cx("cursor-pointer", ticked.includes(s.id) && "bg-sage/30")} onClick={() => nav.push(`/admin/sessions/${s.id}`)}>
                  {canPick && (
                    <td className="w-10 !pr-0" onClick={(e) => { e.stopPropagation(); toggle(s.id); }}>
                      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand align-middle" aria-label="Select session" checked={ticked.includes(s.id)} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                  )}
                  <td>
                    <div className="flex items-center gap-2 font-medium">
                      <SessionMark type={s.session_type} /> {SESSION_META[s.session_type!].label}
                    </div>
                    {s.title && <div className="mt-0.5 pl-5 text-xs text-ink/55">{s.title}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {fmtDay(s.starts_at)}
                      {dateKey(s.starts_at) === today ? <Badge tone="accent">Today</Badge> : dateKey(s.starts_at) === addDays(today, 1) ? <Badge>Tomorrow</Badge> : null}
                    </div>
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
      )}
    </>
  );
}

/** What to do with the ticked sessions. Drafts can be published; posted sessions cancelled; either deleted if nobody booked. */
function BulkBar({ picked, drafts, coaches, places, onDone }: { picked: D<typeof loadAdminSchedule>["sessions"]; drafts: boolean; coaches: { id: string; full_name: string }[]; places: string[]; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const ids = picked.map((s) => s.id);
  const n = picked.length;
  const word = `${n} session${n === 1 ? "" : "s"}`;
  const players = picked.reduce((t, s) => t + s.booked + s.waitlist, 0);
  const withBookings = picked.filter((s) => s.booked + s.waitlist > 0).length;
  const done = (r: { ok: boolean }) => r.ok && onDone();
  return (
    <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/15 bg-card px-3 py-2 shadow-md">
      <span className="mr-auto text-sm font-semibold">{word} selected</span>
      <button type="button" className={btn("outline", "sm")} onClick={() => setEditing(true)}>
        <Icon name="edit" size={15} /> Edit
      </button>
      <BulkEdit open={editing} picked={picked} coaches={coaches} places={places} onClose={() => setEditing(false)} onDone={onDone} />
      {drafts && (
        <ActionButton action="bulkSessions" input={{ session_ids: ids, op: "publish" }} variant="primary" icon="check" onDone={done} confirm={{ title: `Publish ${word}?`, body: "Players can see and book them straight away.", label: "Publish" }}>
          Publish
        </ActionButton>
      )}
      {!drafts && (
        <ActionButton
          action="bulkSessions"
          input={{ session_ids: ids, op: "cancel" }}
          variant="danger"
          onDone={done}
          confirm={{ title: `Cancel ${word}?`, body: players ? `${players} booking(s) will be cancelled. Tell players on WhatsApp.` : "Nobody has booked these yet.", label: "Cancel sessions", danger: true, reason: true }}
        >
          Cancel
        </ActionButton>
      )}
      <ActionButton
        action="bulkSessions"
        input={{ session_ids: ids, op: "delete" }}
        variant="ghost"
        icon="trash"
        onDone={done}
        confirm={{ title: `Delete ${word}?`, body: withBookings ? `This can't be undone. ${withBookings} of them ${withBookings === 1 ? "has" : "have"} bookings and will be kept — cancel ${withBookings === 1 ? "it" : "those"} instead.` : "This can't be undone.", label: "Delete", danger: true }}
      >
        Delete
      </ActionButton>
      <button type="button" className={btn("ghost", "sm")} onClick={onDone}>
        Clear
      </button>
    </div>
  );
}

type Picked = D<typeof loadAdminSchedule>["sessions"];

/** Small pill switch for "keep / change how" choices inside the edit dialog. */
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-ink/[0.05] p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx("flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold", value === o.value ? "bg-card shadow-sm" : "text-ink/55 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EditSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-ink/8 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink/45">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const minutesBetween = (s: { starts_at: string; ends_at: string }) => Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);

/** "Now: …" under a field: the value every ticked session shares, or "mixed". */
function nowHint(picked: Picked, f: (s: Picked[number]) => string) {
  const all = [...new Set(picked.map(f))];
  return all.length === 1 ? `Now: ${all[0] || "none"}` : "Now: mixed";
}

/** One form for every ticked session. Anything left on Keep stays as each session has it. A live list shows what each one becomes. */
function BulkEdit({ open, picked, coaches, places, onClose, onDone }: { open: boolean; picked: Picked; coaches: { id: string; full_name: string }[]; places: string[]; onClose: () => void; onDone: () => void }) {
  const [e, setE] = useState<BulkEditInput>(BLANK_EDIT);
  const [capText, setCapText] = useState("");
  const [priceText, setPriceText] = useState("");
  const set = (patch: Partial<BulkEditInput>) => setE((cur) => ({ ...cur, ...patch }));
  const word = `${picked.length} session${picked.length === 1 ? "" : "s"}`;
  const keep = "Keep as is";
  const name = new Map(coaches.map((c) => [c.id, c.full_name.split(" ")[0]]));
  const hasPA = e.session_type === "performance_accelerator" || (e.session_type === "" && picked.some((s) => s.session_type === "performance_accelerator"));
  const atBalboa = e.location ? isBalboa(e.location) : picked.some((s) => isBalboa(s.location));
  const cap = capText.trim() === "" ? null : Number(capText);
  const price = priceText.trim() === "" ? null : Math.round(Number(priceText.replace(/[$,]/g, "")) * 100);
  const edit: BulkEditInput = { ...e, capacity: Number.isFinite(cap) ? cap : null, price: Number.isFinite(price) ? price : null, location: e.location ? fullPlace(e.location) : "" };
  const close = () => {
    setE(BLANK_EDIT);
    setCapText("");
    setPriceText("");
    onClose();
  };

  const preview = picked.map((s) => {
    const { next, error } = applyBulkEdit(s, edit);
    const full = !error && s.booked > next.capacity;
    return { s, next, parts: changedParts(s, next), error: error ?? (full ? `has ${s.booked} booked — more than ${next.capacity} spots` : undefined) };
  });
  const changing = preview.filter((p) => Object.values(p.parts).some(Boolean)).length;
  const problems = preview.filter((p) => p.error).length;
  const people = (ids: string[]) => ids.map((id) => name.get(id) ?? "?").join(", ") || "No coach";
  const hi = (on: boolean) => (on ? "font-semibold text-brand" : "text-ink/55");

  return (
    <Modal open={open} onClose={close} title={`Edit ${word}`} wide>
      <p className="mb-5 text-sm text-ink/60">Change only what you need. Anything left on “Keep” stays as each session has it. Check the list at the bottom before saving.</p>
      {open && (
        <ActionForm
          action="bulkEditSessions"
          hidden={{ session_ids: picked.map((s) => s.id), ...edit, capacity: capText, price: priceText, location: e.location }}
          onDone={(r) => {
            if (!r.ok) return;
            close();
            onDone();
          }}
        >
          <div className="space-y-5">
            <EditSection title="When">
              <Field label="Day" hint={nowHint(picked, (s) => fmtWeekday(s.starts_at))}>
                <Dropdown
                  label="Day"
                  value={e.move}
                  onChange={(v) => set({ move: v })}
                  options={[
                    { value: "", label: "Keep dates" },
                    ...WEEKDAY_NAMES.map((d, i) => ({ value: `wd:${i}`, label: `Move to ${d}`, hint: "Same week" })),
                    { value: "days:-7", label: "1 week earlier" },
                    { value: "days:-1", label: "1 day earlier" },
                    { value: "days:1", label: "1 day later" },
                    { value: "days:7", label: "1 week later" },
                    { value: "days:14", label: "2 weeks later" },
                    { value: "days:28", label: "4 weeks later" },
                  ]}
                />
              </Field>
              <Field label="Start time (Pacific)" hint={nowHint(picked, (s) => fmtTime(s.starts_at))}>
                <Dropdown
                  label="Start time"
                  value={e.time}
                  onChange={(v) => set({ time: v })}
                  options={[
                    { value: "", label: keep },
                    { value: "-60", label: "1 hour earlier" },
                    { value: "-30", label: "30 min earlier" },
                    { value: "+30", label: "30 min later" },
                    { value: "+60", label: "1 hour later" },
                    ...TIMES.map((t) => ({ value: t, label: fmtClock(t) })),
                  ]}
                />
              </Field>
              <Field label="Length" hint={nowHint(picked, (s) => `${minutesBetween(s)} min`)}>
                <Dropdown
                  label="Length"
                  value={e.duration_min === null ? "" : String(e.duration_min)}
                  onChange={(v) => set({ duration_min: v ? Number(v) : null })}
                  options={[{ value: "", label: keep }, ...[45, 60, 75, 90, 105, 120, 150, 180].map((m) => ({ value: String(m), label: m < 60 || m % 60 ? `${m} min` : `${m / 60} hour${m > 60 ? "s" : ""}` }))]}
                />
              </Field>
              <Field label="Status" hint={nowHint(picked, (s) => (s.status === "draft" ? "Draft" : "Published"))}>
                <Dropdown
                  label="Status"
                  value={e.status}
                  onChange={(v) => set({ status: v as BulkEditInput["status"] })}
                  options={[
                    { value: "", label: keep },
                    { value: "published", label: "Published", hint: "Players can book" },
                    { value: "draft", label: "Draft", hint: "Hidden from players" },
                  ]}
                />
              </Field>
            </EditSection>

            <EditSection title="Session">
              <div className="sm:col-span-2">
                <span className="label">Type</span>
                <Seg
                  label="Session type"
                  value={e.session_type || "keep"}
                  onChange={(v) => set({ session_type: v === "keep" ? "" : (v as SessionType) })}
                  options={[
                    { value: "keep", label: "Keep" },
                    { value: "group", label: SESSION_META.group.label },
                    { value: "performance_accelerator", label: SESSION_META.performance_accelerator.label },
                  ]}
                />
              </div>
              {hasPA && (
                <div className="sm:col-span-2">
                  <span className="label">Focus (Performance Accelerators)</span>
                  <Seg label="Focus" value={e.title_mode} onChange={(v) => set({ title_mode: v })} options={[{ value: "keep", label: "Keep" }, { value: "set", label: "Change" }, { value: "clear", label: "Clear" }]} />
                  {e.title_mode === "set" && <input className="input mt-2" value={e.title} onChange={(x) => set({ title: x.target.value })} placeholder="For example: Serve + Returns" autoFocus />}
                </div>
              )}
            </EditSection>

            <EditSection title="Coaches & spots">
              <div className="sm:col-span-2">
                <span className="label">Coaches</span>
                <Seg
                  label="Coaches"
                  value={e.coach_mode}
                  onChange={(v) => set({ coach_mode: v })}
                  options={[
                    { value: "keep", label: "Keep" },
                    { value: "replace", label: "Set to" },
                    { value: "add", label: "Add" },
                    { value: "remove", label: "Remove" },
                  ]}
                />
                {e.coach_mode !== "keep" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {coaches.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink/12 bg-card px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                        <input type="checkbox" className="check" checked={e.coach_ids.includes(c.id)} onChange={(x) => set({ coach_ids: x.target.checked ? [...e.coach_ids, c.id] : e.coach_ids.filter((id) => id !== c.id) })} />
                        {c.full_name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-ink/50">{nowHint(picked, (s) => people(s.coach_ids))}</p>
              </div>
              <div className="sm:col-span-2">
                <span className="label">Spots</span>
                <Seg
                  label="Spots"
                  value={e.spots}
                  onChange={(v) => set({ spots: v })}
                  options={[
                    { value: "keep", label: "Keep" },
                    { value: "coaches", label: "One court per coach" },
                    { value: "set", label: "Set number" },
                  ]}
                />
                {e.spots === "set" && <input className="input mt-2" type="number" min={1} value={capText} onChange={(x) => setCapText(x.target.value)} placeholder="Spots" autoFocus />}
                <p className="mt-1 text-xs text-ink/50">
                  {nowHint(picked, (s) => `${s.capacity} spots`)}
                  {e.spots === "keep" && " · follows the coaches if the number of coaches or the type changes"}
                </p>
              </div>
            </EditSection>

            <EditSection title="Place & price">
              <Field label="Location" hint={nowHint(picked, (s) => shortPlace(s.location))}>
                <Dropdown label="Location" value={e.location} onChange={(v) => set({ location: v })} options={[{ value: "", label: keep }, ...places.map((p) => ({ value: p, label: p }))]} />
              </Field>
              {atBalboa && (
                <Field label="Court" hint={nowHint(picked, (s) => (s.court ? `Court ${s.court}` : "not set"))}>
                  <Dropdown label="Court" value={e.court} onChange={(v) => set({ court: v as BulkEditInput["court"] })} options={[{ value: "keep", label: keep }, { value: "none", label: "Not set yet" }, ...COURTS.map((n) => ({ value: String(n), label: `Court ${n}` }))]} />
                </Field>
              )}
              <div className="sm:col-span-2">
                <span className="label">Price per player</span>
                <Seg label="Price" value={e.price_mode} onChange={(v) => set({ price_mode: v })} options={[{ value: "keep", label: "Keep" }, { value: "set", label: "Set price" }, { value: "tba", label: "Price TBA" }]} />
                {e.price_mode === "set" && <input className="input mt-2" inputMode="decimal" value={priceText} onChange={(x) => setPriceText(x.target.value)} placeholder="USD, 0 for free" autoFocus />}
                <p className="mt-1 text-xs text-ink/50">{nowHint(picked, (s) => fmtMoney(s.price_cents))}</p>
              </div>
            </EditSection>

            <EditSection title="Notes">
              {(
                [
                  ["notes_mode", "description", "Notes for players"],
                  ["internal_mode", "internal_notes", "Session notes (coaches only)"],
                ] as const
              ).map(([mode, field, label]) => (
                <div key={field} className="sm:col-span-2">
                  <span className="label">{label}</span>
                  <Seg label={label} value={e[mode]} onChange={(v) => set({ [mode]: v })} options={[{ value: "keep", label: "Keep" }, { value: "replace", label: "Replace" }, { value: "append", label: "Add to end" }, { value: "clear", label: "Clear" }]} />
                  {(e[mode] === "replace" || e[mode] === "append") && <textarea className="input mt-2 !min-h-[72px]" value={e[field]} onChange={(x) => set({ [field]: x.target.value })} autoFocus />}
                </div>
              ))}
            </EditSection>

            <section className="border-t border-ink/8 pt-4">
              <h3 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink/45">
                <span>What will change</span>
                <span className="normal-case tracking-normal">{hasChanges(edit) ? `${changing} of ${picked.length} change${problems ? ` · ${problems} can't` : ""}` : "Nothing yet"}</span>
              </h3>
              <ul className="max-h-64 divide-y divide-ink/8 overflow-y-auto rounded-xl border border-ink/10">
                {preview.map(({ s, next, parts, error }) => (
                  <li key={s.id} className={cx("px-3 py-2 text-sm", error && "bg-[#F5E1DC]/60")}>
                    <div className="flex items-center gap-2">
                      <SessionMark type={next.session_type!} />
                      <span className={cx("font-medium", parts.type && "text-brand")}>{sessionTitle(next)}</span>
                      {parts.status && <Badge tone={next.status === "draft" ? "neutral" : "green"}>{next.status === "draft" ? "Draft" : "Published"}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                      <span className={hi(parts.when)}>
                        {parts.when && <s className="mr-1 font-normal text-ink/35">{fmtDay(s.starts_at)} {fmtRange(s.starts_at, s.ends_at)}</s>}
                        {fmtDay(next.starts_at)} {fmtRange(next.starts_at, next.ends_at)}
                      </span>
                      <span className={hi(parts.coaches)}>{people(next.coach_ids)}</span>
                      <span className={hi(parts.spots)}>{next.capacity} spots</span>
                      <span className={hi(parts.price)}>{fmtMoney(next.price_cents)}</span>
                      <span className={hi(parts.place)}>{placeLabel(next)}</span>
                      {parts.notes && <span className={hi(true)}>Notes changed</span>}
                    </div>
                    {error && <p className="mt-0.5 text-xs font-medium text-[#8E3326]">This one {error}.</p>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Submit icon="check">Save {word}</Submit>
            <button type="button" className={btn("ghost", "md")} onClick={close}>
              Close
            </button>
          </div>
        </ActionForm>
      )}
    </Modal>
  );
}

type Cal = NonNullable<D<typeof loadAdminSchedule>["calendar"]>;

/** List, Week or Month, in the same pill style as the tabs. */
function ViewSwitch({ current }: { current: "list" | "week" | "month" }) {
  const views = [
    { key: "list", label: "List", href: "/admin" },
    { key: "week", label: "Week", href: withQuery("/admin", { view: "week" }) },
    { key: "month", label: "Month", href: withQuery("/admin", { view: "month" }) },
  ] as const;
  return (
    <nav className="mb-5 flex shrink-0 gap-1 rounded-xl bg-ink/[0.045] p-1" aria-label="View">
      {views.map((v) => (
        <A key={v.key} href={v.href} aria-current={v.key === current ? "page" : undefined} className={cx("rounded-lg px-3 py-2 text-sm font-medium transition-colors", v.key === current ? "bg-card text-ink shadow-sm" : "text-ink/60 hover:text-ink")}>
          {v.label}
        </A>
      ))}
    </nav>
  );
}

const monthShift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** Week or month calendar of community sessions. Tap free time (week) to start a new session there. */
function ScheduleCalendar({ cal }: { cal: Cal }) {
  const nav = useNav();
  const week = cal.view === "week";
  const prev = week ? withQuery("/admin", { view: "week", week: addDays(cal.first, -7) }) : withQuery("/admin", { view: "month", month: monthShift(cal.month, -1) });
  const next = week ? withQuery("/admin", { view: "week", week: addDays(cal.first, 7) }) : withQuery("/admin", { view: "month", month: monthShift(cal.month, 1) });
  const now = withQuery("/admin", { view: cal.view });
  return (
    <>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-x-3">
        <div className="mb-5 flex items-center gap-2">
          <A href={prev} className={btn("outline", "sm")} aria-label={week ? "Previous week" : "Previous month"}>
            <Icon name="left" size={16} />
          </A>
          <A href={now} className={btn("outline", "sm")}>
            Today
          </A>
          <A href={next} className={btn("outline", "sm")} aria-label={week ? "Next week" : "Next month"}>
            <Icon name="right" size={16} />
          </A>
          <span className="ml-1.5 font-display text-[17px] font-semibold tracking-tight">{week ? fmtWeekRange(cal.first) : fmtKeyMonth(`${cal.month}-01`)}</span>
        </div>
        <ViewSwitch current={cal.view} />
      </div>
      {week ? (
        <>
          <p className="mb-2 text-[12.5px] text-ink/50">
            <span className="md:hidden">Tap free time to add a session there. Swipe sideways for the rest of the week.</span>
            <span className="hidden md:inline">Click or drag over free time to add a session there. Pale blocks are drafts.</span>
          </p>
          <WeekGrid
            days={Array.from({ length: 7 }, (_, i) => addDays(cal.first, i))}
            today={cal.today}
            items={cal.items}
            nowIso={cal.nowIso}
            onCreate={(slot) => nav.push(withQuery("/admin/sessions/new", { date: slot.day, time: slotTime(slot.start) }))}
          />
        </>
      ) : (
        <MonthGrid cal={cal} />
      )}
    </>
  );
}

function MonthGrid({ cal }: { cal: Cal }) {
  const days: string[] = [];
  for (let d = cal.first; d < cal.end; d = addDays(d, 1)) days.push(d);
  const weekdays = days.slice(0, 7);
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-ink/[0.07]">
        {weekdays.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold tracking-wide text-ink/45 uppercase">
            {fmtKeyWeekday(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.startsWith(cal.month);
          const items = cal.items.filter((s) => dateKey(s.starts_at) === d);
          const shown = items.slice(0, 3);
          const weekHref = withQuery("/admin", { view: "week", week: startOfWeek(d) });
          return (
            <div key={d} className={cx("min-h-[76px] border-ink/[0.06] p-1 sm:min-h-[118px] sm:p-1.5", i % 7 !== 0 && "border-l", i >= 7 && "border-t", !inMonth && "bg-ink/[0.02]", d === cal.today && "bg-sage/25")}>
              <A href={weekHref} title="Open this week" className={cx("mb-1 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums hover:bg-ink/[0.06]", d === cal.today ? "bg-brand text-paper hover:bg-brand" : !inMonth ? "text-ink/30" : d < cal.today ? "text-ink/45" : "text-ink")}>
                {fmtKeyNum(d)}
              </A>
              {/* Phones: a coloured dot per session. */}
              {items.length > 0 && (
                <A href={weekHref} className="flex flex-wrap gap-1 px-1 sm:hidden" aria-label={`${items.length} sessions`}>
                  {items.map((s) => (
                    <span key={s.id} className={cx("h-2 w-2 rounded-full", s.draft && "opacity-40")} style={{ background: s.color }} />
                  ))}
                </A>
              )}
              <div className="hidden space-y-1 sm:block">
                {shown.map((s) => (
                  <A key={s.id} href={s.href} title={`${s.title} · ${fmtRange(s.starts_at, s.ends_at)} · ${s.detail}`} className="block">
                    <span
                      className={cx("flex items-center gap-1 truncate rounded-md px-1.5 py-[3px] text-[11.5px] leading-tight font-semibold hover:brightness-110", s.draft ? "border border-dashed border-ink/25 text-ink/60" : "text-white shadow-[0_1px_1px_rgba(16,24,20,0.15)]", s.ends_at < cal.nowIso && "opacity-60")}
                      style={s.draft ? { background: "#F1F3F1" } : { background: s.color }}
                    >
                      <span className="shrink-0 font-medium tabular-nums opacity-85">{fmtTime(s.starts_at).replace(" ", "").toLowerCase()}</span>
                      <span className="truncate">{s.title}</span>
                    </span>
                  </A>
                ))}
                {items.length > shown.length && (
                  <A href={weekHref} className="block px-1.5 text-[11px] font-medium text-ink/55 hover:text-ink">
                    +{items.length - shown.length} more
                  </A>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

/** One court per coach: 6 spots a court for a Group Session, 4 for a Performance Accelerator. */
function SpotsLine({ type, capacity }: { type: SessionType; capacity: number }) {
  const { courts, minimum } = courtPlan({ session_type: type, capacity });
  return (
    <p className="mt-2 text-xs text-ink/55">
      <input type="hidden" name="capacity" value={capacity} />
      {courts > 1 ? `${courts} courts · ${capacity} spots · needs ${minimum} to go ahead` : `1 court · ${capacity} spots`}
    </p>
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
  const [coaches, setCoaches] = useState<string[]>(coachIds);
  // Each coach brings a court. An existing session keeps its spots until its coaches change.
  const sameCoaches = !!s && coaches.length === coachIds.length && coaches.every((id) => coachIds.includes(id));
  const capacity = sameCoaches ? s!.capacity : Math.max(1, coaches.length) * COURT_SIZE[type];
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
        <Field label="Price per player (USD)" hint="Blank for “Price TBA”, 0 for free">
          <input className="input" name="price" inputMode="decimal" defaultValue={dollarsField(s ? s.price_cents : defaults.price_cents)} />
        </Field>
        <LocationCourt location={s?.location ?? data.defaults.location} court={s?.court ?? null} places={data.places} />
        <fieldset className="sm:col-span-2">
          <legend className="label">Coach</legend>
          <div className="flex flex-wrap gap-2">
            {data.coaches.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink/12 bg-card px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                <input type="checkbox" name="coach_ids[]" value={c.id} checked={coaches.includes(c.id)} onChange={(e) => setCoaches((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} className="check" />
                {c.full_name}
              </label>
            ))}
          </div>
          <SpotsLine type={type} capacity={capacity} />
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
      <div className="mb-4 empty:hidden">
        <DecisionCard s={s} booked={data.roster.filter((r) => r.booking.status === "confirmed").map((r) => ({ name: r.player?.full_name ?? "A player", at: r.booking.created_at }))} />
      </div>
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
                    {data.fullAdmin ? (
                      <A href={`/admin/members/${r.player?.id}`} className="text-sm font-semibold hover:underline">
                        {r.player?.full_name}
                      </A>
                    ) : (
                      <span className="text-sm font-semibold">{r.player?.full_name}</span>
                    )}
                    <div className="truncate text-xs text-ink/50">{r.player?.email ?? r.player?.phone}</div>
                  </div>
                  {r.booking.status === "confirmed" && r.booking.spot_offered_at && <Badge tone="amber">Offering spot</Badge>}
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

type CoachesData = D<typeof loadAdminCoaches>;
type CoachRow = CoachesData["coaches"][number];

function CoachStat({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: "warn" }) {
  return (
    <div className={cx("min-w-0 rounded-xl px-3 py-2.5", tone === "warn" ? "bg-[#D29A3A]/10" : "bg-ink/[0.03]")}>
      <div className="text-[12px] text-ink/55">{label}</div>
      <div className={cx("mt-0.5 font-display text-xl font-semibold tracking-tight tabular-nums", tone === "warn" && "text-[#8A5A10]")}>{value}</div>
      <div className="truncate text-[11px] text-ink/45">{hint}</div>
    </div>
  );
}

/** Up or down against the same point of the previous period. */
function Change({ now, before, word, current, light }: { now: number; before: number; word: string; current: boolean; light?: boolean }) {
  const diff = now - before;
  if (!now && !before) return null;
  const up = light ? "text-accent" : "text-brand";
  const down = light ? "text-[#F3B7A8]" : "text-[#A4462F]";
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px]", light ? "bg-paper/10 ring-1 ring-paper/15" : "bg-ink/[0.04]")}>
      <span className={cx("font-semibold tabular-nums", diff > 0 ? up : diff < 0 ? down : "")}>
        {diff > 0 ? "▲" : diff < 0 ? "▼" : "="} {usd(Math.abs(diff))}
      </span>
      <span className={light ? "text-paper/65" : "text-ink/50"}>
        vs last {word}
        {current ? " so far" : ""}
      </span>
    </span>
  );
}

function CoachChart({ chart, name }: { chart: CoachRow["chart"]; name: string }) {
  const max = Math.max(1, ...chart.map((b) => b.earned + b.booked));
  return (
    <div className="mt-4">
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`${name}: ${chart.map((b) => `${b.label} ${usd(b.earned + b.booked)}`).join(", ")}`}>
        {chart.map((b) => {
          const sum = b.earned + b.booked;
          return (
            <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.label}: ${usd(sum)}`}>
              <div className="mx-auto flex w-full max-w-8 flex-col justify-end overflow-hidden rounded-[4px]" style={{ height: `${(Math.max(0, sum) / max) * 100}%`, minHeight: sum ? 3 : 0 }}>
                {b.booked > 0 && <div className="bg-brand/25" style={{ flexGrow: b.booked }} />}
                {b.earned > 0 && <div className="bg-brand" style={{ flexGrow: b.earned }} />}
              </div>
              {!sum && <div className="mx-auto h-[2px] w-full max-w-8 rounded-full bg-ink/[0.07]" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {chart.map((b) => (
          <span key={b.key} className={cx("min-w-0 flex-1 truncate text-center text-[10.5px]", b.current ? "font-semibold text-brand" : "text-ink/45")}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CoachCard({ c, data }: { c: CoachRow; data: CoachesData }) {
  const word = data.period;
  const e = c.earned;
  return (
    <Card>
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
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[12px] text-ink/55">Earned {data.current ? `this ${word}` : `in ${data.label}`}, after commission</div>
          <div className="font-display text-3xl font-semibold tracking-tight tabular-nums">{usd(e.net)}</div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <Change now={e.net} before={c.previous} word={word} current={data.current} />
          {c.booked.count > 0 && <span className="text-[12.5px] text-ink/55">+ {usd(c.booked.net)} booked ahead</span>}
        </div>
      </div>
      {c.chart.some((b) => b.earned + b.booked > 0) ? <CoachChart chart={c.chart} name={c.full_name} /> : <p className="mt-3 text-[13px] text-ink/45">Nothing earned {data.current ? `this ${word}` : `in ${data.label}`} yet.</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <CoachStat label="Lessons" value={usd(c.lessons.net)} hint={c.lessons.count ? `${plural(c.lessons.count, "lesson")} · ${c.lessons.hours} h` : "none taught"} />
        <CoachStat label="Community" value={usd(c.community.net)} hint={c.community.count ? `${plural(c.community.count, "session")} · ${plural(c.community.players, "player")}` : "no sessions"} />
        <CoachStat label="Commission" value={usd(e.commission)} hint={data.has_rules ? `of ${usd(e.gross)} charged` : "no rate set yet"} />
        <CoachStat label="Next payroll" value={c.payday ? usd(c.payday.earned) : "–"} hint={c.payday ? `${fmtPayroll(c.payday.date)}${c.payday.booked ? ` · +${usd(c.payday.booked)} booked` : ""}` : "nothing at Balboa"} />
      </div>
      {c.owed.total > 0 && (
        <p className="mt-2 text-[12.5px] text-[#8A5A10]">
          {usd(c.owed.total)} unpaid from {plural(c.owed.lessons, "lesson")} outside BTC, not marked paid yet.
        </p>
      )}
      {c.unpriced > 0 && <p className="mt-2 text-[12px] text-[#8A5A10]">{plural(c.unpriced, "lesson or session", "lessons or sessions")} this {word} {c.unpriced === 1 ? "has" : "have"} no price, so {c.unpriced === 1 ? "it isn't" : "they aren't"} counted.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/[0.06] pt-3 text-[13px] text-ink/60">
        <span>{e.hours ? `${e.hours} h on court · ${usd(e.per_hour)} an hour` : "No hours on court yet"}</span>
        {c.community.ahead > 0 && (
          <span className="flex items-center gap-1.5">
            <SessionMark type="group" size={14} /> {plural(c.community.ahead, "community session")} ahead
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Icon name="users" size={14} /> {plural(c.clients, "client")}
        </span>
      </div>
    </Card>
  );
}

export function AdminCoaches({ data }: { data: CoachesData }) {
  const base = "/admin/coaches";
  const word = data.period;
  const go = (at: string) => withQuery(base, { period: data.period, at });
  const t = data.totals;
  return (
    <>
      <PageHeader title="Coaches" subtitle="What each coach earns from lessons and community sessions, after BTC's commission, and what's coming on the next payroll. To add a coach, open their member page and change their role." actions={<LinkButton href="/admin/members" variant="outline" icon="users">Members</LinkButton>} />
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
      <HeroPanel eyebrow={data.current ? `All coaches · this ${word}` : `All coaches · ${data.label}`}>
        <h2 className="mt-2 font-display text-4xl leading-tight font-semibold tracking-tight tabular-nums md:text-5xl">{usd(t.net)}</h2>
        <p className="mt-1 text-sm text-paper/70">
          earned from lessons and community sessions, after commission
          {t.booked > 0 && <span className="text-accent"> · {usd(t.booked)} more booked</span>}
        </p>
        <div className="mt-3">
          <Change now={t.net} before={t.previous} word={word} current={data.current} light />
        </div>
        <dl className="mt-6 grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat value={t.lessons + t.sessions} label={`${plural(t.lessons, "lesson")} · ${plural(t.sessions, "session")}`} />
          <HeroStat value={t.hours} label="hours on court" />
          <HeroStat value={usd(t.commission)} label="club commission" />
          <HeroStat value={data.payday ? usd(data.payday.earned) : "–"} label={data.payday ? `payroll ${fmtPayroll(data.payday.date)}` : "next payroll"} />
        </dl>
        {data.payday && (
          <p className="mt-4 text-[12.5px] text-paper/60">
            BTC payroll {fmtPayroll(data.payday.date)}
            {data.payday.booked > 0 && `: ${usd(data.payday.booked)} more still booked`}.
            {t.owed > 0 && ` ${usd(t.owed)} from ${plural(t.owed_lessons, "lesson")} elsewhere is still unpaid.`}
          </p>
        )}
        {!data.has_rules && (
          <p className="mt-4 text-[12.5px] text-paper/60">
            No club commission rate yet, so coaches keep the full lesson price.{" "}
            <A href="/admin/settings" className="underline hover:text-paper">
              Set it in Settings
            </A>
          </p>
        )}
      </HeroPanel>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.coaches.map((c) => (
          <CoachCard key={c.id} c={c} data={data} />
        ))}
      </div>
      <p className="mt-4 text-[12.5px] text-ink/45">Earnings count lessons and sessions once they've happened. A community session is every booked player times the price, minus commission worked out court by court, split evenly between its coaches. Balboa pays on the 20th for the 1st–15th and on the 5th for the 16th–end of month.</p>
    </>
  );
}

// ───────────────────────── members ─────────────────────────

export function AdminMembers({ data }: { data: D<typeof loadAdminMembers> }) {
  const nav = useNav();
  const [adding, setAdding] = useState(false);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
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
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Members" value={data.summary.members} hint={data.summary.newThisMonth ? `${data.summary.newThisMonth} new this month` : "None new this month"} icon="users" />
        <Stat label="Played this month" value={data.summary.activeThisMonth} hint="People on court at least once" icon="calendar" />
        <Stat label="Sessions played" value={data.members.reduce((n, m) => n + m.stats.played, 0)} hint="All time, by the people listed" icon="check" />
        <Stat label="Level not set" value={data.summary.noLevel} hint={data.summary.noLevel ? "Members who haven't picked one" : "Everyone has one"} icon="user" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <form
          className="min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            nav.push(withQuery("/admin/members", { q: String(new FormData(e.currentTarget).get("q") ?? ""), role: data.role, sort: data.sort }));
          }}
        >
          <label className="relative block">
            <Icon name="search" size={17} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink/40" />
            <input name="q" defaultValue={data.q} className="input !pl-10" placeholder="Search name, email or phone" />
          </label>
        </form>
        <div className="w-auto min-w-[9rem]">
          <Dropdown
            value={data.role}
            onChange={(v) => nav.push(withQuery("/admin/members", { q: data.q, role: v, sort: data.sort }))}
            label="Role"
            options={[
              { value: "", label: "Everyone" },
              { value: "member", label: "Members" },
              { value: "coach", label: "Coaches" },
              { value: "admin", label: "Admins" },
            ]}
          />
        </div>
        <div className="w-auto min-w-[11rem]">
          <Dropdown
            value={data.sort}
            onChange={(v) => nav.push(withQuery("/admin/members", { q: data.q, role: data.role, sort: v }))}
            label="Sort"
            options={[
              { value: "", label: "Name A–Z" },
              { value: "played", label: "Most sessions" },
              { value: "recent", label: "Played recently" },
              { value: "new", label: "Newest first" },
            ]}
          />
        </div>
      </div>
      {data.members.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden lg:table-cell">Contact</th>
                <th className="hidden sm:table-cell">Level</th>
                <th>Sessions</th>
                <th className="hidden md:table-cell">Last played</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => nav.push(`/admin/members/${m.id}`)}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.full_name} size={32} />
                      <div className="min-w-0">
                        <div className="font-medium">{m.full_name}</div>
                        <div className="flex flex-wrap gap-1">
                          {m.role !== "member" && <Badge tone="dark">{m.role}</Badge>}
                          {m.status === "inactive" && <Badge>Inactive</Badge>}
                          {!m.onboarded && <Badge tone="amber">Invited</Badge>}
                          {m.role === "member" && m.created_at >= monthAgo && <Badge tone="green">New</Badge>}
                          {m.level && <span className="text-xs text-ink/55 sm:hidden">{levelLabel(m.level)}</span>}
                        </div>
                        <div className="text-xs text-ink/45">Joined {fmtDate(m.created_at)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden text-ink/65 lg:table-cell">
                    <div>{m.email}</div>
                    <div className="text-xs">{m.phone}</div>
                  </td>
                  <td className="hidden sm:table-cell">{m.level ? levelLabel(m.level) : <span className="text-ink/35">Not set</span>}</td>
                  <td className="tabular-nums">
                    <div className="font-medium">{m.stats.played}</div>
                    <div className="text-xs text-ink/50">
                      {[m.stats.upcoming ? `${m.stats.upcoming} coming up` : "", m.stats.noShows ? `${m.stats.noShows} no-show${m.stats.noShows === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="hidden text-ink/65 md:table-cell">{m.stats.lastPlayed ? fmtDate(m.stats.lastPlayed) : <span className="text-ink/35">Not yet</span>}</td>
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
  const st = data.stats;
  return (
    <>
      <PageHeader back={{ href: "/admin/members", label: "Members" }} title={p.full_name} subtitle={[levelLabel(p.level), `Joined ${fmtDate(p.created_at)}`].filter(Boolean).join(" · ")} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessions played" value={st.played} hint={st.played ? `${st.group} Group · ${st.pa} Performance Accelerator` : "None yet"} icon="check" />
        <Stat label="This month" value={st.playedThisMonth} hint={st.lastPlayed ? `Last on ${fmtDate(st.lastPlayed)}` : "Hasn't played yet"} icon="calendar" />
        <Stat label="Coming up" value={st.upcoming} hint={st.upcoming === 1 ? "Booked session" : "Booked sessions"} icon="clock" />
        <Stat label="No-shows" value={st.noShows} hint={st.lateCancels ? `${st.lateCancels} late cancel${st.lateCancels === 1 ? "" : "s"}` : "No late cancels"} icon="flag" />
      </div>
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
                <Field label="Tennis level" className="sm:col-span-2">
                  <LevelPicker defaultValue={p.level ?? ""} />
                </Field>
                <Field label="Role" hint="Coaches get My Schedule; admins also get this admin area.">
                  <select className="input" name="role" defaultValue={p.role} disabled={isMe}>
                    <option value="member">Member</option>
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
                {p.role === "coach" && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink/12 bg-card px-3 py-2.5 text-sm sm:col-span-2 has-[:checked]:border-brand has-[:checked]:bg-sage/40">
                    <input type="checkbox" name="schedule_access" defaultChecked={!!p.schedule_access} className="check mt-0.5" />
                    <span>
                      <span className="font-semibold">Can run the Community Schedule</span>
                      <span className="block text-ink/55">Gets an Admin tab with only the Community Schedule: create, edit, publish and cancel sessions, and add or remove players. No Coaches, Members or Settings.</span>
                    </span>
                  </label>
                )}
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
      <CommissionCard rules={data.rules} />
    </>
  );
}

/** What each club takes from coaches' lessons. Coaches see the result on their Earnings page. */
function CommissionCard({ rules }: { rules: D<typeof loadSettingsPage>["rules"] }) {
  const rows = Array.from({ length: COMMISSION_ROWS }, (_, i) => rules[i] ?? (i === 0 && !rules.length ? { id: "", place: "Balboa", percent: 0, per_hour_cents: 0, per_lesson_cents: 0, max_players: null } : null));
  return (
    <Card className="mt-6 max-w-3xl">
      <SectionTitle>Club commission</SectionTitle>
      <p className="-mt-1 mb-4 text-sm text-ink/60">
        Taken automatically from lessons and community sessions whose location contains the place name. Use any mix of a percentage, an hourly court fee and a flat fee per lesson. Rates are per court, so a two-court session is charged court by court. Set "Up to players" to charge a different rate for small groups: the row with the smallest limit that fits wins, and a row with no limit covers everything bigger. A lesson keeps the commission it was saved with, so changing a rate doesn't rewrite past lesson earnings.
      </p>
      <ActionForm action="saveCommissionRules">
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r?.id || i} className="grid grid-cols-2 gap-3 sm:grid-cols-[1.3fr_0.9fr_1fr_1fr_1fr]">
              <input type="hidden" name={`id_${i}`} defaultValue={r?.id ?? ""} />
              <Field label="Place" className="col-span-2 sm:col-span-1">
                <input className="input" name={`place_${i}`} defaultValue={r?.place ?? ""} placeholder="e.g. Balboa" />
              </Field>
              <Field label="Up to players">
                <input className="input" name={`max_players_${i}`} inputMode="numeric" defaultValue={r?.max_players ?? ""} placeholder="Any" />
              </Field>
              <Field label="% of price">
                <input className="input" name={`percent_${i}`} inputMode="decimal" defaultValue={r?.percent || ""} placeholder="0" />
              </Field>
              <Field label="Per hour (USD)">
                <input className="input" name={`per_hour_${i}`} inputMode="decimal" defaultValue={r?.per_hour_cents ? r.per_hour_cents / 100 : ""} placeholder="0" />
              </Field>
              <Field label="Per lesson (USD)" className="col-span-2 sm:col-span-1">
                <input className="input" name={`per_lesson_${i}`} inputMode="decimal" defaultValue={r?.per_lesson_cents ? r.per_lesson_cents / 100 : ""} placeholder="0" />
              </Field>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink/50">Clear a place name to remove it.</p>
        <Submit className="mt-4" icon="check">
          Save commission
        </Submit>
      </ActionForm>
    </Card>
  );
}
