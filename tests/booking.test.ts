import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS, PROGRAM_SEEDS } from "../src/core/seed";
import { priceFor, runAction, type Ctx, type OutgoingMessage } from "../src/core/services";
import type { Actor, DB, Session } from "../src/core/types";
import { zonedToUtc, addDays, dateKey } from "../src/core/time";
import { matchRoute, guard } from "../src/core/routes";

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const sent: OutgoingMessage[] = [];
  const ctxFor = async (userId: string, at = now): Promise<Ctx> => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    return { store, actor, now: at, notify: async (m) => void sent.push(m) };
  };
  return { store, ctxFor, sent, now };
}

async function freshGroupSession(store: MemoryStore, capacity: number, startsInHours = 72): Promise<Session> {
  const start = new Date(Date.now() + startsInHours * 3600000);
  const s: Session = {
    id: crypto.randomUUID(), program_id: PROGRAM_SEEDS[2].id, title: "Test clinic",
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60000).toISOString(),
    coach_ids: [DEMO_IDS.leo], capacity, price_cents: 4000, pricing: "per_participant", location: "Court 1",
    status: "published", visibility: "public", description: "", internal_notes: "", skill_level: "", template_id: null,
    created_at: new Date().toISOString(),
  };
  await store.insert("sessions", s);
  return s;
}

const memberIds = (db: DB) => db.profiles.filter((p) => p.role === "member").map((p) => p.id);

test("books until full, then waitlists in order", async () => {
  const { store, ctxFor } = setup();
  const s = await freshGroupSession(store, 2);
  const ids = memberIds(demoSeed());
  for (const uid of ids.slice(0, 2)) assert.equal((await runAction(await ctxFor(uid), "bookSession", { session_id: s.id })).ok, true);
  const r3 = await runAction(await ctxFor(ids[2]), "bookSession", { session_id: s.id });
  assert.equal(r3.ok, true);
  assert.match((r3 as { message: string }).message, /#1 on the waitlist/);
  const r4 = await runAction(await ctxFor(ids[3]), "bookSession", { session_id: s.id });
  assert.match((r4 as { message: string }).message, /#2/);
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(bookings.filter((b) => b.status === "confirmed").length, 2);
  assert.equal(bookings.filter((b) => b.status === "waitlisted").length, 2);
});

test("prevents double booking", async () => {
  const { store, ctxFor } = setup();
  const s = await freshGroupSession(store, 4);
  const ctx = await ctxFor(DEMO_IDS.sam);
  assert.equal((await runAction(ctx, "bookSession", { session_id: s.id })).ok, true);
  const again = await runAction(ctx, "bookSession", { session_id: s.id });
  assert.equal(again.ok, false);
});

test("concurrent bookings never exceed capacity", async () => {
  const { store, ctxFor } = setup();
  const s = await freshGroupSession(store, 3);
  const ids = memberIds(demoSeed()).slice(0, 10);
  const ctxs = await Promise.all(ids.map((id) => ctxFor(id)));
  await Promise.all(ctxs.map((c) => runAction(c, "bookSession", { session_id: s.id })));
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(bookings.filter((b) => b.status === "confirmed").length, 3);
  assert.equal(bookings.filter((b) => b.status === "waitlisted").length, 7);
  const positions = bookings.filter((b) => b.status === "waitlisted").map((b) => b.waitlist_position).sort((a, b) => a! - b!);
  assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7]);
});

