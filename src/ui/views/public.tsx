import { useState } from "react";
import { A, useNav, useToast } from "../nav";
import { Icon } from "../icons";
import { Avatar, Badge, btn, Capacity, Card, cx, Dot, Empty, Field, LinkButton, Notice, PageHeader, Spinner, Submit, ActionForm, Toggle } from "../kit";
import { BookButton, priceLabel, ScheduleBoard, sessionName } from "../sessions";
import { DemoBar, Logo, type FrameMeta } from "../shell";
import type { loadHome, loadOnboarding, loadProgram, loadPrograms, loadSchedule } from "@/core/queries";
import { fmtDay, fmtRange } from "@/core/time";
import { fmtMoney } from "@/core/util";
import type { Program } from "@/core/types";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;
const KIND_LABEL: Record<Program["kind"], string> = { private: "1 player", semi_private: "2 players", group: "Small group", event: "Community" };

function programPrice(p: Program) {
  if (p.price_cents === null) return "Price TBA";
  if (p.price_cents === 0) return "Free";
  return p.pricing === "per_session" ? `${fmtMoney(p.price_cents)} / ${p.duration_min === 60 ? "hour" : "session"}` : `${fmtMoney(p.price_cents)} / player`;
}

function ProgramCard({ p, upcoming }: { p: Program; upcoming?: number }) {
  return (
    <A href={`/programs/${p.slug}`} className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
      <div className="h-1.5" style={{ background: p.color }} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge>{KIND_LABEL[p.kind]}</Badge>
          <span className="text-sm font-semibold">{programPrice(p)}</span>
        </div>
        <h3 className="mt-4 font-display text-xl font-semibold tracking-tight">{p.name}</h3>
        <p className="mt-1.5 flex-1 text-[14.5px] text-ink/60">{p.summary}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink/55">
          <span className="flex items-center gap-1.5">
            <Icon name="clock" size={14} /> {p.duration_min} min
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="users" size={14} /> Up to {p.capacity}
          </span>
          {p.skill_level && <span>{p.skill_level}</span>}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-ink/[0.06] pt-4 text-sm font-semibold text-brand">
          {upcoming !== undefined ? (upcoming ? `${upcoming} upcoming` : p.allow_requests ? "Request a time" : "Coming soon") : "Learn more"}
          <Icon name="arrow" size={16} className="transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </A>
  );
}

