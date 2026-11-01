import { useEffect, useState, type ReactNode } from "react";
import { A, useNav } from "./nav";
import { Icon, type IconName } from "./icons";
import { Avatar, cx } from "./kit";
import type { Area } from "@/core/routes";
import type { Role, Settings } from "@/core/types";

export interface FrameMeta {
  settings: Settings;
  user: { id: string; full_name: string; role: Role; email: string | null } | null;
  signedIn: boolean;
  demo: { users: { id: string; full_name: string; role: Role }[] } | null;
}

export function Logo({ s, light, compact }: { s: Settings; light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={cx("flex h-9 w-9 items-center justify-center rounded-[10px] text-[13px] font-bold tracking-tight", light ? "bg-accent text-ink" : "bg-brand text-accent")}>
        {s.logo_mark}
      </span>
      {!compact && <span className={cx("font-display text-[15px] leading-tight font-semibold tracking-tight", light ? "text-paper" : "text-ink")}>{s.brand_name}</span>}
    </span>
  );
}

// ───────────────────────── demo bar ─────────────────────────

export function DemoBar({ meta }: { meta: FrameMeta }) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  if (!meta.demo || !nav.auth.demoAs) return null;
  const roleLabel: Record<Role, string> = { member: "Player", coach: "Coach", admin: "Admin" };
  return (
    <div className="relative z-40 bg-ink text-paper">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 font-semibold text-accent">
          <Icon name="eye" size={14} /> Demo
        </span>
        <span className="text-paper/60">View as</span>
        <div className="flex flex-wrap gap-1">
          {meta.demo.users.map((u) => (
            <button
              key={u.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await nav.auth.demoAs!(u.id);
                setBusy(false);
              }}
              className={cx(
                "rounded-full px-2.5 py-1 font-medium transition-colors",
                meta.user?.id === u.id ? "bg-accent text-ink" : "bg-paper/10 text-paper hover:bg-paper/20",
              )}
            >
              {u.full_name.split(" ")[0]} · {roleLabel[u.role]}
            </button>
          ))}
        </div>
        {nav.auth.resetDemo && (
          <button
            className="ml-auto flex items-center gap-1 text-paper/60 hover:text-paper"
            onClick={async () => {
              setBusy(true);
              await nav.auth.resetDemo!();
              setBusy(false);
            }}
          >
            <Icon name="refresh" size={13} /> Reset data
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── player ─────────────────────────

const PLAYER_TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/my-sessions", label: "My Sessions", icon: "list" },
];

function UserMenu({ meta }: { meta: FrameMeta }) {
  const { auth, path } = useNav();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const user = meta.user!;
  const itemClass = "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-ink/5";
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center rounded-full" aria-label="Account menu" aria-expanded={open}>
        <Avatar name={user.full_name} size={36} />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="fade-in absolute right-0 z-50 mt-2 w-60 rounded-xl border border-ink/[0.08] bg-card p-1.5 shadow-xl">
            <div className="truncate border-b border-ink/[0.06] px-3 pt-1.5 pb-2.5 text-sm font-semibold">{user.full_name}</div>
            <div className="pt-1">
              <A href="/profile" className={itemClass}>
                <Icon name="user" size={16} /> Profile
              </A>
              {(user.role === "coach" || user.role === "admin") && (
                <A href="/coach" className={itemClass}>
                  <Icon name="whistle" size={16} /> Coach
                </A>
              )}
              {user.role === "admin" && (
                <A href="/admin" className={itemClass}>
                  <Icon name="settings" size={16} /> Admin
                </A>
              )}
              <button onClick={() => auth.signOut()} className={cx(itemClass, "w-full")}>
                <Icon name="logout" size={16} /> Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function PlayerShell({ meta, children }: { meta: FrameMeta; children: ReactNode }) {
  const s = meta.settings;
  const { path } = useNav();
  const active = (href: string) => path === href || (href === "/schedule" && path === "/");
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBar meta={meta} />
      <header className="sticky top-0 z-30 border-b border-ink/[0.06] bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4">
          <A href="/schedule" aria-label={`${s.brand_name} schedule`}>
            <Logo s={s} />
          </A>
          <div className="flex items-center gap-1">
            <nav className="mr-2 hidden items-center gap-1 sm:flex" aria-label="Primary">
              {PLAYER_TABS.map((t) => (
                <A key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined} className={cx("rounded-lg px-3 py-2 text-[14.5px] font-medium transition-colors", active(t.href) ? "bg-sage/70 text-brand" : "text-ink/60 hover:text-ink")}>
                  {t.label}
                </A>
              ))}
            </nav>
            {meta.user ? (
              <UserMenu meta={meta} />
            ) : (
              <A href="/login" className="btn btn-primary btn-sm">
                Sign in
              </A>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-10 md:pt-9">
        <div className="fade-in" key={path}>
          {children}
        </div>
      </main>
      <footer className="border-t border-ink/[0.06] pb-20 sm:pb-0">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-6 text-xs leading-relaxed text-ink/50">
          {s.community_url && (
            <a href={s.community_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
              <Icon name="message" size={15} /> Join the community on WhatsApp
            </a>
          )}
          <p>
            © {new Date().getFullYear()} {s.brand_name}. {s.club_disclaimer}
          </p>
        </div>
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/[0.08] bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="Primary">
        <ul className="grid grid-cols-2">
          {PLAYER_TABS.map((t) => (
            <li key={t.href}>
              <A href={t.href} aria-current={active(t.href) ? "page" : undefined} className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active(t.href) ? "text-brand" : "text-ink/50")}>
                <Icon name={t.icon} size={21} />
                {t.label}
              </A>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

// ───────────────────────── coach & admin ─────────────────────────

type NavItem = { href: string; label: string; icon: IconName };

function navFor(area: Area): NavItem[] {
  if (area === "coach") return [{ href: "/coach", label: "My Schedule", icon: "calendar" }];
  return [
    { href: "/admin", label: "Community Schedule", icon: "calendar" },
    { href: "/admin/coaches", label: "Coaches", icon: "whistle" },
    { href: "/admin/members", label: "Members", icon: "users" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
  ];
}

const SHORT_LABEL: Record<string, string> = { "Community Schedule": "Schedule" };

const PORTALS: { area: Area; label: string; href: string; roles: Role[] }[] = [
  { area: "member", label: "Player", href: "/schedule", roles: ["member", "coach", "admin"] },
  { area: "coach", label: "Coach", href: "/coach", roles: ["coach", "admin"] },
  { area: "admin", label: "Admin", href: "/admin", roles: ["admin"] },
];

const THEME: Record<"coach" | "admin", { side: string; muted: string; active: string; hover: string; label: string; light: boolean }> = {
  coach: { side: "bg-sage/80 border-r border-ink/[0.07]", muted: "text-ink/55", active: "bg-card text-brand shadow-sm", hover: "hover:bg-card/60", label: "Coach", light: false },
  admin: { side: "bg-brand", muted: "text-paper/55", active: "bg-paper/12 text-paper", hover: "hover:bg-paper/[0.07]", label: "Admin", light: true },
};

function isActive(path: string, href: string, all: NavItem[]) {
  const match = all.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.href === href;
}

export function PortalShell({ area, meta, children }: { area: "coach" | "admin"; meta: FrameMeta; children: ReactNode }) {
  const { path, auth } = useNav();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const items = navFor(area);
  const t = THEME[area];
  const s = meta.settings;
  const user = meta.user!;
  const portals = PORTALS.filter((p) => p.roles.includes(user.role));

  // Plain functions, not components: a component defined here would be rebuilt on every
  // render, and a link rebuilt between press and release loses the click.
  const switcher = (dark: boolean) => (
    <div className={cx("grid gap-1 rounded-xl p-1", dark ? "bg-paper/10" : "bg-ink/[0.06]")} style={{ gridTemplateColumns: `repeat(${portals.length}, 1fr)` }} role="tablist" aria-label="Switch view">
      {portals.map((p) => (
        <A
          key={p.area}
          href={p.href}
          aria-current={p.area === area ? "page" : undefined}
          className={cx(
            "rounded-lg px-2 py-1.5 text-center text-[12.5px] font-semibold transition-colors",
            p.area === area ? (dark ? "bg-accent text-ink" : "bg-card text-ink shadow-sm") : dark ? "text-paper/70 hover:text-paper" : "text-ink/55 hover:text-ink",
          )}
        >
          {p.label}
        </A>
      ))}
    </div>
  );

  const navList = (onDark: boolean) => (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const active = isActive(path, i.href, items);
        return (
          <li key={i.href}>
            <A
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition-colors",
                active ? t.active : cx(onDark ? "text-paper/75 hover:bg-paper/[0.07] hover:text-paper" : "text-ink/70 hover:text-ink", !onDark && t.hover),
              )}
            >
              <Icon name={i.icon} size={18} />
              <span className="flex-1">{i.label}</span>
            </A>
          </li>
        );
      })}
    </ul>
  );

  const userBlock = (dark: boolean) => (
    <div className={cx("flex items-center gap-3 rounded-xl p-2", dark ? "text-paper" : "text-ink")}>
      <Avatar name={user.full_name} size={34} />
      <A href="/profile" className="min-w-0 flex-1 hover:underline">
        <div className="truncate text-sm font-semibold">{user.full_name}</div>
        <div className={cx("truncate text-xs capitalize", dark ? "text-paper/55" : "text-ink/50")}>{user.role}</div>
      </A>
      <button onClick={() => auth.signOut()} className={cx("rounded-lg p-2", dark ? "text-paper/60 hover:bg-paper/10 hover:text-paper" : "text-ink/50 hover:bg-ink/5 hover:text-ink")} aria-label="Sign out" title="Sign out">
        <Icon name="logout" size={17} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      <DemoBar meta={meta} />
      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className={cx("sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-5 overflow-y-auto px-4 py-5 md:flex", t.side)}>
          <div className="flex items-center justify-between px-1">
            <A href={area === "coach" ? "/coach" : "/admin"} aria-label={t.label}>
              <Logo s={s} light={t.light} />
            </A>
          </div>
          {switcher(t.light)}
          <nav className="flex-1">{navList(t.light)}</nav>
          <div className="space-y-2">
            {area === "admin" && (
              <A href="/admin/sessions/new" className="btn btn-accent w-full">
                <Icon name="plus" size={17} /> New session
              </A>
            )}
            {userBlock(t.light)}
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className={cx("sticky top-0 z-30 flex h-14 items-center justify-between px-4 md:hidden", area === "admin" ? "bg-brand text-paper" : "border-b border-ink/[0.07] bg-paper/90 backdrop-blur")}>
          <A href={area === "coach" ? "/coach" : "/admin"}>
            <Logo s={s} light={area === "admin"} compact />
          </A>
          <span className={cx("text-[11px] font-semibold tracking-[0.12em] uppercase", area === "admin" ? "text-paper/70" : "text-ink/50")}>{t.label}</span>
          <button onClick={() => setOpen(true)} className="-mr-2 rounded-lg p-2" aria-label="Open menu">
            <Icon name="menu" />
          </button>
        </div>

        {open && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
            <button className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-label="Close menu" />
            <div className={cx("fade-in absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col gap-4 overflow-y-auto p-4", area === "admin" ? "bg-brand" : "bg-paper")}>
              <div className="flex items-center justify-between">
                <Logo s={s} light={area === "admin"} />
                <button onClick={() => setOpen(false)} className={cx("rounded-lg p-2", area === "admin" && "text-paper")} aria-label="Close menu">
                  <Icon name="x" />
                </button>
              </div>
              {switcher(area === "admin")}
              {navList(area === "admin")}
              <div className="mt-auto">{userBlock(area === "admin")}</div>
            </div>
          </div>
        )}

        <main className={cx("min-w-0 flex-1 md:pb-12", items.length > 1 ? "pb-28" : "pb-12")}>
          <div className="mx-auto max-w-[1180px] px-4 pt-6 md:px-8 md:pt-9 fade-in" key={path}>
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      {items.length > 1 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/[0.08] bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
            {items.map((i) => {
              const active = isActive(path, i.href, items);
              return (
                <li key={i.href}>
                  <A href={i.href} aria-current={active ? "page" : undefined} className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-ink/50")}>
                    <Icon name={i.icon} size={21} />
                    {SHORT_LABEL[i.label] ?? i.label}
                  </A>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
