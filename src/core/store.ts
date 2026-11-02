import type { DB, Row, Table } from "./types";

export interface Query<T> {
  eq?: Partial<T>;
  in?: { field: keyof T; values: readonly unknown[] };
  gte?: { field: keyof T; value: string | number };
  lt?: { field: keyof T; value: string | number };
  contains?: { field: keyof T; value: string }; // array column contains value
  order?: { field: keyof T; asc?: boolean };
  limit?: number;
}

/**
 * Persistence boundary. The memory implementation powers demo mode and tests;
 * the Supabase implementation powers production. Business rules live in
 * services.ts and never talk to a database directly.
 */
export interface Store {
  kind: "memory" | "supabase";
  list<K extends Table>(table: K, q?: Query<Row<K>>): Promise<Row<K>[]>;
  get<K extends Table>(table: K, id: string): Promise<Row<K> | null>;
  insert<K extends Table>(table: K, row: Row<K>): Promise<Row<K>>;
  update<K extends Table>(table: K, id: string, patch: Partial<Row<K>>): Promise<Row<K>>;
  remove<K extends Table>(table: K, id: string): Promise<void>;
  /** Serialise a critical section (booking, cancellation) on a key. */
  exclusive<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Seat counts per session, visible to everyone (bookings themselves are private). */
  sessionStats(ids: string[]): Promise<Record<string, SessionStats>>;
  /** Database-side transactional procedures (Supabase only). */
  rpc?<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Server-side functions, such as the Google Calendar sync (Supabase only). */
  invoke?<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T>;
}

export interface SessionStats {
  booked: number;
  waitlist: number;
}

export function statsFromBookings(ids: string[], bookings: { session_id: string; status: string; seats: number }[]) {
  const out: Record<string, SessionStats> = {};
  for (const id of ids) out[id] = { booked: 0, waitlist: 0 };
  for (const b of bookings) {
    const st = out[b.session_id];
    if (!st) continue;
    if (b.status === "confirmed") st.booked += b.seats || 1;
    if (b.status === "waitlisted") st.waitlist++;
  }
  return out;
}

export function matches<T>(row: T, q?: Query<T>): boolean {
  if (!q) return true;
  const r = row as Record<string, unknown>;
  if (q.eq) for (const [k, v] of Object.entries(q.eq)) if (r[k] !== v) return false;
  if (q.in && !q.in.values.includes(r[q.in.field as string])) return false;
  if (q.gte && !((r[q.gte.field as string] as string | number) >= q.gte.value)) return false;
  if (q.lt && !((r[q.lt.field as string] as string | number) < q.lt.value)) return false;
  if (q.contains) {
    const arr = r[q.contains.field as string];
    if (!Array.isArray(arr) || !arr.includes(q.contains.value)) return false;
  }
  return true;
}

export interface Persistence {
  load(): Promise<DB | null>;
  save(db: DB): Promise<void>;
}

/** In-memory store with pluggable persistence (JSON file on the server, localStorage in the preview). */
export class MemoryStore implements Store {
  kind = "memory" as const;
  private db: DB | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private persistence: Persistence,
    private seed: () => DB,
    private reloadEachRead = false,
  ) {}

  private async data(): Promise<DB> {
    if (!this.db || this.reloadEachRead) {
      const loaded = await this.persistence.load();
      this.db = loaded ?? this.seed();
      if (!loaded) await this.persistence.save(this.db);
    }
    return this.db;
  }

  async reset(): Promise<void> {
    this.db = this.seed();
    await this.persistence.save(this.db);
  }

  async list<K extends Table>(table: K, q?: Query<Row<K>>): Promise<Row<K>[]> {
    const db = await this.data();
    let rows = ((db[table] ?? []) as Row<K>[]).filter((r) => matches(r, q));
    if (q?.order) {
      const f = q.order.field as string;
      const dir = q.order.asc === false ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const x = (a as unknown as Record<string, unknown>)[f] as string | number;
        const y = (b as unknown as Record<string, unknown>)[f] as string | number;
        return x < y ? -dir : x > y ? dir : 0;
      });
    }
    if (q?.limit) rows = rows.slice(0, q.limit);
    return rows.map((r) => structuredClone(r));
  }

  async get<K extends Table>(table: K, id: string): Promise<Row<K> | null> {
    const db = await this.data();
    const row = ((db[table] ?? []) as Row<K>[]).find((r) => (r as { id: string }).id === id);
    return row ? structuredClone(row) : null;
  }

  async insert<K extends Table>(table: K, row: Row<K>): Promise<Row<K>> {
    const db = await this.data();
    ((db[table] ??= [] as never) as Row<K>[]).push(structuredClone(row));
    await this.persistence.save(db);
    return row;
  }

  async update<K extends Table>(table: K, id: string, patch: Partial<Row<K>>): Promise<Row<K>> {
    const db = await this.data();
    const rows = db[table] as Row<K>[];
    const i = rows.findIndex((r) => (r as { id: string }).id === id);
    if (i < 0) throw new Error(`${String(table)} ${id} not found`);
    rows[i] = { ...rows[i], ...structuredClone(patch) };
    await this.persistence.save(db);
    return structuredClone(rows[i]);
  }

  async remove<K extends Table>(table: K, id: string): Promise<void> {
    const db = await this.data();
    (db as unknown as Record<string, unknown>)[table] = (db[table] as Row<K>[]).filter(
      (r) => (r as { id: string }).id !== id,
    );
    await this.persistence.save(db);
  }

  async sessionStats(ids: string[]): Promise<Record<string, SessionStats>> {
    const db = await this.data();
    const set = new Set(ids);
    return statsFromBookings(ids, db.bookings.filter((b) => set.has(b.session_id)));
  }

  exclusive<T>(_key: string, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
