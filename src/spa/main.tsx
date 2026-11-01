import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryStore, type Store } from "@/core/store";
import { demoSeed, DEMO_IDS } from "@/core/seed";
import { getSettings, isAdmin, isStaff, runAction, type Ctx, type OutgoingMessage } from "@/core/services";
import { guard, homeFor, matchRoute } from "@/core/routes";
import { Forbidden, NotFound } from "@/core/queries";
import type { ActionResult, Actor, DB, Profile, Settings } from "@/core/types";
import { hexToRgbTriplet, isEmail, normalizePhone, nowIso, uid } from "@/core/util";
import { NavProvider, ToastHost, type LinkProps, type NavApi } from "@/ui/nav";
import { PortalShell, PublicShell, type FrameMeta } from "@/ui/shell";
import { Empty, LinkButton } from "@/ui/kit";
import { VIEWS } from "./registry";
import { SupabaseAuth, SupabaseStore, type SupaConfig } from "./supabase";

declare global {
  interface Window {
    LTC_CONFIG?: Partial<SupaConfig>;
  }
}

// ───────────────────────── backend selection ─────────────────────────

const cfg = window.LTC_CONFIG ?? {};
const LIVE = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
const supaAuth = LIVE ? new SupabaseAuth(cfg as SupaConfig) : null;

const DEMO_KEY = "ltc.demo.db.v1";
const DEMO_USER = "ltc.demo.user";
function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable (private mode) — demo still works in memory */
  }
}

const store: Store & { reset?: () => Promise<void> } = LIVE
  ? new SupabaseStore(cfg as SupaConfig, supaAuth!)
  : new MemoryStore(
      {
        load: async () => {
          const raw = safeGet(DEMO_KEY);
          if (!raw) return null;
          try {
            return JSON.parse(raw) as DB;
          } catch {
            return null;
          }
        },
        save: async (db) => safeSet(DEMO_KEY, JSON.stringify(db)),
      },
      () => demoSeed(new Date()),
    );

async function currentActor(): Promise<Actor> {
  if (LIVE) {
    const s = supaAuth!.current();
    if (!s) return { auth_id: null, identifier: null, user: null };
    const token = await supaAuth!.token();
    if (!token) return { auth_id: null, identifier: null, user: null };
    const user = await store.get("profiles", s.user.id).catch(() => null);
    return { auth_id: s.user.id, identifier: displayIdentifier(s.user.email, s.user.phone), user };
  }
  const raw = safeGet(DEMO_USER);
  if (!raw) return { auth_id: null, identifier: null, user: null };
  const { id, identifier } = JSON.parse(raw) as { id: string; identifier: string };
  return { auth_id: id, identifier, user: await store.get("profiles", id) };
}

const notify = async (m: OutgoingMessage) => {
  const recipient = m.to.email ?? m.to.phone ?? "";
  if (!recipient) return;
  await store.insert("notifications", {
    id: uid(),
    user_id: m.to.id,
    channel: m.to.email ? "email" : "sms",
    recipient,
    subject: m.subject,
    body: m.body,
    status: "logged",
    created_at: nowIso(),
  });
};

// Players may sign up with a mobile number. The login system needs an email,
// so phone numbers map to a private placeholder address that is never emailed.
const PHONE_DOMAIN = "phone.leotenniscommunity.app";
function loginEmail(identifier: string): { email: string; phone: string | null } | null {
  const v = identifier.trim().toLowerCase();
  if (isEmail(v)) return { email: v, phone: null };
  const phone = normalizePhone(v);
  return phone ? { email: `${phone.replace(/\D/g, "")}@${PHONE_DOMAIN}`, phone } : null;
}
function displayIdentifier(email?: string | null, phone?: string | null) {
  if (email && email.endsWith(`@${PHONE_DOMAIN}`)) return `+${email.split("@")[0]}`;
  return email ?? phone ?? null;
}

// ───────────────────────── routing ─────────────────────────