export function HomeView({ data, meta }: { data: D<typeof loadHome>; meta: FrameMeta }) {
  const s = meta.settings;
  return (
    <>
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 pt-10 pb-16 *:min-w-0 md:grid-cols-[1.1fr_1fr] md:items-center md:px-6 md:pt-16 md:pb-24">
        <div>
          <div className="eyebrow mb-5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent ring-4 ring-accent/30" /> San Diego · Balboa Park
          </div>
          <h1 className="font-display text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.03em] text-ink md:text-[4rem]">{s.hero_headline}</h1>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink/65">{s.hero_subtext}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/schedule" size="lg" icon="calendar">
              See this week&apos;s schedule
            </LinkButton>
            <LinkButton href="/programs" size="lg" variant="outline">
              Explore programs
            </LinkButton>
          </div>
          <div className="mt-10 flex items-center gap-4">
            <div className="flex -space-x-2">
              {data.coaches.slice(0, 3).map((c) => (
                <span key={c.id} className="rounded-full ring-2 ring-paper">
                  <Avatar name={c.full_name} size={34} />
                </span>
              ))}
            </div>
            <p className="text-sm text-ink/60">
              Private lessons, clinics &amp; <span className="font-semibold text-ink">community tennis</span> every week
            </p>
          </div>
        </div>
        <div className="relative">
          <div className="court-lines relative overflow-hidden rounded-[28px] bg-brand p-6 text-paper md:p-8">
            <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-accent/25 blur-2xl" />
            <div className="relative flex items-center justify-between">
              <span className="text-[12px] font-semibold tracking-[0.12em] text-paper/60 uppercase">Coming up</span>
              <A href="/schedule" className="text-[13px] font-medium text-accent hover:underline">
                Full schedule
              </A>
            </div>
            <div className="relative mt-5 space-y-2.5">
              {data.upcoming.slice(0, 4).map((x) => (
                <A key={x.id} href={meta.signedIn ? `/app/sessions/${x.id}` : `/programs/${x.program.slug}`} className="flex items-center gap-4 rounded-2xl bg-paper/[0.07] p-3.5 transition-colors hover:bg-paper/[0.12]">
                  <div className="w-14 shrink-0 text-center">
                    <div className="text-[11px] text-paper/55 uppercase">{fmtDay(x.starts_at).split(",")[0]}</div>
                    <div className="font-display text-xl font-semibold">{new Date(x.starts_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", day: "numeric" })}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{sessionName(x)}</div>
                    <div className="text-[13px] text-paper/60">{fmtRange(x.starts_at, x.ends_at)}</div>
                  </div>
                  <span className={cx("rounded-full px-2.5 py-1 text-[11.5px] font-semibold", x.spots_left ? "bg-accent text-ink" : "bg-paper/15 text-paper/80")}>
                    {x.spots_left ? `${x.spots_left} left` : "Waitlist"}
                  </span>
                </A>
              ))}
              {!data.upcoming.length && <p className="rounded-2xl bg-paper/[0.07] p-5 text-sm text-paper/70">New sessions will appear here soon.</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-8 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <div className="eyebrow mb-2">Programs</div>
            <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Find your way onto court</h2>
          </div>
          <A href="/programs" className="text-sm font-semibold text-brand hover:underline">
            All programs →
          </A>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.programs.slice(0, 6).map((p) => (
            <ProgramCard key={p.id} p={p} />
          ))}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-4 md:px-6">
        <div className="grid gap-10 rounded-[28px] bg-sage/60 p-8 md:grid-cols-3 md:p-12">
          <div className="md:col-span-3">
            <div className="eyebrow mb-2">How it works</div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">No more group-chat polls.</h2>
          </div>
          {[
            ["user", "Create your profile", "Sign up with your email or mobile number in under a minute. Tell us your level and goals."],
            ["calendar", "Pick a session", "Browse the live weekly schedule, see exactly how many spots are left, and book in two taps."],
            ["check", "Show up & play", "Get instant confirmation and reminders. Plans change? Cancel online and the waitlist moves up automatically."],
          ].map(([icon, title, body], i) => (
            <div key={title}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-accent">
                  <Icon name={icon as "user"} size={18} />
                </span>
                <span className="text-sm font-semibold text-ink/40">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-[15px] text-ink/65">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {data.upcoming.length > 0 && (
        <section className="mx-auto mt-24 max-w-6xl px-4 md:px-6">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="eyebrow mb-2">This week</div>
              <h2 className="font-display text-3xl font-semibold tracking-tight">Open sessions</h2>
            </div>
            <A href="/schedule" className="text-sm font-semibold text-brand hover:underline">
              Full schedule →
            </A>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.upcoming.map((x) => (
              <Card key={x.id} className="flex items-center gap-4">
                <div className="w-16 shrink-0 rounded-xl bg-paper py-2 text-center">
                  <div className="text-[11px] text-ink/50 uppercase">{fmtDay(x.starts_at).split(",")[0]}</div>
                  <div className="font-display text-xl font-semibold">{new Date(x.starts_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", day: "numeric" })}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Dot color={x.program.color} /> <span className="truncate">{sessionName(x)}</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-ink/55">
                    {fmtRange(x.starts_at, x.ends_at)} · {priceLabel(x)}
                  </div>
                  {x.capacity > 1 && (
                    <div className="mt-2 max-w-[180px]">
                      <Capacity booked={x.booked} capacity={x.capacity} />
                    </div>
                  )}
                </div>
                <BookButton s={x} signedIn={meta.signedIn} />
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mt-24 grid max-w-6xl gap-10 px-4 md:grid-cols-[1fr_1.2fr] md:items-center md:px-6">
        <div className="court-lines relative aspect-[4/3] overflow-hidden rounded-[28px] bg-[#2C4A3B]">
          <div className="absolute inset-x-10 top-1/2 h-px bg-paper/40" />
          <div className="absolute inset-y-8 left-1/2 w-px bg-paper/25" />
          <div className="absolute right-10 bottom-10 h-16 w-16 rounded-full bg-accent shadow-[0_10px_40px_rgba(201,220,75,0.5)]" />
          <div className="absolute bottom-6 left-6 rounded-full bg-paper/90 px-3 py-1.5 text-xs font-semibold text-ink">Head coach</div>
        </div>
        <div>
          <div className="eyebrow mb-2">The coaching</div>
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Thoughtful coaching, real community.</h2>
          <p className="mt-4 text-[16.5px] leading-relaxed text-ink/70">{s.coach_bio}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {data.coaches.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-full bg-card py-1.5 pr-4 pl-1.5 shadow-sm">
                <Avatar name={c.full_name} size={32} />
                <span className="text-sm font-medium">{c.full_name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-4 md:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] bg-accent p-8 md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Ready to play?</h2>
            <p className="mt-2 max-w-md text-ink/70">Join the community in under a minute. Booking, waitlists and reminders — all in one place.</p>
          </div>
          <LinkButton href={meta.signedIn ? "/app/book" : "/login"} size="lg">
            {meta.signedIn ? "Book a session" : "Create your account"} <Icon name="arrow" size={17} />
          </LinkButton>
        </div>
      </section>
    </>
  );
}

export function ProgramsView({ data }: { data: D<typeof loadPrograms> }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:px-6 md:pt-14">
      <PageHeader eyebrow="Programs" title="Coaching for every stage of your game" subtitle="Private, semi-private and small-group training, plus weekly community tennis. Every program is coached personally." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.programs.map((p) => (
          <ProgramCard key={p.id} p={p} upcoming={p.upcoming} />
        ))}
      </div>
    </div>
  );
}

export function ProgramView({ data, meta }: { data: D<typeof loadProgram>; meta: FrameMeta }) {
  const p = data.program;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:px-6 md:pt-14">
      <PageHeader back={{ href: "/programs", label: "All programs" }} eyebrow={KIND_LABEL[p.kind]} title={p.name} subtitle={p.summary} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <p className="text-[16px] leading-relaxed whitespace-pre-line text-ink/75">{p.description}</p>
          </Card>
          <div>
            <h2 className="mb-3 text-lg font-semibold">Upcoming sessions</h2>
            {data.sessions.length ? (
              <div className="card divide-y divide-ink/[0.06]">
                {data.sessions.map((x) => (
                  <div key={x.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="min-w-[150px]">
                      <div className="font-semibold">{fmtDay(x.starts_at)}</div>
                      <div className="text-sm text-ink/55">{fmtRange(x.starts_at, x.ends_at)}</div>
                    </div>
                    <div className="min-w-0 flex-1 text-sm text-ink/60">
                      {x.title && <div className="font-medium text-ink">{x.title}</div>}
                      with {x.coaches.map((c) => c.full_name).join(" & ")}
                    </div>
                    {x.capacity > 1 && (
                      <div className="w-32">
                        <Capacity booked={x.booked} capacity={x.capacity} />
                      </div>
                    )}
                    <BookButton s={x} signedIn={meta.signedIn} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon="calendar"
                title="No open sessions right now"
                body={p.allow_requests ? "Request a time that works for you and we'll get back to you quickly." : "New dates are added every week — check back soon."}
                action={p.allow_requests ? <LinkButton href={meta.signedIn ? `/app/request?program=${p.id}` : "/login"} size="sm">Request a time</LinkButton> : undefined}
              />
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <Card>
            <dl className="space-y-4 text-sm">
              {[
                ["Price", programPrice(p)],
                ["Duration", `${p.duration_min} minutes`],
                ["Group size", p.capacity === 1 ? "Private" : `Up to ${p.capacity} players`],
                ["Level", p.skill_level || "All levels"],
                ["Coaches on court", String(p.coaches_count)],
                ["Location", p.location],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-ink/55">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {p.allow_requests && (
              <LinkButton href={meta.signedIn ? `/app/request?program=${p.id}` : "/login?next=/app/request"} className="mt-6 w-full" icon="whistle">
                Request a lesson time
              </LinkButton>
            )}
          </Card>
          <Notice>{meta.settings.cancellation_policy}</Notice>
        </aside>
      </div>
    </div>
  );
}

export function ScheduleView({ data, meta }: { data: D<typeof loadSchedule>; meta: FrameMeta }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:px-6 md:pt-14">
      <PageHeader eyebrow="Schedule" title="This week on court" subtitle="Live availability for every clinic and open lesson slot. Times are Pacific." />
      <ScheduleBoard data={data} signedIn={meta.signedIn} base="/schedule" />
    </div>
  );
}

export function AboutView({ meta }: { meta: FrameMeta }) {
  const s = meta.settings;
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6 md:pt-14">
      <PageHeader eyebrow="About" title={s.brand_name} subtitle={s.tagline} />
      <Card>
        <p className="text-[16.5px] leading-relaxed text-ink/75">{s.coach_bio}</p>
      </Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Where we play</h2>
          <p className="mt-2 text-sm text-ink/65">{s.default_location}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink/50">{s.club_disclaimer}</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Get in touch</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink/70">
            {s.contact_email && <li>{s.contact_email}</li>}
            {s.contact_phone && <li>{s.contact_phone}</li>}
          </ul>
          {s.community_url && (
            <a href={s.community_url} className={cx(btn("outline", "sm"), "mt-4")} target="_blank" rel="noreferrer">
              Join the community chat <Icon name="external" size={14} />
            </a>
          )}
        </Card>
      </div>
      <div className="mt-6">
        <h2 className="mb-2 font-semibold">Cancellation policy</h2>
        <p className="text-sm text-ink/65">{s.cancellation_policy}</p>
      </div>
    </div>
  );
}

// ───────────────────────── auth ─────────────────────────

export function LoginView({ meta }: { meta: FrameMeta }) {
  const nav = useNav();
  const toast = useToast();
  const [mode, setMode] = useState<"signin" | "signup" | "code" | "verify">(nav.search.mode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = nav.search.next;

  const submit = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string; redirect?: string }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    else {
      if (r.message) toast(r.message);
      if (r.redirect) nav.push(r.redirect);
      after?.();
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBar meta={meta} />
      <div className="grid flex-1 md:grid-cols-[1fr_1.05fr]">
        <div className="court-lines relative hidden overflow-hidden bg-brand p-12 text-paper md:flex md:flex-col">
          <A href="/">
            <Logo s={meta.settings} light />
          </A>
          <div className="mt-auto max-w-md">
            <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">Your tennis, all in one place.</h1>
            <p className="mt-4 text-paper/70">Book clinics and lessons, join waitlists and message your coach — no more scrolling through group chats.</p>
          </div>
          <div className="absolute -right-20 -bottom-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        </div>
        <div className="flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-sm">
            <A href="/" className="mb-10 inline-flex items-center gap-1 text-sm text-ink/55 hover:text-ink md:hidden">
              <Icon name="left" size={16} /> {meta.settings.brand_name}
            </A>
            {(mode === "signin" || mode === "signup") && (
              <form onSubmit={(e) => { e.preventDefault(); submit(() => nav.auth.password(email.trim(), password, mode, next)); }}>
                <h1 className="font-display text-3xl font-semibold tracking-tight">{mode === "signin" ? "Welcome back" : "Join the community"}</h1>
                <p className="mt-2 text-[15px] text-ink/60">{mode === "signin" ? "Sign in to book sessions and manage your schedule." : "Create your free account in under a minute."}</p>
                <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
                  {(["signin", "signup"] as const).map((m) => (
                    <button type="button" key={m} onClick={() => { setMode(m); setError(null); }} className={cx("rounded-lg py-2 text-sm font-semibold", mode === m ? "bg-card shadow-sm" : "text-ink/55")}>
                      {m === "signin" ? "Sign in" : "Create account"}
                    </button>
                  ))}
                </div>
                <Field label="Email or mobile number" className="mt-6">
                  <input className="input" type="text" autoFocus autoComplete="username" inputMode="email" placeholder="you@example.com or (619) 555-0123" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Password" className="mt-4" hint={mode === "signup" ? "At least 8 characters" : undefined}>
                  <input className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                {error && <p role="alert" className="mt-3 text-sm text-[#8E3326]">{error}</p>}
                <button className={cx(btn("primary", "lg"), "mt-5 w-full")} disabled={busy || !email.trim() || password.length < (mode === "signup" ? 8 : 1)}>
                  {busy && <Spinner />} {mode === "signin" ? "Sign in" : "Create account"}
                </button>
                <button type="button" onClick={() => { setMode("code"); setError(null); }} className="mt-4 w-full text-center text-sm font-medium text-brand hover:underline">
                  {mode === "signin" ? "Forgot your password? Email me a sign-in code" : "Prefer no password? Email me a code"}
                </button>
              </form>
            )}
            {mode === "code" && (
              <form onSubmit={(e) => { e.preventDefault(); submit(() => nav.auth.request(email.trim()), () => setMode("verify")); }}>
                <button type="button" onClick={() => setMode("signin")} className="mb-6 inline-flex items-center gap-1 text-sm text-ink/55 hover:text-ink">
                  <Icon name="left" size={16} /> Back
                </button>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in with a code</h1>
                <p className="mt-2 text-[15px] text-ink/60">We&apos;ll email you a one-time code. No password needed.</p>
                <Field label="Email" className="mt-6">
                  <input className="input" type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                {error && <p role="alert" className="mt-3 text-sm text-[#8E3326]">{error}</p>}
                <button className={cx(btn("primary", "lg"), "mt-5 w-full")} disabled={busy || !email.trim()}>
                  {busy && <Spinner />} Email me a code
                </button>
              </form>
            )}
            {mode === "verify" && (
              <form onSubmit={(e) => { e.preventDefault(); submit(() => nav.auth.verify(email.trim(), code.trim(), next)); }}>
                <button type="button" onClick={() => setMode("code")} className="mb-6 inline-flex items-center gap-1 text-sm text-ink/55 hover:text-ink">
                  <Icon name="left" size={16} /> Use a different email
                </button>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Check your inbox</h1>
                <p className="mt-2 text-[15px] text-ink/60">
                  We sent a code to <span className="font-medium text-ink">{email}</span>.
                </p>
                <Field label="Code" className="mt-6">
                  <input className="input text-center font-mono text-2xl tracking-[0.4em]" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                </Field>
                {nav.demo && (
                  <p className="mt-2 text-xs text-ink/50">
                    Demo mode: the code is <span className="font-mono font-semibold text-ink">123456</span>
                  </p>
                )}
                {error && <p role="alert" className="mt-3 text-sm text-[#8E3326]">{error}</p>}
                <button className={cx(btn("primary", "lg"), "mt-5 w-full")} disabled={busy || code.length < 6}>
                  {busy && <Spinner />} Verify & continue
                </button>
              </form>
            )}
            {meta.demo && nav.auth.demoAs && (mode === "signin" || mode === "signup") && (
              <div className="mt-10 border-t border-ink/10 pt-6">
                <p className="mb-3 text-xs font-semibold tracking-wider text-ink/45 uppercase">Or explore the demo as</p>
                <div className="grid gap-2">
                  {meta.demo.users.map((u) => (
                    <button key={u.id} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-card px-3 py-2.5 text-left hover:border-ink/25" onClick={() => nav.auth.demoAs!(u.id)}>
                      <Avatar name={u.full_name} size={32} />
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{u.full_name}</span>
                        <span className="block text-xs text-ink/55">{u.role === "admin" ? "Head coach · Admin portal" : u.role === "coach" ? "Coach portal" : "Player portal"}</span>
                      </span>
                      <Icon name="arrow" size={16} className="text-ink/40" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const SKILL_LEVELS = ["New to tennis", "Beginner", "Advanced beginner", "Intermediate", "Advanced", "Competitive / league"];
export const NTRP = ["", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5+"];

export function ProfileFields({ p, prefill }: { p?: Partial<import("@/core/types").Profile> | null; prefill?: { email: string; phone: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" className="sm:col-span-2">
        <input className="input" name="full_name" defaultValue={p?.full_name ?? ""} autoComplete="name" required />
      </Field>
      <Field label="Email">
        <input className="input" name="email" type="email" defaultValue={p?.email ?? prefill?.email ?? ""} autoComplete="email" />
      </Field>
      <Field label="Mobile number" hint="For SMS reminders (optional)">
        <input className="input" name="phone" type="tel" defaultValue={p?.phone ?? prefill?.phone ?? ""} autoComplete="tel" />
      </Field>
      <Field label="Playing level">
        <select className="input" name="skill_level" defaultValue={p?.skill_level ?? "Intermediate"}>
          {SKILL_LEVELS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="NTRP / UTR rating" hint="If you know it">
        <select className="input" name="ntrp" defaultValue={p?.ntrp ?? ""}>
          {NTRP.map((l) => (
            <option key={l} value={l}>
              {l || "Not sure"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Dominant hand">
        <select className="input" name="dominant_hand" defaultValue={p?.dominant_hand ?? "Right"}>
          <option>Right</option>
          <option>Left</option>
        </select>
      </Field>
      <Field label="Emergency contact" hint="Name and phone">
        <input className="input" name="emergency_contact" defaultValue={p?.emergency_contact ?? ""} />
      </Field>
      <Field label="What would you like to work on?" className="sm:col-span-2">
        <textarea className="input" name="goals" defaultValue={p?.goals ?? ""} placeholder="e.g. a more reliable second serve, getting comfortable at the net…" />
      </Field>
      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
        <Toggle name="notify_email" defaultChecked={p?.notify_email ?? true} label="Email notifications" hint="Confirmations, waitlist and changes" />
        <Toggle name="notify_sms" defaultChecked={p?.notify_sms ?? false} label="Text message reminders" hint="Requires a mobile number" />
      </div>
    </div>
  );
}

export function OnboardingView({ data, meta }: { data: D<typeof loadOnboarding>; meta: FrameMeta }) {
  return (
    <div className="min-h-screen px-4 py-10 md:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-[13px] font-bold text-accent">{meta.settings.logo_mark}</span>
          <span className="font-display font-semibold">{meta.settings.brand_name}</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome! Let&apos;s set up your profile.</h1>
        <p className="mt-2 text-ink/60">This helps your coach plan sessions at the right level. It takes about a minute.</p>
        <Card className="mt-8">
          <ActionForm action="completeOnboarding">
            <ProfileFields p={data.profile} prefill={data.prefill} />
            <Submit size="lg" className="mt-6 w-full">
              Finish & start booking
            </Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
