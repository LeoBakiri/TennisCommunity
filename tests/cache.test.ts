import { test } from "node:test";
import assert from "node:assert/strict";
import { CachedStore, FAST_MS, SLOW_MS } from "../src/core/cache";
import { MemoryStore, type Store } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import type { DB } from "../src/core/types";

function setup(extra: Partial<Store> = {}) {
  const inner = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()) as DB);
  const calls: string[] = [];
  const spy = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop in extra) return (extra as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        calls.push(`${String(prop)}:${String(args[0])}`);
        return v.apply(target, args);
      };
    },
  }) as unknown as Store;
  let now = 1_000_000;
  const clock = { advance: (ms: number) => (now += ms) };
  return { store: new CachedStore(spy, () => now), calls, clock };
}

const count = (calls: string[], name: string) => calls.filter((c) => c === name).length;

test("identical reads share one trip, even while the first is still running", async () => {
  const { store, calls } = setup();
  await Promise.all([store.list("profiles"), store.list("profiles")]);
  await store.list("profiles");
  assert.equal(count(calls, "list:profiles"), 1);
});

test("fast tables expire sooner than slow tables", async () => {
  const { store, calls, clock } = setup();
  await store.list("bookings");
  await store.list("profiles");
  clock.advance(FAST_MS + 1);
  await store.list("bookings");
  await store.list("profiles");
  assert.equal(count(calls, "list:bookings"), 2);
  assert.equal(count(calls, "list:profiles"), 1);
  clock.advance(SLOW_MS);
  await store.list("profiles");
  assert.equal(count(calls, "list:profiles"), 2);
});

test("a listed row can be opened without another trip", async () => {
  const { store, calls } = setup();
  await store.list("profiles");
  const p = await store.get("profiles", DEMO_IDS.sam);
  assert.equal(p?.id, DEMO_IDS.sam);
  assert.equal(count(calls, `get:profiles`), 0);
});

test("a write is visible to the next read", async () => {
  const { store } = setup();
  await store.get("profiles", DEMO_IDS.sam);
  await store.list("profiles");
  await store.update("profiles", DEMO_IDS.sam, { full_name: "Changed Name" });
  assert.equal((await store.get("profiles", DEMO_IDS.sam))?.full_name, "Changed Name");
  assert.ok((await store.list("profiles")).some((p) => p.full_name === "Changed Name"));
});

test("a write that fails still forgets what was read", async () => {
  const { store, calls } = setup();
  await store.list("profiles");
  await assert.rejects(store.update("profiles", "missing", { full_name: "x" }));
  await store.list("profiles");
  assert.equal(count(calls, "list:profiles"), 2);
});

test("a read that raced a write is not kept", async () => {
  const { store, calls } = setup();
  const racing = store.list("profiles");
  await store.update("profiles", DEMO_IDS.sam, { full_name: "Changed Name" });
  await racing;
  await store.get("profiles", DEMO_IDS.sam);
  await store.list("profiles");
  assert.equal(count(calls, "list:profiles"), 2);
  assert.equal(count(calls, "get:profiles"), 1);
});

test("a failed read is tried again", async () => {
  let fail = true;
  const { store } = setup({
    list: (async () => {
      if (fail) throw new Error("offline");
      return [];
    }) as Store["list"],
  });
  await assert.rejects(store.list("profiles"));
  fail = false;
  assert.deepEqual(await store.list("profiles"), []);
});

test("changing a returned row doesn't change what is remembered", async () => {
  const { store } = setup();
  const [first] = await store.list("profiles");
  const name = first.full_name;
  first.full_name = "Mutated";
  const [again] = await store.list("profiles");
  assert.equal(again.full_name, name);
});

test("booking procedures keep slow tables and drop bookings", async () => {
  const { store, calls } = setup({ rpc: (async () => null) as Store["rpc"] });
  await store.list("profiles");
  await store.list("bookings");
  await store.rpc!("book_session", {});
  await store.list("profiles");
  await store.list("bookings");
  assert.equal(count(calls, "list:profiles"), 1);
  assert.equal(count(calls, "list:bookings"), 2);
});

test("other procedures forget everything", async () => {
  const { store, calls } = setup({ rpc: (async () => null) as Store["rpc"] });
  await store.list("profiles");
  await store.rpc!("claim_profile", {});
  await store.list("profiles");
  assert.equal(count(calls, "list:profiles"), 2);
});

test("rpc and invoke exist only when the inner store has them", async () => {
  const { store } = setup();
  assert.equal(store.rpc, undefined);
  assert.equal(store.invoke, undefined);
  const withRpc = setup({ rpc: (async () => null) as Store["rpc"] });
  assert.equal(typeof withRpc.store.rpc, "function");
});
