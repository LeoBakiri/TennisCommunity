// Design-system primitives shared by the public site and every portal.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { A, useAction } from "./nav";
import { Icon, TennisBall, type IconName } from "./icons";
import type { ActionResult, BookingStatus } from "@/core/types";
import { initials } from "@/core/util";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ───────────────────────── layout ─────────────────────────

export function PageHeader({ title, subtitle, eyebrow, actions, back }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <A href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
            <Icon name="left" size={16} /> {back.label}
          </A>
        )}
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-ink md:text-[2.1rem]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-ink/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The green court-lines banner that opens the player, coach and admin home screens. */
export function HeroPanel({ eyebrow, children, className }: { eyebrow: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("court-lines relative mb-6 overflow-hidden rounded-2xl bg-brand p-6 text-paper shadow-sm md:p-8", className)}>
      <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
      <TennisBall size={84} className="ball-bounce absolute top-6 right-6 hidden opacity-90 sm:block" />
      <div className="relative">
        <div className="text-[13px] font-semibold tracking-wider text-accent uppercase">{eyebrow}</div>
        {children}
      </div>
    </section>
  );
}

/** A number on the hero banner. */
export function HeroStat({ value, label, children }: { value: ReactNode; label: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-paper/[0.08] px-3 py-2.5 ring-1 ring-paper/10">
      <dt className="sr-only">{label}</dt>
      <dd className="font-display text-2xl leading-none font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-[12px] text-paper/65">{label}</dd>
      {children}
    </div>
  );
}

export function Card({ children, className, pad = true, as: Tag = "div" }: { children: ReactNode; className?: string; pad?: boolean; as?: "div" | "section" | "article" }) {
  return <Tag className={cx("card", pad && "p-5 md:p-6", className)}>{children}</Tag>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon = "ball", title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink/15 px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sage/70 text-brand">
        <Icon name={icon} size={20} />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink/60">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; tone?: "accent" }) {
  return (
    <div className={cx("card p-4 md:p-5", tone === "accent" && "bg-brand text-paper")}>
      <div className={cx("flex items-center gap-2 text-[13px]", tone === "accent" ? "text-paper/70" : "text-ink/55")}>
        {icon && <Icon name={icon} size={15} />}
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tracking-tight tabular-nums md:text-[1.7rem]">{value}</div>
      {hint && <div className={cx("mt-1 text-xs", tone === "accent" ? "text-paper/60" : "text-ink/50")}>{hint}</div>}
    </div>
  );
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-ink/[0.045] p-1" aria-label="Tabs">
      {items.map((t) => (
        <A
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cx(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            t.key === current ? "bg-card text-ink shadow-sm" : "text-ink/60 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-ink/10 px-1.5 text-[11px] tabular-nums">{t.count}</span>}
        </A>
      ))}
    </nav>
  );
}

// ───────────────────────── atoms ─────────────────────────

