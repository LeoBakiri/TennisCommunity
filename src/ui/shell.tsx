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
  counts: { memberUnread: number; staffUnread: number; requests: number };
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

// ───────────────────────── public ─────────────────────────

export function PublicShell({ meta, children }: { meta: FrameMeta; children: ReactNode }) {
  const s = meta.settings;
  const { path } = useNav();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const links = [
    { href: "/programs", label: "Programs" },
    { href: "/schedule", label: "Schedule" },
    { href: "/about", label: "About" },
  ];
  const portal = meta.user ? (meta.user.role === "admin" ? "/admin" : meta.user.role === "coach" ? "/coach" : "/app") : null;
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBar meta={meta} />
      <header className="sticky top-0 z-30 border-b border-ink/[0.06] bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <A href="/" aria-label={`${s.brand_name} home`}>
            <Logo s={s} />
          </A>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <A key={l.href} href={l.href} className={cx("rounded-lg px-3 py-2 text-[14.5px] font-medium transition-colors", path.startsWith(l.href) ? "text-ink" : "text-ink/60 hover:text-ink")}>
                {l.label}
              </A>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {portal ? (
              <A href={portal} className="btn btn-primary btn-sm">
                My portal <Icon name="arrow" size={15} />
              </A>
            ) : (
              <>
                <A href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                  Sign in
                </A>
                <A href="/login" className="btn btn-primary btn-sm">
                  Join & book
                </A>
              </>
            )}
            <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              <Icon name={open ? "x" : "menu"} />
            </button>
          </div>
        </div>
        {open && (
          <nav className="fade-in border-t border-ink/[0.06] px-4 py-3 md:hidden">
            {links.map((l) => (
              <A key={l.href} href={l.href} className="block rounded-lg px-3 py-3 text-[15px] font-medium hover:bg-ink/5">
                {l.label}
              </A>
            ))}
            {!portal && (
              <A href="/login" className="block rounded-lg px-3 py-3 text-[15px] font-medium hover:bg-ink/5">
                Sign in
              </A>
            )}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-20 bg-brand text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
          <div>
            <Logo s={s} light />
            <p className="mt-4 max-w-sm text-sm text-paper/70">{s.tagline}</p>
          </div>
          <div className="text-sm">
            <div className="mb-3 font-semibold text-paper">Explore</div>
            <ul className="space-y-2 text-paper/70">
              {links.map((l) => (
                <li key={l.href}>
                  <A href={l.href} className="hover:text-paper">
                    {l.label}
                  </A>
                </li>
              ))}
              <li>
                <A href="/login" className="hover:text-paper">
                  Member sign in
                </A>
              </li>
            </ul>
          </div>
          <div className="text-sm">
            <div className="mb-3 font-semibold text-paper">Contact</div>
            <ul className="space-y-2 text-paper/70">
              {s.contact_email && (
                <li className="flex items-center gap-2">
                  <Icon name="mail" size={15} /> <a href={`mailto:${s.contact_email}`} className="hover:text-paper">{s.contact_email}</a>
                </li>
              )}
              {s.contact_phone && (
                <li className="flex items-center gap-2">
                  <Icon name="phone" size={15} /> {s.contact_phone}
                </li>
              )}
              <li className="flex items-center gap-2">
                <Icon name="pin" size={15} /> {s.default_location}
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-paper/10">
          <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-paper/50 md:px-6">
            © {new Date().getFullYear()} {s.brand_name}. {s.club_disclaimer}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ───────────────────────── portals ─────────────────────────

type NavItem = { href: string; label: string; icon: IconName; badge?: number; mobile?: boolean };

function navFor(area: Area, meta: FrameMeta): NavItem[] {
  const c = meta.counts;
  if (area === "member")
    return [
      { href: "/app", label: "Home", icon: "home", mobile: true },
      { href: "/app/book", label: "Book a session", icon: "calendar", mobile: true },
      { href: "/app/request", label: "Request a lesson", icon: "whistle" },
      { href: "/app/bookings", label: "My bookings", icon: "list", mobile: true },
      { href: "/app/messages", label: "Messages", icon: "message", badge: c.memberUnread, mobile: true },
      { href: "/app/profile", label: "Profile", icon: "user", mobile: true },
    ];
  if (area === "coach")
    return [
      { href: "/coach", label: "Today", icon: "sun", mobile: true },
      { href: "/coach/calendar", label: "My calendar", icon: "calendar", mobile: true },
      { href: "/coach/players", label: "My players", icon: "users", mobile: true },
      { href: "/coach/messages", label: "Messages", icon: "message", badge: c.staffUnread, mobile: true },
    ];
  return [
    { href: "/admin", label: "Overview", icon: "grid", mobile: true },
    { href: "/admin/calendar", label: "Calendar", icon: "calendar", mobile: true },
    { href: "/admin/sessions", label: "Sessions", icon: "list" },
    { href: "/admin/schedule", label: "Weekly schedule", icon: "repeat" },
    { href: "/admin/programs", label: "Programs", icon: "ball" },
    { href: "/admin/requests", label: "Requests", icon: "inbox", badge: c.requests, mobile: true },
    { href: "/admin/members", label: "Community", icon: "users", mobile: true },
    { href: "/admin/messages", label: "Messages", icon: "message", badge: c.staffUnread },
    { href: "/admin/announcements", label: "Announcements", icon: "megaphone" },
    { href: "/admin/notifications", label: "Notification log", icon: "bell" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
  ];
}

const PORTALS: { area: Area; label: string; href: string; roles: Role[] }[] = [
  { area: "member", label: "Player", href: "/app", roles: ["member", "coach", "admin"] },
  { area: "coach", label: "Coach", href: "/coach", roles: ["coach", "admin"] },
  { area: "admin", label: "Admin", href: "/admin", roles: ["admin"] },
];

const THEME: Record<"member" | "coach" | "admin", { side: string; text: string; muted: string; active: string; hover: string; label: string; light: boolean }> = {
  member: { side: "bg-card border-r border-ink/[0.07]", text: "text-ink", muted: "text-ink/55", active: "bg-sage/70 text-brand", hover: "hover:bg-ink/[0.04]", label: "Player portal", light: false },
  coach: { side: "bg-sage/80 border-r border-ink/[0.07]", text: "text-ink", muted: "text-ink/55", active: "bg-card text-brand shadow-sm", hover: "hover:bg-card/60", label: "Coach portal", light: false },
  admin: { side: "bg-brand", text: "text-paper", muted: "text-paper/55", active: "bg-paper/12 text-paper", hover: "hover:bg-paper/[0.07]", label: "Admin", light: true },
};

function isActive(path: string, href: string, all: NavItem[]) {
  const match = all.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.href === href;
}

export function PortalShell({ area, meta, children }: { area: "member" | "coach" | "admin"; meta: FrameMeta; children: ReactNode }) {
  const { path, auth } = useNav();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const items = navFor(area, meta);
  const t = THEME[area];
  const s = meta.settings;
  const user = meta.user!;
  const portals = PORTALS.filter((p) => p.roles.includes(user.role));
  const mobileItems = items.filter((i) => i.mobile).slice(0, 5);

  const Switcher = ({ dark }: { dark: boolean }) =>
    portals.length > 1 ? (
      <div className={cx("grid gap-1 rounded-xl p-1", dark ? "bg-paper/10" : "bg-ink/[0.06]")} style={{ gridTemplateColumns: `repeat(${portals.length}, 1fr)` }} role="tablist" aria-label="Switch portal">
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
    ) : null;

  const NavList = ({ onDark }: { onDark: boolean }) => (
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
                active ? (onDark ? THEME.admin.active : t.active) : cx(onDark ? "text-paper/75 hover:bg-paper/[0.07] hover:text-paper" : "text-ink/70 hover:text-ink", !onDark && t.hover),
              )}
            >
              <Icon name={i.icon} size={18} />
              <span className="flex-1">{i.label}</span>
              {!!i.badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-ink tabular-nums">{i.badge}</span>}
            </A>
          </li>
        );
      })}
    </ul>
  );

  const UserBlock = ({ dark }: { dark: boolean }) => (
    <div className={cx("flex items-center gap-3 rounded-xl p-2", dark ? "text-paper" : "text-ink")}>
      <Avatar name={user.full_name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user.full_name}</div>
        <div className={cx("truncate text-xs capitalize", dark ? "text-paper/55" : "text-ink/50")}>{user.role === "member" ? "Player" : user.role}</div>
      </div>
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
            <A href="/" aria-label="Public site">
              <Logo s={s} light={t.light} />
            </A>
          </div>
          <div className={cx("px-2 text-[11px] font-semibold tracking-[0.12em] uppercase", t.muted)}>{t.label}</div>
          <Switcher dark={t.light} />
          <nav className="flex-1">
            <NavList onDark={t.light} />
          </nav>
          <div className="space-y-2">
            {area === "member" && (
              <A href="/app/book" className="btn btn-accent w-full">
                <Icon name="plus" size={17} /> Book a session
              </A>
            )}
            {area === "admin" && (
              <A href="/admin/sessions/new" className="btn btn-accent w-full">
                <Icon name="plus" size={17} /> New session
              </A>
            )}
            <UserBlock dark={t.light} />
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className={cx("sticky top-0 z-30 flex h-14 items-center justify-between px-4 md:hidden", area === "admin" ? "bg-brand text-paper" : "border-b border-ink/[0.07] bg-paper/90 backdrop-blur")}>
          <A href={area === "member" ? "/app" : area === "coach" ? "/coach" : "/admin"}>
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
              <Switcher dark={area === "admin"} />
              <NavList onDark={area === "admin"} />
              <div className="mt-auto">
                <A href="/" className={cx("mb-2 flex items-center gap-2 px-3 py-2 text-sm", area === "admin" ? "text-paper/70" : "text-ink/60")}>
                  <Icon name="external" size={15} /> Public website
                </A>
                <UserBlock dark={area === "admin"} />
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 pb-28 md:pb-12">
          <div className="mx-auto max-w-[1180px] px-4 pt-6 md:px-8 md:pt-9 fade-in" key={path}>
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/[0.08] bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, 1fr)` }}>
          {mobileItems.map((i) => {
            const active = isActive(path, i.href, items);
            return (
              <li key={i.href}>
                <A href={i.href} aria-current={active ? "page" : undefined} className={cx("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-ink/50")}>
                  <Icon name={i.icon} size={21} />
                  {i.label.replace("Book a session", "Book").replace("My bookings", "Bookings").replace("My calendar", "Calendar").replace("My players", "Players")}
                  {!!i.badge && <span className="absolute top-1.5 left-[55%] h-2 w-2 rounded-full bg-[#B9574A]" />}
                </A>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
