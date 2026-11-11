// A small hand-drawn outline icon set (24×24, 1.75 stroke) in the spirit of Lucide.
import type { SVGProps } from "react";
import type { SessionType } from "@/core/types";
import { SESSION_META } from "@/core/util";

const paths: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6",
  user: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  message: "M4 5h16v11H9l-5 4z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  down: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4",
  megaphone: "M3 10v4h4l8 5V5L7 10zM18.5 8.5a5 5 0 0 1 0 7",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z",
  clipboard: "M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M8.5 12h7M8.5 16h5",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  menu: "M4 7h16M4 12h16M4 17h16",
  arrow: "M5 12h14M13 6l6 6-6 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  ball: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  flag: "M5 21V4h12l-2 4 2 4H5",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  whistle: "M3 12a5 5 0 1 0 10 0 5 5 0 0 0-10 0zM8 7h13v4h-8",
  note: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, className = "", ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

// Cut-paper marks for the two session types, the way the WhatsApp groups use them:
// a palm for Group Sessions and a rocket for Performance Accelerators. Filled, on a 100×120 box.
const marks: Record<SessionType, string[]> = {
  group: [
    "M49 52C47 70 44 90 46 106C43 110 42 114 43 118H59C58 113 56 109 54 106C53 88 55 70 56 52Z",
    "M52 48C32 32 10 40 4 68C8 72 12 70 14 66C20 52 36 48 52 60Z",
    "M52 46C40 22 20 14 6 20C4 24 6 28 10 26C24 22 38 32 50 54Z",
    "M52 44C50 24 42 8 28 2C24 4 26 10 30 12C38 22 44 34 50 50Z",
    "M52 48C72 32 94 40 100 68C96 72 92 70 90 66C84 52 68 48 52 60Z",
    "M52 46C64 22 84 14 98 20C100 24 98 28 94 26C80 22 66 32 54 54Z",
    "M52 44C54 24 62 8 76 2C80 4 78 10 74 12C66 22 60 34 54 50Z",
    "M52 42A6 6 0 1 0 52.1 42Z",
  ],
  performance_accelerator: [
    "M50 4C66 18 72 42 68 76H32C28 42 34 18 50 4ZM50 32A7 7 0 1 0 50.1 32Z",
    "M32 60C20 68 16 82 18 94L33 82Z",
    "M68 60C80 68 84 82 82 94L67 82Z",
    "M40 82C40 96 46 106 50 116C54 106 60 96 60 82Z",
  ],
};

/** Stands in for the colour dot wherever a session's type is shown. */
export function SessionMark({ type, size = 16, className = "" }: { type: SessionType | null; size?: number; className?: string }) {
  const t = type ?? "group";
  return (
    <svg width={(size * 5) / 6} height={size} viewBox="0 0 100 120" fill={SESSION_META[t].color} fillRule="evenodd" aria-hidden="true" className={`shrink-0 ${className}`}>
      {marks[t].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const BALL_SEAMS = "M2.6 7.6c3.5 1.3 5.8 4.5 5.8 8.4 0 2.1-.6 4-1.7 5.5M21.4 16.4c-3.5-1.3-5.8-4.5-5.8-8.4 0-2.1.6-4 1.7-5.5";

/** A tennis ball in the brand accent. `empty` draws the dashed outline of one not yet played. */
export function TennisBall({ size = 24, empty, className = "" }: { size?: number; empty?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      {empty ? (
        <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.6" opacity="0.35" />
      ) : (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--accent)" />
          <path d={BALL_SEAMS} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
        </>
      )}
    </svg>
  );
}

/**
 * The moment a booking lands: a brand-green panel drops over the whole screen, a check draws itself,
 * and the details rise in. It lifts away on its own after a few seconds, or sooner on a tap or Escape.
 */
export function bookedTakeover({ title, detail, note }: { title: string; detail: string; note?: string }) {
  if (typeof document === "undefined") return;
  document.querySelector(".booked-takeover")?.remove();
  const layer = document.createElement("div");
  layer.className = "booked-takeover";
  layer.setAttribute("role", "status");
  layer.innerHTML = `<div class="booked-inner"><div class="booked-check"><span class="booked-ripple"></span><svg viewBox="0 0 80 80" width="88" height="88"><circle class="booked-ring" cx="40" cy="40" r="36" pathLength="1"/><path class="booked-tick" d="M25 41.5l10 10 20-22" pathLength="1"/></svg></div><h2></h2><p class="booked-detail"></p><p class="booked-note"></p><span class="booked-hint">Tap anywhere to close</span></div>`;
  layer.querySelector("h2")!.textContent = title;
  layer.querySelector(".booked-detail")!.textContent = detail;
  const noteEl = layer.querySelector<HTMLElement>(".booked-note")!;
  if (note) noteEl.textContent = note;
  else noteEl.remove();
  document.body.appendChild(layer);
  navigator.vibrate?.(25);
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener("keydown", onKey);
    layer.classList.add("is-leaving");
    setTimeout(() => layer.remove(), 450);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  layer.addEventListener("click", close);
  window.addEventListener("keydown", onKey);
  setTimeout(close, 3200);
}

/** A quick burst of tennis balls from a point on screen, for the moment a booking lands. */
export function ballBurst(from: { x: number; y: number }) {
  if (typeof document === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "ball-burst";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 14; i++) {
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 70 + Math.random() * 90;
    const size = 12 + Math.round(Math.random() * 12);
    const ball = document.createElement("span");
    ball.style.cssText = `left:${from.x}px;top:${from.y}px;width:${size}px;height:${size}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 60}px;--spin:${Math.round(Math.random() * 540 - 270)}deg;animation-delay:${i * 12}ms`;
    ball.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="11" fill="var(--accent)"/><path d="${BALL_SEAMS}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    layer.appendChild(ball);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}
