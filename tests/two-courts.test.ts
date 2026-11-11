import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import type { Actor, Session, SessionType } from "../src/core/types";
import { courtPlan, needsDecision } from "../src/core/util";
import { courtHeadsUp, courtNote } from "../src/ui/sessions";
import { loadCoachSchedule, type SessionView } from "../src/core/queries";

test("a session bigger than one court runs on two, with a minimum", () => {
  assert.deepEqual(courtPlan({ session_type: "group", capacity: 6 }), { size: 6, courts: 1, minimum: 0 });
  assert.deepEqual(courtPlan({ session_type: "group", capacity: 12 }), { size: 6, courts: 2, minimum: 10 });
  assert.deepEqual(courtPlan({ session_type: "performance_accelerator", capacity: 4 }), { size: 4, courts: 1, minimum: 0 });
  assert.deepEqual(courtPlan({ session_type: "performance_accelerator", capacity: 8 }), { size: 4, courts: 2, minimum: 6 });
});

test("players see how many more a two-court session needs", () => {
  const at = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
  const s = (booked: number, extra: { session_type?: SessionType; capacity?: number; decided_at?: string | null; starts_at?: string } = {}) => ({
    session_type: "group" as SessionType, capacity: 12, booked, status: "published" as const, decided_at: null, starts_at: at(48), ...extra,
  });
  assert.equal(courtNote(s(2, { capacity: 6 })), null);
  assert.match(courtNote(s(2))!.text, /^2 courts · needs 8 more by (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(:\d\d)? (AM|PM)$/);
  assert.equal(courtNote(s(10))!.text, "2 courts · going ahead");
  assert.match(courtNote(s(3, { session_type: "performance_accelerator", capacity: 8 }))!.text, /needs 3 more by /);
  assert.equal(courtNote(s(2, { decided_at: at(-1) }))!.text, "2 courts · going ahead");
  assert.equal(courtNote(s(2, { starts_at: at(6) }))!.text, "2 courts · coach is confirming");
});

function setup() {
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()));
  const ctxFor = async (userId: string): Promise<Ctx> => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    return { store, actor, now: new Date() };
  };
  return { store, ctxFor };
}

async function twoCourts(store: MemoryStore, ctxFor: (id: string) => Promise<Ctx>, players: number) {
  const start = new Date(Date.now() + 20 * 3600000);
  const s: Session = {
    id: crypto.randomUUID(), session_type: "group", title: "",
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60000).toISOString(),
    coach_ids: [DEMO_IDS.kaan], capacity: 12, price_cents: 2500, location: "Balboa", court: null,
    status: "published", description: "", internal_notes: "", created_at: new Date().toISOString(),
  };
  await store.insert("sessions", s);
  const members = demoSeed().profiles.filter((p) => p.role === "member").map((p) => p.id);
  assert.ok(members.length >= players);
  for (const id of members.slice(0, players)) {
    assert.equal((await runAction(await ctxFor(id), "bookSession", { session_id: s.id })).ok, true);
    await new Promise((r) => setTimeout(r, 2)); // distinct sign-up times
  }
  return { s, members };
}

test("a coach can run an under-filled session on two courts", async () => {
  const { store, ctxFor } = setup();
  const { s } = await twoCourts(store, ctxFor, 7);
  const r = await runAction(await ctxFor(DEMO_IDS.kaan), "decideSession", { session_id: s.id, choice: "run" });
  assert.equal(r.ok, true);
  const after = (await store.get("sessions", s.id))!;
  assert.ok(after.decided_at);
  assert.equal(after.capacity, 12);
  assert.equal(needsDecision({ ...after, booked: 7 }), false);
});

test("dropping to one court keeps the earliest sign-ups and waitlists the rest first", async () => {
  const { store, ctxFor } = setup();
  const { s, members } = await twoCourts(store, ctxFor, 8);
  const r = await runAction(await ctxFor(DEMO_IDS.kaan), "decideSession", { session_id: s.id, choice: "one_court" });
  assert.equal(r.ok, true);
  assert.match((r as { message: string }).message, /2 players moved to the waitlist/);
  assert.equal((await store.get("sessions", s.id))!.capacity, 6);
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  const status = (id: string) => bookings.find((b) => b.user_id === id)!;
  for (const id of members.slice(0, 6)) assert.equal(status(id).status, "confirmed");
  assert.deepEqual(members.slice(6, 8).map((id) => [status(id).status, status(id).waitlist_position]), [["waitlisted", 1], ["waitlisted", 2]]);
});

test("cancelling an under-filled session cancels every booking", async () => {
  const { store, ctxFor } = setup();
  const { s } = await twoCourts(store, ctxFor, 3);
  const r = await runAction(await ctxFor(DEMO_IDS.kaan), "decideSession", { session_id: s.id, choice: "cancel" });
  assert.match((r as { message: string }).message, /3 players/);
  assert.equal((await store.get("sessions", s.id))!.status, "cancelled");
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  assert.ok(bookings.every((b) => b.status === "cancelled" && b.cancel_reason === "Not enough players for two courts"));
});

test("only the session's coaches can decide", async () => {
  const { store, ctxFor } = setup();
  const { s, members } = await twoCourts(store, ctxFor, 2);
  assert.equal((await runAction(await ctxFor(members[0]), "decideSession", { session_id: s.id, choice: "run" })).ok, false);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.leo), "decideSession", { session_id: s.id, choice: "run" })).ok, true); // Leo is an admin
});

test("booking a short two-court session says what happens if it stays short", () => {
  const view = (booked: number) => ({ session_type: "group", capacity: 12, booked, status: "published", decided_at: null, starts_at: new Date(Date.now() + 48 * 3600000).toISOString() }) as unknown as SessionView;
  assert.match(courtHeadsUp(view(2))!, /^Runs on 2 courts once 10 sign up \(3 with you\)\. If it's short, your coach decides by .+: run it anyway, move to one court of 6, or cancel\.$/);
  assert.equal(courtHeadsUp(view(9)), null); // the 10th player tips it over
  assert.equal(courtHeadsUp({ ...view(2), decided_at: new Date().toISOString() } as SessionView), null);
});

test("the coach's home lists their short two-court sessions, whatever week is on screen", async () => {
  const { store, ctxFor } = setup();
  const { s } = await twoCourts(store, ctxFor, 4);
  const coach = (await ctxFor(DEMO_IDS.kaan)).actor;
  const load = (week?: string) => loadCoachSchedule({ store, actor: coach, params: {}, search: week ? { week } : {}, now: new Date() });
  const mine = (await load()).to_decide.find((d) => d.id === s.id);
  assert.ok(mine);
  assert.equal(mine.booked, 4);
  assert.equal(mine.minimum, 10);
  assert.ok((await load("2027-03-01")).to_decide.some((d) => d.id === s.id));
  await runAction(await ctxFor(DEMO_IDS.kaan), "decideSession", { session_id: s.id, choice: "run" });
  assert.equal((await load()).to_decide.some((d) => d.id === s.id), false);
});
