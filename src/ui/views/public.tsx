import { useState } from "react";
import { A, useNav, useToast } from "../nav";
import { Icon } from "../icons";
import { ActionForm, Avatar, btn, Card, cx, Field, Spinner, Submit } from "../kit";
import { DemoBar, Logo, type FrameMeta } from "../shell";
import type { loadWelcome } from "@/core/queries";
import type { Profile } from "@/core/types";

type D<T extends (...a: never[]) => unknown> = Awaited<ReturnType<T>>;

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
            <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight">Book your spot on court.</h1>
            <p className="mt-4 text-paper/70">See this week&apos;s Group Sessions and Performance Accelerators, book in a few taps, and join the waitlist when a session is full.</p>
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
                <p className="mt-2 text-[15px] text-ink/60">{mode === "signin" ? "Sign in to book community sessions." : "Create your account to book sessions."}</p>
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
                        <span className="block text-xs text-ink/55">{u.role === "admin" ? "Admin" : u.role === "coach" ? "Coach" : "Player"}</span>
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

export function ProfileFields({ p, prefill }: { p?: Partial<Profile> | null; prefill?: { email: string; phone: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" className="sm:col-span-2">
        <input className="input" name="full_name" defaultValue={p?.full_name ?? ""} autoComplete="name" required />
      </Field>
      <Field label="Email">
        <input className="input" name="email" type="email" defaultValue={p?.email ?? prefill?.email ?? ""} autoComplete="email" />
      </Field>
      <Field label="Mobile number">
        <input className="input" name="phone" type="tel" defaultValue={p?.phone ?? prefill?.phone ?? ""} autoComplete="tel" />
      </Field>
    </div>
  );
}

export function WelcomeView({ data, meta }: { data: D<typeof loadWelcome>; meta: FrameMeta }) {
  return (
    <div className="min-h-screen px-4 py-10 md:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-8">
          <Logo s={meta.settings} />
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome! What should we call you?</h1>
        <Card className="mt-6">
          <ActionForm action="completeOnboarding">
            <ProfileFields p={data.profile} prefill={data.prefill} />
            <Submit size="lg" className="mt-6 w-full">
              See the schedule
            </Submit>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
