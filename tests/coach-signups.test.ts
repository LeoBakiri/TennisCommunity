import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import type { Actor } from "../src/core/types";
import { loadCoachSchedule } from "../src/core/queries";

test("coach sees sign-ups for their upcoming sessions, with new ones counted", async () => {
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()));
  for (const id of [DEMO_IDS.leo, DEMO_IDS.kaan]) {
    const user = await store.get("profiles", id);
    const actor: Actor = { auth_id: id, identifier: user?.email ?? null, user };
    const now = new Date();
    const { signups } = await loadCoachSchedule({ store, actor, params: {}, search: {}, now });
    const sessions = await store.list("sessions");
    for (const s of signups.sessions) {
      const row = sessions.find((x) => x.id === s.id)!;
      assert.ok(row.coach_ids.includes(id), "only the coach's own sessions");
      assert.ok(s.starts_at > now.toISOString(), "only upcoming");
      assert.equal(s.players.length, s.booked);
      assert.ok(s.fresh >= s.players.filter((p) => p.fresh).length);
    }
    assert.equal(signups.booked, signups.sessions.reduce((n, s) => n + s.booked, 0));
    assert.equal(signups.new_today, signups.sessions.reduce((n, s) => n + s.fresh, 0));
    assert.deepEqual(signups.sessions.map((s) => s.starts_at), [...signups.sessions.map((s) => s.starts_at)].sort());
  }
});