function readLocation() {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = h.split("?");
  const search: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => (search[k] = v));
  return { path: path || "/", search, full: h };
}
const go = (href: string, replace = false) => {
  const target = `#${href}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

function Link({ href, className, children, title, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={`#${href}`}
      className={className}
      title={title}
      aria-current={rest["aria-current"]}
      aria-label={rest["aria-label"]}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

function applyBrand(s: Settings) {
  const r = document.documentElement.style;
  r.setProperty("--brand", s.color_primary);
  r.setProperty("--accent", s.color_accent);
  r.setProperty("--paper", s.color_background);
  r.setProperty("--ink", s.color_ink);
  r.setProperty("--sage", s.color_sage);
  void hexToRgbTriplet;
}

async function frameMeta(actor: Actor): Promise<FrameMeta> {
  const settings = await getSettings(store);
  applyBrand(settings);
  const u = actor.user;
  const counts = { memberUnread: 0, staffUnread: 0, requests: 0 };
  if (u) {
    const [mine, staffUnread, reqs, pend] = await Promise.all([
      store.list("messages", { eq: { member_id: u.id, read_by_member: false } }).catch(() => []),
      isStaff(u) ? store.list("messages", { eq: { read_by_staff: false } }).catch(() => []) : Promise.resolve([]),
      isAdmin(u) ? store.list("lesson_requests", { eq: { status: "pending" } }).catch(() => []) : Promise.resolve([]),
      isAdmin(u) ? store.list("bookings", { eq: { status: "pending" } }).catch(() => []) : Promise.resolve([]),
    ]);
    counts.memberUnread = mine.length;
    counts.staffUnread = staffUnread.length;
    counts.requests = reqs.length + pend.length;
  }
  let demo: FrameMeta["demo"] = null;
  if (!LIVE) {
    const ids = [DEMO_IDS.sam, DEMO_IDS.maya, DEMO_IDS.leo];
    const users = (await Promise.all(ids.map((id) => store.get("profiles", id)))).filter(Boolean) as Profile[];
    demo = { users: users.map((p) => ({ id: p.id, full_name: p.full_name, role: p.role })) };
  }
  return {
    settings,
    user: u ? { id: u.id, full_name: u.full_name, role: u.role, email: u.email } : null,
    signedIn: !!u?.onboarded,
    counts,
    demo,
  };
}

// ───────────────────────── app ─────────────────────────

type Screen =
  | { kind: "loading" }
  | { kind: "view"; routeId: string; area: string; data: unknown; meta: FrameMeta; title: string }
  | { kind: "notfound" | "forbidden" | "error"; meta: FrameMeta | null; message?: string };

function App() {
  const [loc, setLoc] = useState(readLocation);
  const [version, setVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const actorRef = useRef<Actor>({ auth_id: null, identifier: null, user: null });
  const seq = useRef(0);

  useEffect(() => {
    const on = () => setLoc(readLocation());
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);

  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    (async () => {
      let meta: FrameMeta | null = null;
      try {
        const actor = await currentActor();
        actorRef.current = actor;
        const match = matchRoute(loc.path);
        if (!match) {
          meta = await frameMeta(actor);
          if (my === seq.current) setScreen({ kind: "notfound", meta });
          return;
        }
        const redirect = guard(match.route.area, actor, loc.full);
        if (redirect) {
          go(redirect, true);
          return;
        }
        const [data, m] = await Promise.all([
          match.route.load ? match.route.load({ store, actor, params: match.params, search: loc.search, now: new Date() }) : Promise.resolve(null),
          frameMeta(actor),
        ]);
        meta = m;
        if (my !== seq.current) return;
        document.title = match.route.id === "home" ? meta.settings.brand_name : `${match.route.title} · ${meta.settings.brand_name}`;
        setScreen({ kind: "view", routeId: match.route.id, area: match.route.area, data, meta, title: match.route.title });
      } catch (e) {
        if (my !== seq.current) return;
        meta ??= await frameMeta(actorRef.current).catch(() => null);
        if (e instanceof NotFound) setScreen({ kind: "notfound", meta });
        else if (e instanceof Forbidden) setScreen({ kind: "forbidden", meta });
        else {
          console.error(e);
          setScreen({ kind: "error", meta, message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        if (my === seq.current) setBusy(false);
      }
    })();
  }, [loc, version]);

  // Scroll to top on navigation (not on refresh after an action).
  const lastPath = useRef(loc.path);
  useEffect(() => {
    if (lastPath.current !== loc.path) window.scrollTo({ top: 0 });
    lastPath.current = loc.path;
  }, [loc.path]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const afterLogin = useCallback(async (next?: string): Promise<ActionResult> => {
    const actor = await currentActor();
    actorRef.current = actor;
    if (!actor.user?.onboarded) return { ok: true, redirect: `/onboarding${next ? `?next=${encodeURIComponent(next)}` : ""}` };
    return { ok: true, redirect: next && next.startsWith("/") ? next : homeFor(actor) };
  }, []);

  const nav: NavApi = useMemo(
    () => ({
      path: loc.path,
      search: loc.search,
      Link,
      push: (href: string) => {
        if (`${href}` === loc.full) refresh();
        else go(href);
      },
      act: async (name, input) => {
        const ctx: Ctx = { store, actor: await currentActor(), now: new Date(), notify };
        const r = await runAction(ctx, name, input);
        if (r.ok && !r.redirect) refresh();
        if (r.ok && r.redirect && name === "completeOnboarding") {
          const next = loc.search.next;
          return { ...r, redirect: next && next.startsWith("/") && !next.startsWith("/onboarding") ? next : homeFor(await currentActor()) };
        }
        return r;
      },
      auth: {
        password: async (identifier, password, mode, next) => {
          const id = loginEmail(identifier);
          if (!id) return { ok: false, error: "Enter a valid email address or mobile number." };
          if (LIVE) {
            try {
              if (mode === "signup") await supaAuth!.signUp(id.email, password);
              else await supaAuth!.signInWithPassword(id.email, password);
              await store.rpc?.("claim_profile", {}).catch(() => undefined);
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Sign-in failed";
              return {
                ok: false,
                error: /invalid login/i.test(msg)
                  ? "That email/number or password is incorrect."
                  : /already registered|already exists/i.test(msg)
                    ? "There's already an account with that — sign in instead."
                    : /password/i.test(msg) && /characters|weak|short/i.test(msg)
                      ? "Please choose a longer password (at least 8 characters)."
                      : msg,
              };
            }
            return afterLogin(next);
          }
          return demoLogin(id.phone ?? id.email, next);
        },
        request: async (identifier) => {
          if (!isEmail(identifier)) return { ok: false, error: "Please enter a valid email address." };
          if (LIVE) {
            try {
              await supaAuth!.sendCode(identifier);
            } catch (e) {
              return { ok: false, error: e instanceof Error ? e.message : "Couldn't send the code." };
            }
            return { ok: true, message: "Code sent — check your inbox." };
          }
          return { ok: true, message: "Demo mode — use code 123456." };
        },
        verify: async (identifier, code, next) => {
          if (LIVE) {
            try {
              await supaAuth!.verifyCode(identifier, code);
              await store.rpc?.("claim_profile", {}).catch(() => undefined);
            } catch {
              return { ok: false, error: "That code didn't work. Check it, or request a new one." };
            }
            return afterLogin(next);
          }
          if (code !== "123456") return { ok: false, error: "That code didn't work. In demo mode the code is 123456." };
          return demoLogin(identifier, next);
        },
        signOut: async () => {
          if (LIVE) await supaAuth!.signOut();
          else safeSet(DEMO_USER, null);
          go("/");
          refresh();
        },
        demoAs: LIVE
          ? undefined
          : async (id: string) => {
              const p = await store.get("profiles", id);
              if (!p) return;
              safeSet(DEMO_USER, JSON.stringify({ id, identifier: p.email ?? p.phone ?? "" }));
              const actor: Actor = { auth_id: id, identifier: p.email, user: p };
              const target = homeFor(actor);
              if (readLocation().path === target) refresh();
              else go(target);
            },
        resetDemo: LIVE
          ? undefined
          : async () => {
              await (store as MemoryStore).reset();
              refresh();
            },
      },
      demo: !LIVE,
    }),
    [loc, refresh, afterLogin],
  );

  async function demoLogin(identifier: string, next?: string): Promise<ActionResult> {
    const all = await store.list("profiles");
    const id = identifier.toLowerCase();
    const existing = all.find((p) => p.email === id || p.phone === id);
    safeSet(DEMO_USER, JSON.stringify({ id: existing?.id ?? uid(), identifier: id }));
    return afterLogin(next);
  }

  return (
    <NavProvider value={nav}>
      <ToastHost>
        {busy && <div className="fixed inset-x-0 top-0 z-[70] h-0.5 animate-pulse bg-accent" aria-hidden="true" />}
        <Screen screen={screen} />
      </ToastHost>
    </NavProvider>
  );
}

function Frame({ area, meta, children }: { area: string; meta: FrameMeta; children: ReactNode }) {
  if ((area === "member" || area === "coach" || area === "admin") && meta.user) {
    return (
      <PortalShell area={area} meta={meta}>
        {children}
      </PortalShell>
    );
  }
  if (area === "auth") return <>{children}</>;
  return <PublicShell meta={meta}>{children}</PublicShell>;
}

function Screen({ screen }: { screen: Screen }) {
  if (screen.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink/50">
          <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand border-r-transparent" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }
  if (screen.kind !== "view") {
    const body =
      screen.kind === "notfound" ? (
        <Empty icon="search" title="Page not found" body="That page doesn't exist or isn't available to you." action={<LinkButton href="/">Go home</LinkButton>} />
      ) : screen.kind === "forbidden" ? (
        <Empty icon="shield" title="Not available" body="You don't have access to this page." action={<LinkButton href="/">Go home</LinkButton>} />
      ) : (
        <Empty icon="flag" title="Something went wrong" body={screen.message ?? "Please try again."} action={<LinkButton href="/">Go home</LinkButton>} />
      );
    if (!screen.meta) return <div className="mx-auto max-w-lg p-10">{body}</div>;
    return (
      <PublicShell meta={screen.meta}>
        <div className="mx-auto max-w-lg px-4 py-16">{body}</div>
      </PublicShell>
    );
  }
  const View = VIEWS[screen.routeId];
  return (
    <Frame area={screen.area} meta={screen.meta}>
      <View data={screen.data} meta={screen.meta} />
    </Frame>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