const AVATAR_TONES = ["#1F3A2E", "#4F6B4A", "#2F5D62", "#7A8F3A", "#B5672C", "#5B4B6E", "#8A5A44"];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const tone = AVATAR_TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: tone, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "accent" | "dark";
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-ink/[0.06] text-ink/70",
    green: "bg-[#E3EEDD] text-[#2E5A2A]",
    amber: "bg-[#F6EBD3] text-[#8A5A10]",
    red: "bg-[#F5E1DC] text-[#8E3326]",
    blue: "bg-[#E1EAF0] text-[#2D5068]",
    accent: "bg-accent text-ink",
    dark: "bg-ink text-paper",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function BookingBadge({ status, position }: { status: BookingStatus; position?: number | null }) {
  const map: Record<BookingStatus, [Tone, string]> = {
    confirmed: ["green", "Booked"],
    waitlisted: ["blue", position ? `Waitlist #${position}` : "Waitlist"],
    cancelled: ["neutral", "Cancelled"],
  };
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Capacity({ booked, capacity, waitlist = 0, compact }: { booked: number; capacity: number; waitlist?: number; compact?: boolean }) {
  const left = Math.max(0, capacity - booked);
  const pct = Math.min(100, (booked / Math.max(1, capacity)) * 100);
  return (
    <div className={cx("min-w-0", compact ? "w-24" : "w-full")}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cx("font-medium", left === 0 ? "text-[#8E3326]" : left <= 2 ? "text-[#8A5A10]" : "text-ink/70")}>
          {left === 0 ? "Full" : `${left} ${left === 1 ? "spot" : "spots"} left`}
        </span>
        {!compact && (
          <span className="text-ink/45 tabular-nums">
            {booked}/{capacity}
            {waitlist ? ` · ${waitlist} waiting` : ""}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
        <div className={cx("h-full rounded-full", left === 0 ? "bg-[#B9574A]" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink/15 bg-card px-1.5 py-0.5 font-mono text-[12px]">{children}</kbd>;
}

// ───────────────────────── buttons ─────────────────────────

type BtnVariant = "primary" | "accent" | "outline" | "ghost" | "danger" | "subtle";
export function btn(variant: BtnVariant = "primary", size: "sm" | "md" | "lg" = "md") {
  return cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg");
}

export function LinkButton({ href, variant = "primary", size = "md", icon, children, className }: { href: string; variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <A href={href} className={cx(btn(variant, size), className)}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </A>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}

// ───────────────────────── dialogs ─────────────────────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div ref={ref} className={cx("modal relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card p-6 shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="-m-1 rounded-lg p-1 text-ink/50 hover:bg-ink/5 hover:text-ink" aria-label="Close dialog">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A button that runs an action, optionally after a confirmation dialog. */
export function ActionButton({
  action,
  input,
  children,
  variant = "outline",
  size = "sm",
  icon,
  confirm,
  className,
  onDone,
}: {
  action: string;
  input: Record<string, unknown>;
  children: ReactNode;
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  confirm?: { title: string; body?: ReactNode; label?: string; danger?: boolean; reason?: boolean };
  className?: string;
  onDone?: (r: ActionResult) => void;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const go = async () => {
    const r = await run(action, confirm?.reason ? { ...input, reason } : input);
    if (r.ok) setOpen(false);
    onDone?.(r);
  };
  return (
    <>
      <button type="button" className={cx(btn(variant, size), className)} disabled={pending} onClick={() => (confirm ? setOpen(true) : go())}>
        {pending && !confirm ? <Spinner /> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
        {children}
      </button>
      {confirm && (
        <Modal open={open} onClose={() => setOpen(false)} title={confirm.title}>
          {confirm.body && <div className="text-[15px] text-ink/70">{confirm.body}</div>}
          {confirm.reason && (
            <label className="mt-4 block">
              <span className="label">Reason (optional, shared with players)</span>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={btn("ghost")} onClick={() => setOpen(false)}>
              Keep it
            </button>
            <button className={btn(confirm.danger ? "danger" : "primary")} onClick={go} disabled={pending} data-autofocus>
              {pending && <Spinner />}
              {confirm.label ?? "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ───────────────────────── forms ─────────────────────────

const FormCtx = createContext<{ pending: boolean }>({ pending: false });

export function formToObject(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (out[key] as string[] | undefined) ?? [];
      arr.push(v);
      out[key] = arr;
    } else out[k] = v;
  }
  // Ensure empty multi-selects are sent as empty arrays.
  form.querySelectorAll<HTMLInputElement>("input[name$='[]']").forEach((el) => {
    const key = el.name.slice(0, -2);
    if (!(key in out)) out[key] = [];
  });
  return out;
}

export function ActionForm({
  action,
  hidden,
  children,
  className,
  reset,
  onDone,
}: {
  action: string;
  hidden?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
  reset?: boolean;
  onDone?: (r: ActionResult) => void;
}) {
  const { run, pending, error } = useAction();
  return (
    <form
      className={className}
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const r = await run(action, { ...formToObject(form), ...hidden });
        if (r.ok && reset) form.reset();
        onDone?.(r);
      }}
    >
      <FormCtx.Provider value={{ pending }}>
        {children}
        {error && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-[#F5E1DC] px-3 py-2 text-sm text-[#8E3326]">
            <Icon name="flag" size={16} className="mt-0.5" /> {error}
          </p>
        )}
      </FormCtx.Provider>
    </form>
  );
}

export function Submit({ children, variant = "primary", size = "md", icon, className }: { children: ReactNode; variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: IconName; className?: string }) {
  const { pending } = useContext(FormCtx);
  return (
    <button type="submit" disabled={pending} className={cx(btn(variant, size), className)}>
      {pending ? <Spinner /> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink/50">{hint}</span>}
    </label>
  );
}

export function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked?: boolean; label: string; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-card px-4 py-3 hover:border-ink/20">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="toggle mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink/55">{hint}</span>}
      </span>
    </label>
  );
}

export function Notice({ tone = "info", children, icon }: { tone?: "info" | "warn"; children: ReactNode; icon?: IconName }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-xl px-4 py-3 text-sm", tone === "warn" ? "bg-[#F6EBD3] text-[#6E4A0E]" : "bg-sage/60 text-ink/80")}>
      <Icon name={icon ?? (tone === "warn" ? "flag" : "spark")} size={17} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
