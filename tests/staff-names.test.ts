import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type Store } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { loadSchedule } from "../src/core/queries";
import type { DB } from "../src/core/types";

// The live database only shows a player their own profile; coach names come from staff_names().
function playerView(staffNames?: Store["staffNames"]) {
  const inner = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()) as DB);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "staffNames" && staffNames) return staffNames;
      if (prop === "list")
        return async (table: string, q?: unknown) => {
          const rows = await target.list(table as "profiles", q as undefined);
          return table === "profiles" ? rows.filter((p) => p.id === DEMO_IDS.sam) : rows;
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Store;
}

async function coachNames(store: Store) {
  const data = await loadSchedule({ store, actor: { auth_id: null, identifier: null, user: null }, params: {}, search: {}, now: new Date() });
  return data.days.flatMap((d) => d.sessions).flatMap((s) => s.coaches);
}

test("the schedule names coaches without reading their profiles", async () => {
  const coaches = await coachNames(playerView());
  assert.ok(coaches.length > 0);
  assert.ok(coaches.every((c) => c.full_name));
});

test("the schedule still loads when the name lookup fails", async () => {
  const coaches = await coachNames(playerView(async () => Promise.reject(new Error("offline"))));
  assert.deepEqual(coaches, []);
});

test("staff names carry no contact details", async () => {
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()) as DB);
  const staff = await store.staffNames();
  assert.ok(staff.length > 0);
  for (const s of staff) assert.deepEqual(Object.keys(s).sort(), ["full_name", "id", "role"]);
});
