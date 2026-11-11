import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

// Opened from the home screen, the site has no browser bar, so there's no reload button.
// Pulling down from the top of the page reloads it, which also picks up a new release.
const PULL_TO_RELOAD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

/** True when the site runs as an installed home-screen app rather than in a browser tab. */
export function isHomeScreenApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Something under the finger is scrolled, or a dialog or menu is open: the pull belongs to that, not the page. */
function pullBelongsElsewhere(target: EventTarget | null) {
  if (document.querySelector('[aria-modal="true"]')) return true;
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulled = useRef(0);

  useEffect(() => {
    const show = (d: number) => {
      pulled.current = d;
      setPull(d);
    };
    const onStart = (e: TouchEvent) => {
      start.current = null;
      if (e.touches.length !== 1 || window.scrollY > 0 || !isHomeScreenApp() || pullBelongsElsewhere(e.target)) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = e.touches[0].clientX - start.current.x;
      // Scrolling up or swiping sideways (the week grid, carousels) isn't a pull.
      if (window.scrollY > 0 || dy < 0 || (pulled.current === 0 && Math.abs(dx) > dy)) {
        start.current = null;
        show(0);
        return;
      }
      show(Math.min(MAX_PULL, dy * RESISTANCE));
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      if (pulled.current >= PULL_TO_RELOAD) {
        setReloading(true);
        show(PULL_TO_RELOAD);
        window.location.reload();
      } else show(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (pull === 0 && !reloading) return null;
  const ready = pull >= PULL_TO_RELOAD;
  const tracking = !!start.current;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center"
      style={{
        transform: `translateY(calc(env(safe-area-inset-top) + ${pull - 44}px))`,
        transition: tracking ? undefined : "transform 0.2s ease-out",
      }}
      role="status"
      aria-label={reloading ? "Refreshing" : ready ? "Release to refresh" : "Pull to refresh"}
    >
      <div className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg ring-1 ring-ink/[0.07] transition-colors ${ready ? "bg-brand text-accent" : "bg-card text-brand"}`}>
        {reloading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-current border-r-transparent" />
        ) : (
          <Icon name="refresh" size={20} style={{ transform: `rotate(${(pull / PULL_TO_RELOAD) * 270}deg)`, opacity: Math.min(1, pull / 40) }} />
        )}
      </div>
    </div>
  );
}
