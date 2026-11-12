import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/core/types";
import type { AssistantReply, Msg, Proposal } from "@/core/assistant";

export interface LinkProps {
  href: string;
  className?: string;
  children?: ReactNode;
  title?: string;
  onClick?: () => void;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
}

/** Everything a view needs from its host. */
export interface NavApi {
  path: string;
  search: Record<string, string>;
  Link: (p: LinkProps) => ReactNode;
  push: (href: string) => void;
  act: (name: string, input: Record<string, unknown>) => Promise<ActionResult>;
  auth: {
    password: (email: string, password: string, mode: "signin" | "signup", next?: string) => Promise<ActionResult>;
    request: (identifier: string) => Promise<ActionResult>;
    verify: (identifier: string, code: string, next?: string) => Promise<ActionResult>;
    signOut: () => Promise<void>;
    demoAs?: (userId: string) => Promise<void>;
    resetDemo?: () => Promise<void>;
  };
  demo: boolean;
  /** The coach assistant: the model answers through `ask`; its tools run here, as the signed-in coach. */
  assistant: {
    ask: (messages: Msg[]) => Promise<AssistantReply>;
    read: (name: string, input: Record<string, unknown>) => Promise<unknown>;
    propose: (name: string, input: Record<string, unknown>) => Promise<Proposal>;
    contact: (name: string) => Promise<string | null>;
  };
}

const NavCtx = createContext<NavApi | null>(null);
export const NavProvider = NavCtx.Provider;

export function useNav(): NavApi {
  const v = useContext(NavCtx);
  if (!v) throw new Error("NavProvider missing");
  return v;
}

export function A(p: LinkProps) {
  const { Link } = useNav();
  return <Link {...p} />;
}

export function withQuery(path: string, q: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

// ───────────────────────── toasts ─────────────────────────

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-lg ${t.tone === "error" ? "bg-[#7A2E24] text-white" : "bg-ink text-paper"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run a server action with pending state, toasts and redirects. */
export function useAction() {
  const nav = useNav();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(
    async (name: string, input: Record<string, unknown>): Promise<ActionResult> => {
      setPending(true);
      setError(null);
      let r: ActionResult;
      try {
        r = await nav.act(name, input);
      } catch {
        r = { ok: false, error: "Network problem — please try again." };
      }
      if (mounted.current) setPending(false);
      if (!r.ok) {
        if (mounted.current) setError(r.error);
        toast(r.error, "error");
      } else {
        if (r.message) toast(r.message);
        if (r.redirect) {
          if (/^https?:\/\//.test(r.redirect)) window.location.href = r.redirect;
          else nav.push(r.redirect);
        }
      }
      return r;
    },
    [nav, toast],
  );
  return { run, pending, error, setError };
}
