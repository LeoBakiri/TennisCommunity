// Dependency-free Supabase client: PostgREST for data, GoTrue for auth.
// Security is enforced in the database with Row Level Security (see supabase/schema.sql).
import type { Query, SessionStats, Store } from "@/core/store";
import type { Row, Table } from "@/core/types";
import { UserError } from "@/core/services";

export interface SupaConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds
  user: { id: string; email?: string; phone?: string };
}

const SESSION_KEY = "ltc.supabase.session";

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}
function writeSession(s: AuthSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; msg?: string; error_description?: string; error?: string; hint?: string };
    return j.message || j.msg || j.error_description || j.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export class SupabaseAuth {
  private refreshing: Promise<AuthSession | null> | null = null;
  constructor(private cfg: SupaConfig) {}

  private async gotrue(path: string, body: unknown, token?: string) {
    const res = await fetch(`${this.cfg.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: this.cfg.supabaseAnonKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await parseError(res));
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  private store(j: { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number; user?: AuthSession["user"] }): AuthSession | null {
    if (!j.access_token || !j.user) return null;
    const s: AuthSession = {
      access_token: j.access_token,
      refresh_token: j.refresh_token ?? "",
      expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
      user: j.user,
    };
    writeSession(s);
    return s;
  }

  current(): AuthSession | null {
    return readSession();
  }

  async token(): Promise<string | null> {
    const s = readSession();
    if (!s) return null;
    if (s.expires_at * 1000 - 60_000 > Date.now()) return s.access_token;
    this.refreshing ??= this.gotrue("token?grant_type=refresh_token", { refresh_token: s.refresh_token })
      .then((j) => this.store(j))
      .catch(() => {
        writeSession(null);
        return null;
      })
      .finally(() => (this.refreshing = null));
    const fresh = await this.refreshing;
    return fresh?.access_token ?? null;
  }

  async signInWithPassword(email: string, password: string) {
    return this.store(await this.gotrue("token?grant_type=password", { email, password }));
  }

  async signUp(email: string, password: string) {
    const j = await this.gotrue("signup", { email, password });
    const s = this.store(j);
    if (!s) throw new Error("Account created. Check your email to confirm it, then sign in.");
    return s;
  }

  async sendCode(email: string) {
    await this.gotrue("otp", { email, create_user: true });
  }

  async verifyCode(email: string, token: string) {
    return this.store(await this.gotrue("verify", { type: "email", email, token }));
  }

  async signOut() {
    const s = readSession();
    writeSession(null);
    if (s) await this.gotrue("logout", {}, s.access_token).catch(() => undefined);
  }
}

function enc(v: unknown): string {
  return encodeURIComponent(String(v));
}
function inList(values: readonly unknown[]) {
  return `(${values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",")})`;
}

/** Turn PostgREST errors into friendly messages: business-rule errors raised in SQL pass through. */
async function dbError(res: Response): Promise<Error> {
  let j: { message?: string; code?: string } = {};
  try {
    j = await res.json();
  } catch {
    /* ignore */
  }
  if (j.code === "P0001" && j.message) return new UserError(j.message);
  if (j.code === "42501" || res.status === 401 || res.status === 403) return new UserError("You don't have permission to do that. Try signing in again.");
  if (j.code === "23505") return new UserError("That already exists.");
  return new Error(j.message ?? `Database request failed (${res.status})`);
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
/** Postgres returns timestamps as "…+00:00"; the app compares ISO strings, so normalise to "…Z". */
function normalize<T>(row: T): T {
  const r = row as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (typeof v === "string" && TS.test(v)) r[k] = new Date(v).toISOString();
  }
  return row;
}

export class SupabaseStore implements Store {
  kind = "supabase" as const;
  constructor(
    private cfg: SupaConfig,
    private auth: SupabaseAuth,
  ) {}

  private async headers(extra: Record<string, string> = {}) {
    const token = (await this.auth.token()) ?? this.cfg.supabaseAnonKey;
    return { apikey: this.cfg.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra };
  }

  private url(table: string, params: string[]) {
    return `${this.cfg.supabaseUrl}/rest/v1/${table}${params.length ? `?${params.join("&")}` : ""}`;
  }

  private filters<T>(q?: Query<T>): string[] | null {
    const p: string[] = [];
    if (!q) return p;
    if (q.eq)
      for (const [k, v] of Object.entries(q.eq)) {
        if (v === null) p.push(`${k}=is.null`);
        else p.push(`${k}=eq.${enc(v)}`);
      }
    if (q.in) {
      if (!q.in.values.length) return null; // matches nothing
      p.push(`${String(q.in.field)}=in.${enc(inList(q.in.values))}`);
    }
    if (q.gte) p.push(`${String(q.gte.field)}=gte.${enc(q.gte.value)}`);
    if (q.lt) p.push(`${String(q.lt.field)}=lt.${enc(q.lt.value)}`);
    if (q.contains) p.push(`${String(q.contains.field)}=cs.${enc(`{"${q.contains.value}"}`)}`);
    return p;
  }

  async list<K extends Table>(table: K, q?: Query<Row<K>>): Promise<Row<K>[]> {
    const f = this.filters(q);
    if (f === null) return [];
    const params = ["select=*", ...f];
    if (q?.order) params.push(`order=${String(q.order.field)}.${q.order.asc === false ? "desc" : "asc"}`);
    if (q?.limit) params.push(`limit=${q.limit}`);
    const res = await fetch(this.url(table, params), { headers: await this.headers() });
    if (!res.ok) throw await dbError(res);
    return ((await res.json()) as Row<K>[]).map(normalize);
  }

  async get<K extends Table>(table: K, id: string): Promise<Row<K> | null> {
    const rows = await this.list(table, { eq: { id } as Partial<Row<K>>, limit: 1 });
    return rows[0] ?? null;
  }

  async insert<K extends Table>(table: K, row: Row<K>): Promise<Row<K>> {
    const res = await fetch(this.url(table, []), { method: "POST", headers: await this.headers({ Prefer: "return=representation" }), body: JSON.stringify(row) });
    if (!res.ok) throw await dbError(res);
    const out = (await res.json()) as Row<K>[];
    return out[0] ? normalize(out[0]) : row;
  }

  async update<K extends Table>(table: K, id: string, patch: Partial<Row<K>>): Promise<Row<K>> {
    const res = await fetch(this.url(table, [`id=eq.${enc(id)}`]), { method: "PATCH", headers: await this.headers({ Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (!res.ok) throw await dbError(res);
    const out = (await res.json()) as Row<K>[];
    if (!out[0]) throw new UserError("You don't have permission to change that.");
    return normalize(out[0]);
  }

  async remove<K extends Table>(table: K, id: string): Promise<void> {
    const res = await fetch(this.url(table, [`id=eq.${enc(id)}`]), { method: "DELETE", headers: await this.headers() });
    if (!res.ok) throw await dbError(res);
  }

  exclusive<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async sessionStats(ids: string[]): Promise<Record<string, SessionStats>> {
    if (!ids.length) return {};
    const rows = await this.rpc<{ session_id: string; booked: number; waitlist: number; pending: number }[]>("session_stats", { ids });
    const out: Record<string, SessionStats> = {};
    for (const id of ids) out[id] = { booked: 0, waitlist: 0, pending: 0 };
    for (const r of rows ?? []) out[r.session_id] = { booked: Number(r.booked), waitlist: Number(r.waitlist), pending: Number(r.pending) };
    return out;
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: await this.headers(), body: JSON.stringify(args) });
    if (!res.ok) throw await dbError(res);
    const text = await res.text();
    const out = text ? JSON.parse(text) : null;
    return (out && typeof out === "object" && !Array.isArray(out) ? normalize(out) : out) as T;
  }
}
