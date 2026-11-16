// Styled dropdowns for forms: a select-like Dropdown and a name ClientCombobox.
// They replace the browser's own popups (select menus and datalist suggestions), which look different on every device.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Avatar, cx } from "./kit";

export type Option = { value: string; label: ReactNode; hint?: ReactNode };

/** Closes a popover on a click or tap outside the field and its menu. */
function useOutside(refs: RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}

const MENU = "fixed z-[60] overflow-y-auto overscroll-contain rounded-xl border border-ink/10 bg-card p-1 shadow-[0_12px_32px_-8px_rgba(30,36,32,0.22)]";

type Spot = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
/** Under the field, or above it when there's more room there (bottom of a popup or a phone screen). */
function spotFor(el: HTMLElement | null): Spot | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  const up = below < 220 && above > below;
  return { left: r.left, width: r.width, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxHeight: Math.min(288, up ? above : below) };
}

/** The menu floats on the page itself, so popups and scrolling cards never cut it off. */
function Floating({ anchor, menu, id, children }: { anchor: RefObject<HTMLElement | null>; menu: RefObject<HTMLDivElement | null>; id: string; children: ReactNode }) {
  const [spot, setSpot] = useState<Spot | null>(() => spotFor(anchor.current));
  useEffect(() => {
    const place = () => setSpot(spotFor(anchor.current));
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  if (!spot) return null;
  return createPortal(
    <div ref={menu} id={id} role="listbox" className={MENU} style={spot}>
      {children}
    </div>,
    document.body,
  );
}
const ROW = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14.5px] text-ink";

/**
 * A select with a styled menu. Sends its value in a hidden input when given a name.
 * Controlled with value/onChange, or left alone with defaultValue.
 */
export function Dropdown({ name, value, defaultValue, onChange, options, placeholder = "Choose", label }: { name?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; options: Option[]; placeholder?: string; label?: string }) {
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useOutside([box, list], open, close);
  const chosen = options.find((o) => o.value === current);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };
  const pick = (v: string) => {
    setOwn(v);
    onChange?.(v);
    setOpen(false);
  };
  // Keep the highlighted row in view, and start long lists (times) at the chosen one.
  // Scrolls only the menu, never the page: the chosen row starts in the middle, then follows the keyboard.
  useEffect(() => {
    const box = list.current;
    if (open && box) {
      const row = box.querySelector<HTMLElement>(`[data-i="${Math.max(0, options.findIndex((o) => o.value === current))}"]`);
      if (row) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!open || !box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [open, active]);

  const onKey = (e: KeyboardEvent) => {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      return show();
    }
    if (!open) return;
    if (e.key === "Escape") e.nativeEvent.stopPropagation(); // close the menu, not the popup around it
    if (e.key === "Escape" || e.key === "Tab") return close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, Math.max(0, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) pick(options[active].value);
    }
  };

  return (
    <div ref={box} className="relative">
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        className={cx("input flex items-center justify-between gap-2 text-left", open && "border-brand shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_15%,transparent)]")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
      >
        <span className={cx("min-w-0 truncate", !chosen && "text-ink/40")}>{chosen ? chosen.label : placeholder}</span>
        <Icon name="down" size={16} className={cx("shrink-0 text-ink/45 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <Floating anchor={box} menu={list} id={id}>
          {options.map((o, i) => {
            const on = o.value === current;
            return (
              <button
                type="button"
                key={o.value}
                data-i={i}
                role="option"
                aria-selected={on}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={cx(ROW, i === active && "bg-ink/[0.05]", on && "font-semibold")}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[12.5px] font-normal text-ink/45">{o.hint}</span>}
                <Icon name="check" size={15} className={cx("shrink-0 text-brand", !on && "invisible")} />
              </button>
            );
          })}
        </Floating>
      )}
    </div>
  );
}

/**
 * Name field with the coach's clients suggested as they type.
 * With `multi`, names are comma separated and suggestions complete the name being typed.
 */
export function ClientCombobox({ name, defaultValue, value, clients, multi, onChange, required, autoFocus }: { name?: string; defaultValue?: string; value?: string; clients: string[]; multi?: boolean; onChange?: (v: string) => void; required?: boolean; autoFocus?: boolean }) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const text = value ?? own;
  const setText = setOwn;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  useOutside([box, menu], open, () => setOpen(false));

  const parts = text.split(",");
  const typed = (multi ? parts[parts.length - 1] : text).trim().toLowerCase();
  const taken = new Set(multi ? parts.slice(0, -1).map((p) => p.trim().toLowerCase()) : []);
  const matches = clients
    .filter((c) => !c.includes(",") && !taken.has(c.toLowerCase()))
    .filter((c) => !typed || c.toLowerCase().split(/\s+/).some((w) => w.startsWith(typed)) || c.toLowerCase().startsWith(typed))
    .filter((c) => c.toLowerCase() !== typed)
    .slice(0, 6);
  const showing = open && matches.length > 0;

  const set = (v: string) => {
    setText(v);
    onChange?.(v);
  };
  const pick = (c: string) => {
    set(multi ? [...parts.slice(0, -1).map((p) => p.trim()).filter(Boolean), c].join(", ") : c);
    setOpen(false);
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!showing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(matches[Math.min(active, matches.length - 1)]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.nativeEvent.stopPropagation();
      setOpen(false);
    }
  };
  const bold = (c: string) => {
    if (!typed) return c;
    const at = c.toLowerCase().search(new RegExp(`(^|\\s)${typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    if (at < 0) return c;
    const s = c[at] === " " ? at + 1 : at;
    return (
      <>
        {c.slice(0, s)}
        <span className="font-semibold">{c.slice(s, s + typed.length)}</span>
        {c.slice(s + typed.length)}
      </>
    );
  };

  return (
    <div ref={box} className="relative">
      <input
        ref={input}
        className="input"
        name={name}
        value={text}
        required={required}
        autoComplete="off"
        data-autofocus={autoFocus || undefined}
        role="combobox"
        aria-expanded={showing}
        aria-controls={id}
        aria-autocomplete="list"
        placeholder={multi ? "Type names, separated by commas" : "Type a name"}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          set(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {showing && (
        <Floating anchor={box} menu={menu} id={id}>
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink/40 uppercase">Your clients</p>
          {matches.map((c, i) => (
            <button
              type="button"
              key={c}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
              className={cx(ROW, i === active && "bg-ink/[0.05]")}
            >
              <Avatar name={c} size={26} />
              <span className="min-w-0 truncate">{bold(c)}</span>
            </button>
          ))}
        </Floating>
      )}
    </div>
  );
}