test("cancelling promotes the first waitlisted player and notifies them", async () => {
  const { store, ctxFor, sent } = setup();
  const s = await freshGroupSession(store, 1);
  const [a, b, c] = memberIds(demoSeed());
  await runAction(await ctxFor(a), "bookSession", { session_id: s.id });
  await runAction(await ctxFor(b), "bookSession", { session_id: s.id });
  await runAction(await ctxFor(c), "bookSession", { session_id: s.id });
  const mine = (await store.list("bookings", { eq: { session_id: s.id, user_id: a } }))[0];
  const res = await runAction(await ctxFor(a), "cancelBooking", { booking_id: mine.id });
  assert.equal(res.ok, true);
  const after = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(after.find((x) => x.user_id === b)!.status, "confirmed");
  assert.equal(after.find((x) => x.user_id === c)!.waitlist_position, 1);
  assert.ok(sent.some((m) => m.to.id === b && /You're in/.test(m.subject)));
});

test("flags late cancellations inside the policy window", async () => {
  const { store, ctxFor } = setup();
  const s = await freshGroupSession(store, 4, 5); // starts in 5 hours, window is 24
  const ctx = await ctxFor(DEMO_IDS.sam);
  await runAction(ctx, "bookSession", { session_id: s.id });
  const b = (await store.list("bookings", { eq: { session_id: s.id } }))[0];
  const res = await runAction(ctx, "cancelBooking", { booking_id: b.id });
  assert.equal(res.ok, true);
  assert.equal((await store.get("bookings", b.id))!.late_cancel, true);
});

test("members cannot use admin or coach actions", async () => {
  const { store, ctxFor } = setup();
  const s = await freshGroupSession(store, 4);
  const ctx = await ctxFor(DEMO_IDS.sam);
  const r1 = await runAction(ctx, "setSessionStatus", { session_id: s.id, status: "cancelled" });
  assert.equal(r1.ok, false);
  const r2 = await runAction(ctx, "addNote", { player_id: DEMO_IDS.sam, body: "hi", visibility: "shared" });
  assert.equal(r2.ok, false);
  const other = (await store.list("bookings")).find((b) => b.user_id !== DEMO_IDS.sam)!;
  const r3 = await runAction(ctx, "cancelBooking", { booking_id: other.id });
  assert.equal(r3.ok, false);
});

test("semi-private bookings with a partner take two seats and need approval", async () => {
  const { store, ctxFor } = setup();
  const day = addDays(dateKey(new Date()), 5);
  const start = zonedToUtc(day, "16:00");
  const s: Session = {
    id: crypto.randomUUID(), program_id: PROGRAM_SEEDS[1].id, title: "", starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3600000).toISOString(), coach_ids: [DEMO_IDS.leo], capacity: 2, price_cents: 11000,
    pricing: "per_session", location: "", status: "published", visibility: "public", description: "", internal_notes: "",
    skill_level: "", template_id: null, created_at: new Date().toISOString(),
  };
  await store.insert("sessions", s);
  await runAction(await ctxFor(DEMO_IDS.sam), "bookSession", { session_id: s.id, guest_name: "Alex" });
  const b = (await store.list("bookings", { eq: { session_id: s.id } }))[0];
  assert.equal(b.seats, 2);
  assert.equal(b.status, "pending"); // semi-private requires approval by default
  assert.equal(priceFor(s, b.seats), 11000);
});

test("admin approves a lesson request into a private session", async () => {
  const { store, ctxFor } = setup();
  const req = (await store.list("lesson_requests"))[0];
  const res = await runAction(await ctxFor(DEMO_IDS.leo), "approveRequest", {
    request_id: req.id, date: req.preferred_date, time: req.preferred_time, duration_min: 60, coach_id: DEMO_IDS.leo, location: "", admin_note: "See you there",
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  const upd = await store.get("lesson_requests", req.id);
  assert.equal(upd!.status, "approved");
  const s = await store.get("sessions", upd!.session_id!);
  assert.equal(s!.visibility, "private");
  const b = await store.list("bookings", { eq: { session_id: s!.id } });
  assert.equal(b[0].status, "confirmed");
});

test("generates sessions from published templates only, without duplicates", async () => {
  const { store, ctxFor } = setup();
  const admin = await ctxFor(DEMO_IDS.leo);
  const none = await runAction(admin, "generateFromTemplates", { weeks: 2, publish: false });
  assert.equal(none.ok, false); // all templates start unpublished
  const t = (await store.list("schedule_templates"))[0];
  await store.update("schedule_templates", t.id, { published: true });
  const first = await runAction(admin, "generateFromTemplates", { weeks: 2, publish: false });
  assert.equal(first.ok, true);
  const created = (await store.list("sessions", { eq: { template_id: t.id } })).length;
  assert.ok(created >= 1 && created <= 2);
  await runAction(admin, "generateFromTemplates", { weeks: 2, publish: false });
  assert.equal((await store.list("sessions", { eq: { template_id: t.id } })).length, created);
  assert.ok((await store.list("sessions", { eq: { template_id: t.id } })).every((s) => s.status === "draft"));
});

test("routes and guards separate the three portals", () => {
  assert.equal(matchRoute("/admin/sessions/new")!.route.id, "a.session");
  assert.equal(matchRoute("/coach/players/abc")!.params.id, "abc");
  const member = { auth_id: "x", identifier: "a@b.c", user: { role: "member", onboarded: true, status: "active" } } as unknown as Actor;
  const coach = { ...member, user: { ...member.user!, role: "coach" } } as Actor;
  assert.equal(guard("admin", member, "/admin"), "/app");
  assert.equal(guard("coach", member, "/coach"), "/app");
  assert.equal(guard("admin", coach, "/admin"), "/coach");
  assert.equal(guard("coach", coach, "/coach"), null);
  assert.match(guard("member", { auth_id: null, identifier: null, user: null }, "/app")!, /^\/login/);
});
