// Remembers reads for a short time so a click rarely has to wait on the network.
// Anything this browser changes is forgotten at once; the database still enforces every rule.
import type { Query, SessionStats, StaffName, Store } from "./store";
import type { Row, Table } from "./types";

/** Tables that rarely change, and how long their rows are trusted. */
const SLOW_TABLES = new Set<string>(["settings", "profiles", "sessions"]);
export const SLOW_MS = 60_000;
/** Long enough to cover the gap between hovering a link and clicking it. */
export const FAST_MS = 10_000;

/** These procedures only touch bookings, so rows from the slow tables stay good. */
const BOOKING_ONLY = new Set(["book_session", "cancel_booking", "offer_spot", "withdraw_offer", "take_offered_spot"]);

interface Entry {
  at: number;
  slow: boolean;
  value: Promise<unknown>;
}

const copy = <T>(row: T): T => (row && typeof row === "object" ? { ...row } : row);

export class CachedStore implements Store {
  readonly kind: Store["kind"];
  readonly rpc?: Store["rpc"];
  readonly invoke?: Store["invoke"];
  private entries = new Map<string, Entry>();

  constructor(
    private inner: Store,
    private clock: () => number = Date.now,
  ) {
    this.kind = inner.kind;
    // Services check for rpc to choose the database path, so only offer what the inner store has.
    if (inner.rpc) {
      this.rpc = async <T>(fn: string, args: Record<string, unknown>) => {
        try {
          return await inner.rpc!<T>(fn, args);
        } finally {
          if (BOOKING_ONLY.has(fn)) this.forget((_, e) => !e.slow);
          else this.clear();
        }
      };
    }
    if (inner.invoke) {
      this.invoke = async <T>(fn: string, body: Record<string, unknown>) => {
        try {
          return await inner.invoke!<T>(fn, body);
        } finally {
          this.forget((key) => key.startsWith("coach_calendars|"));
        }
      };
    }
  }

  clear() {
    this.entries.clear();
  }

  private forget(match: (key: string, e: Entry) => boolean) {
    for (const [key, e] of this.entries) if (match(key, e)) this.entries.delete(key);
  }

  private read<T>(key: string, slow: boolean, load: () => Promise<T>): Promise<T> {
    const now = this.clock();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < (hit.slow ? SLOW_MS : FAST_MS)) return hit.value as Promise<T>;
    const value = load();
    const entry: Entry = { at: now, slow, value };
    this.entries.set(key, entry);
    value.then(
      (v) => {
        if (v === null && this.entries.get(key) === entry) this.entries.delete(key);
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return value;
  }

  async list<K extends Table>(table: K, q?: Query<Row<K>>): Promise<Row<K>[]> {
    const key = `${table}|${JSON.stringify(q ?? null)}`;
    const slow = SLOW_TABLES.has(table);
    const before = this.entries.get(key);
    const pending = this.read(key, slow, () => this.inner.list(table, q));
    const entry = this.entries.get(key);
    const rows = await pending;
    // A list returns whole rows, so opening any one of them needs no further trip.
    if (entry && entry !== before && this.entries.get(key) === entry) {
      for (const row of rows) {
        const id = (row as { id?: string }).id;
        if (id) this.entries.set(`${table}|#${id}`, { at: entry.at, slow, value: Promise.resolve(row) });
      }
    }
    return rows.map(copy);
  }

  async get<K extends Table>(table: K, id: string): Promise<Row<K> | null> {
    return copy(await this.read(`${table}|#${id}`, SLOW_TABLES.has(table), () => this.inner.get(table, id)));
  }

  async sessionStats(ids: string[]): Promise<Record<string, SessionStats>> {
    return this.read(`session_stats|${ids.join()}`, false, () => this.inner.sessionStats(ids));
  }

  async staffNames(): Promise<StaffName[]> {
    return (await this.read("staff_names", true, () => this.inner.staffNames())).map(copy);
  }

  async insert<K extends Table>(table: K, row: Row<K>): Promise<Row<K>> {
    return this.write(() => this.inner.insert(table, row));
  }

  async update<K extends Table>(table: K, id: string, patch: Partial<Row<K>>): Promise<Row<K>> {
    return this.write(() => this.inner.update(table, id, patch));
  }

  async remove<K extends Table>(table: K, id: string): Promise<void> {
    return this.write(() => this.inner.remove(table, id));
  }

  exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.inner.exclusive(key, fn);
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } finally {
      // After the write, so a read that raced it can't be served later.
      this.clear();
    }
  }
}
