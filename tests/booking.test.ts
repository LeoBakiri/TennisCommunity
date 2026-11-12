import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import type { Actor, DB, Session } from "../src/core/types";
import { addDays, dateKey } from "../src/core/time";
import { matchRoute, guard, retiredRedirect } from "../src/core/routes";
import { loadAdminCoaches, loadAdminMember, loadCoachEarnings, loadCoachSchedule, loadSchedule } from "../src/core/queries";

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const ctxFor = async (userId: string, at = now): Promise<Ctx> => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    return { store, actor, now: at };
  };
  const load = async (userId: string | null, params: Record<string, string> = {}) => {
    const user = userId ? await store.get("profiles", userId) : null;
    return { store, actor: { auth_id: userId, identifier: null, user }, params, search: {}, now };
  };
  return { store, ctxFor, load, now };
}

async function freshSession(store: MemoryStore, capacity: number, startsInHours = 72): Promise<Session> {
  const start = new Date(Date.now() + startsInHours * 3600000);
  const s: Session = {
    id: crypto.randomUUID(), session_type: "group", title: "",
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60000).toISOString(),
    coach_ids: [DEMO_IDS.leo], capacity, price_cents: 4000, location: "Court 1", court: null,
    status: "published", description: "", internal_notes: "", created_at: new Date().toISOString(),
  };
  await store.insert("sessions", s);
  return s;
}

const memberIds = (db: DB) => db.profiles.filter((p) => p.role === "member").map((p) => p.id);
const lessonInput = { kind: "private", client_names: "Rachel Green", date: addDays(dateKey(new Date()), 2), time: "12:00", duration_min: 60, location: "Balboa", price: "100", notes: "" };

test("books until full, then waitlists in order", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 2);
  const ids = memberIds(demoSeed());
  for (const uid of ids.slice(0, 2)) assert.equal((await runAction(await ctxFor(uid), "bookSession", { session_id: s.id })).ok, true);
  const r3 = await runAction(await ctxFor(ids[2]), "bookSession", { session_id: s.id });
  assert.equal(r3.ok, true);
  assert.match((r3 as { message: string }).message, /next in line/);
  const r4 = await runAction(await ctxFor(ids[3]), "bookSession", { session_id: s.id });
  assert.match((r4 as { message: string }).message, /#2/);
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(bookings.filter((b) => b.status === "confirmed").length, 2);
  assert.equal(bookings.filter((b) => b.status === "waitlisted").length, 2);
});

test("prevents double booking", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4);
  const ctx = await ctxFor(DEMO_IDS.sam);
  assert.equal((await runAction(ctx, "bookSession", { session_id: s.id })).ok, true);
  assert.equal((await runAction(ctx, "bookSession", { session_id: s.id })).ok, false);
});

test("concurrent bookings never exceed capacity", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 3);
  const ids = memberIds(demoSeed()).slice(0, 10);
  const ctxs = await Promise.all(ids.map((id) => ctxFor(id)));
  await Promise.all(ctxs.map((c) => runAction(c, "bookSession", { session_id: s.id })));
  const bookings = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(bookings.filter((b) => b.status === "confirmed").length, 3);
  const positions = bookings.filter((b) => b.status === "waitlisted").map((b) => b.waitlist_position).sort((a, b) => a! - b!);
  assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7]);
});

test("cancelling moves the first waitlisted player in and renumbers the rest", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1);
  const [a, b, c] = memberIds(demoSeed());
  for (const uid of [a, b, c]) await runAction(await ctxFor(uid), "bookSession", { session_id: s.id });
  const mine = (await store.list("bookings", { eq: { session_id: s.id, user_id: a } }))[0];
  assert.equal((await runAction(await ctxFor(a), "cancelBooking", { booking_id: mine.id })).ok, true);
  const after = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(after.find((x) => x.user_id === b)!.status, "confirmed");
  assert.equal(after.find((x) => x.user_id === c)!.waitlist_position, 1);
});

test("inside the window players can't cancel a booked spot, but can leave the waitlist", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1, 5); // starts in 5 hours, window is 24
  const [a, b] = memberIds(demoSeed());
  for (const uid of [a, b]) await runAction(await ctxFor(uid), "bookSession", { session_id: s.id });
  const [booked, waiting] = await Promise.all([a, b].map(async (uid) => (await store.list("bookings", { eq: { session_id: s.id, user_id: uid } }))[0]));
  const r = await runAction(await ctxFor(a), "cancelBooking", { booking_id: booked.id });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Offer your spot/);
  assert.equal((await store.get("bookings", booked.id))!.status, "confirmed");
  assert.equal((await runAction(await ctxFor(b), "cancelBooking", { booking_id: waiting.id })).ok, true);
});

test("coaches can still remove a player inside the window", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 2, 5);
  await runAction(await ctxFor(DEMO_IDS.sam), "bookSession", { session_id: s.id });
  const b = (await store.list("bookings", { eq: { session_id: s.id } }))[0];
  assert.equal((await runAction(await ctxFor(DEMO_IDS.leo), "cancelBooking", { booking_id: b.id, reason: "Removed by coach" })).ok, true);
  assert.equal((await store.get("bookings", b.id))!.status, "cancelled");
});

async function offeredSession(store: MemoryStore, ctxFor: (id: string) => Promise<Ctx>) {
  const s = await freshSession(store, 1, 5);
  const [a, b, c, d] = memberIds(demoSeed());
  for (const uid of [a, b, c]) await runAction(await ctxFor(uid), "bookSession", { session_id: s.id });
  const offer = (await store.list("bookings", { eq: { session_id: s.id, user_id: a } }))[0];
  assert.equal((await runAction(await ctxFor(a), "offerSpot", { booking_id: offer.id })).ok, true);
  return { s, offer, a, b, c, d };
}

test("an offered spot stays booked until someone takes it", async () => {
  const { store, ctxFor, load } = setup();
  const { s, offer, a } = await offeredSession(store, ctxFor);
  const still = (await store.get("bookings", offer.id))!;
  assert.equal(still.status, "confirmed");
  assert.ok(still.spot_offered_at);
  const view = (await loadSchedule(await load(a))).days.flatMap((d) => d.sessions).find((x) => x.id === s.id)!;
  assert.equal(view.offered, 1);
  assert.equal(view.spots_left, 0);
  assert.ok(view.my_booking?.spot_offered_at);
});

test("a waitlisted player who takes the spot is booked and the first player is let off", async () => {
  const { store, ctxFor } = setup();
  const { s, offer, a, c } = await offeredSession(store, ctxFor);
  // The second on the waitlist can take it: first to tap wins.
  assert.equal((await runAction(await ctxFor(c), "takeSpot", { session_id: s.id })).ok, true);
  const after = await store.list("bookings", { eq: { session_id: s.id } });
  const gone = after.find((x) => x.id === offer.id)!;
  assert.equal(gone.status, "cancelled");
  assert.equal(gone.late_cancel, false);
  assert.match(gone.cancel_reason, /^Handed over to /);
  assert.equal(after.find((x) => x.user_id === c && x.status !== "cancelled")!.status, "confirmed");
  assert.equal(after.filter((x) => x.status === "confirmed").length, 1);
  const wl = after.filter((x) => x.status === "waitlisted");
  assert.deepEqual(wl.map((x) => x.waitlist_position), [1]);
  assert.equal((await runAction(await ctxFor(a), "withdrawOffer", { booking_id: offer.id })).ok, false);
});

test("a player not on the waitlist can take an offered spot too", async () => {
  const { store, ctxFor } = setup();
  const { s, d } = await offeredSession(store, ctxFor);
  assert.equal((await runAction(await ctxFor(d), "takeSpot", { session_id: s.id })).ok, true);
  const mine = (await store.list("bookings", { eq: { session_id: s.id, user_id: d } }))[0];
  assert.equal(mine.status, "confirmed");
});

test("only one player gets an offered spot", async () => {
  const { store, ctxFor } = setup();
  const { s, b, c, d } = await offeredSession(store, ctxFor);
  const results = await Promise.all([b, c, d].map(async (uid) => runAction(await ctxFor(uid), "takeSpot", { session_id: s.id })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  const all = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(all.filter((x) => x.status === "confirmed").length, 1);
});

test("taking the offer back keeps the spot, and nothing is left to take", async () => {
  const { store, ctxFor } = setup();
  const { s, offer, a, b } = await offeredSession(store, ctxFor);
  assert.equal((await runAction(await ctxFor(a), "withdrawOffer", { booking_id: offer.id })).ok, true);
  assert.equal((await store.get("bookings", offer.id))!.spot_offered_at, null);
  assert.equal((await runAction(await ctxFor(b), "takeSpot", { session_id: s.id })).ok, false);
  assert.equal((await store.get("bookings", offer.id))!.status, "confirmed");
});

test("players can't offer someone else's spot or take their own", async () => {
  const { store, ctxFor } = setup();
  const { s, offer, a, b } = await offeredSession(store, ctxFor);
  assert.equal((await runAction(await ctxFor(b), "offerSpot", { booking_id: offer.id })).ok, false);
  assert.equal((await runAction(await ctxFor(b), "withdrawOffer", { booking_id: offer.id })).ok, false);
  assert.equal((await runAction(await ctxFor(a), "takeSpot", { session_id: s.id })).ok, false);
});

test("players cannot use admin or coach actions", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4);
  const ctx = await ctxFor(DEMO_IDS.sam);
  assert.equal((await runAction(ctx, "setSessionStatus", { session_id: s.id, status: "cancelled" })).ok, false);
  assert.equal((await runAction(ctx, "saveLesson", lessonInput)).ok, false);
  assert.equal((await runAction(ctx, "saveSessionNotes", { session_id: s.id, internal_notes: "hi" })).ok, false);
  const other = (await store.list("bookings")).find((b) => b.user_id !== DEMO_IDS.sam)!;
  assert.equal((await runAction(ctx, "cancelBooking", { booking_id: other.id })).ok, false);
});

test("the schedule shows only community sessions, never lessons or drafts", async () => {
  const { load } = setup();
  const data = await loadSchedule(await load(null));
  const shown = data.days.flatMap((d) => d.sessions);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((s) => s.session_type && s.status === "published"));
  assert.ok(!JSON.stringify(data).includes("Rachel Green"));
});

test("retired rows without a session type can't be seen or booked", async () => {
  const { store, ctxFor, load } = setup();
  const s = await freshSession(store, 4);
  await store.update("sessions", s.id, { session_type: null });
  assert.equal((await runAction(await ctxFor(DEMO_IDS.sam), "bookSession", { session_id: s.id })).ok, false);
  const data = await loadSchedule(await load(null));
  assert.ok(!data.days.flatMap((d) => d.sessions).some((x) => x.id === s.id));
});

test("a coach's schedule combines their community sessions and their own lessons only", async () => {
  const { store, load } = setup();
  const data = await loadCoachSchedule(await load(DEMO_IDS.maya));
  const labels = new Set(data.items.map((i) => i.label));
  assert.ok(labels.has("Group Session") && labels.has("Performance Accelerator") && labels.has("Private Lesson"));
  const mine = await store.list("lessons", { eq: { coach_id: DEMO_IDS.maya } });
  assert.ok(data.items.filter((i) => i.href.startsWith("/coach/lessons")).every((i) => mine.some((l) => l.id === i.id)));
  assert.ok(!JSON.stringify(data).includes("Rachel Green")); // Leo's client
});

test("coaches add, change and delete their own lessons; others can't touch them", async () => {
  const { store, ctxFor } = setup();
  const maya = await ctxFor(DEMO_IDS.maya);
  assert.equal((await runAction(maya, "saveLesson", { ...lessonInput, client_names: "Outside Client" })).ok, true);
  const l = (await store.list("lessons")).find((x) => x.client_names[0] === "Outside Client")!;
  assert.equal(l.coach_id, DEMO_IDS.maya);
  assert.equal(l.price_cents, 10000);
  assert.equal(new Date(l.ends_at).getTime() - new Date(l.starts_at).getTime(), 3600000);
  // An admin who isn't the coach can't change it: lessons stay owned by the coach.
  const leo = await ctxFor(DEMO_IDS.leo);
  assert.equal((await runAction(leo, "saveLesson", { ...lessonInput, id: l.id })).ok, false);
  assert.equal((await runAction(leo, "deleteLesson", { lesson_id: l.id })).ok, false);
  assert.equal((await runAction(maya, "saveLesson", { ...lessonInput, id: l.id, client_names: "Renamed", duration_min: 90 })).ok, true);
  assert.equal((await store.get("lessons", l.id))!.client_names[0], "Renamed");
  assert.equal((await runAction(maya, "deleteLesson", { lesson_id: l.id })).ok, true);
  assert.equal(await store.get("lessons", l.id), null);
});

test("semi-private lessons take several clients and require at least two", async () => {
  const { store, ctxFor } = setup();
  const maya = await ctxFor(DEMO_IDS.maya);
  assert.equal((await runAction(maya, "saveLesson", { ...lessonInput, kind: "semi_private", client_names: "Solo" })).ok, false);
  assert.equal((await runAction(maya, "saveLesson", { ...lessonInput, kind: "semi_private", client_names: "Ann, Bo, Cy" })).ok, true);
  assert.ok((await store.list("lessons")).some((l) => l.client_names.join() === "Ann,Bo,Cy"));
});

test("admin creates sessions with the two types; only the Accelerator keeps a focus", async () => {
  const { store, ctxFor } = setup();
  const leo = await ctxFor(DEMO_IDS.leo);
  const base = { date: addDays(dateKey(new Date()), 4), time: "18:00", duration_min: 60, capacity: 8, price: "40", location: "", coach_ids: [DEMO_IDS.maya], status: "published", description: "Sunset", internal_notes: "" };
  const a = await runAction(leo, "saveSession", { ...base, session_type: "performance_accelerator", title: "Approach + Volley" });
  const g = await runAction(leo, "saveSession", { ...base, session_type: "group", title: "ignored" });
  assert.ok(a.ok && g.ok);
  const id = (r: typeof a) => (r as { redirect: string }).redirect.split("/").pop()!;
  assert.equal((await store.get("sessions", id(a)))!.title, "Approach + Volley");
  const group = (await store.get("sessions", id(g)))!;
  assert.equal(group.title, "");
  assert.equal(group.location, "Balboa Tennis Club, San Diego"); // falls back to the default
  assert.equal((await runAction(leo, "saveSession", { ...base, session_type: "sunset" })).ok, false);
});

test("raising capacity moves waitlisted players in", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1);
  const [a, b] = memberIds(demoSeed());
  for (const uid of [a, b]) await runAction(await ctxFor(uid), "bookSession", { session_id: s.id });
  const r = await runAction(await ctxFor(DEMO_IDS.leo), "saveSession", { id: s.id, session_type: "group", date: dateKey(s.starts_at), time: "18:00", duration_min: 60, capacity: 2, price: "40", location: "x", coach_ids: [], status: "published", description: "", internal_notes: "" });
  assert.equal(r.ok, true);
  assert.equal((await store.list("bookings", { eq: { session_id: s.id, user_id: b } }))[0].status, "confirmed");
});

test("coaches edit notes and attendance only for sessions they're assigned to", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4); // assigned to Leo
  const maya = await ctxFor(DEMO_IDS.maya);
  assert.equal((await runAction(maya, "saveSessionNotes", { session_id: s.id, internal_notes: "x" })).ok, false);
  await store.update("sessions", s.id, { coach_ids: [DEMO_IDS.maya] });
  assert.equal((await runAction(maya, "saveSessionNotes", { session_id: s.id, internal_notes: "Bring cones" })).ok, true);
  assert.equal((await store.get("sessions", s.id))!.internal_notes, "Bring cones");
});

test("the coaches page shows each coach's earnings, matching their own Earnings page, without client names", async () => {
  const { load } = setup();
  for (const period of ["week", "month", "year"]) {
    const data = await loadAdminCoaches({ ...(await load(DEMO_IDS.leo)), search: { period } });
    assert.equal(data.period, period);
    for (const id of [DEMO_IDS.leo, DEMO_IDS.maya]) {
      const own = await loadCoachEarnings({ ...(await load(id)), search: { period } });
      const row = data.coaches.find((c) => c.id === id)!;
      assert.equal(row.earned.net, own.totals.net);
      assert.equal(row.lessons.count, own.totals.lessons);
      assert.equal(row.community.count, own.totals.sessions);
      assert.equal(row.community.net, own.sessions.filter((r) => r.done).reduce((n, r) => n + r.money.net, 0));
      assert.deepEqual(row.payday, own.paydays[0] ?? null);
      assert.equal(row.booked.net, own.scheduled.net);
      assert.equal(row.previous, own.previous.net);
      assert.equal(row.owed.total, own.owed.total);
      assert.equal(row.chart.length, own.chart.length);
    }
    assert.equal(data.totals.net, data.coaches.reduce((n, c) => n + c.earned.net, 0));
    assert.ok(!JSON.stringify(data).includes("Amir Sadeghi"));
  }
  const month = await loadAdminCoaches(await load(DEMO_IDS.leo));
  assert.equal(month.period, "month");
  assert.ok(month.totals.net > 0 || month.totals.booked > 0);
});

test("routes and guards separate player, coach and admin", () => {
  assert.equal(matchRoute("/admin/sessions/new")!.route.id, "a.session");
  assert.equal(matchRoute("/")!.route.id, "schedule");
  const anon: Actor = { auth_id: null, identifier: null, user: null };
  const member = { auth_id: "x", identifier: "a@b.c", user: { role: "member", onboarded: true, status: "active" } } as unknown as Actor;
  const coach = { ...member, user: { ...member.user!, role: "coach" } } as Actor;
  const admin = { ...member, user: { ...member.user!, role: "admin" } } as Actor;
  assert.equal(guard("public", anon, "/"), null);
  assert.equal(guard("public", member, "/"), null);
  assert.equal(guard("public", coach, "/"), "/coach");
  assert.equal(guard("public", coach, "/schedule"), null);
  assert.equal(guard("public", admin, "/"), "/admin");
  assert.equal(guard("admin", member, "/admin"), "/schedule");
  assert.equal(guard("coach", member, "/coach"), "/schedule");
  assert.equal(guard("admin", coach, "/admin"), "/coach");
  assert.equal(guard("coach", coach, "/coach"), null);
  assert.equal(guard("coach", admin, "/coach"), null);
  assert.match(guard("member", anon, "/my-sessions")!, /^\/login/);
});

test("old links land on the page that replaced them", () => {
  assert.equal(retiredRedirect("/app"), "/schedule");
  assert.equal(retiredRedirect("/app/sessions/abc"), "/schedule");
  assert.equal(retiredRedirect("/app/bookings"), "/my-sessions");
  assert.equal(retiredRedirect("/programs/sunset-tennis"), "/schedule");
  assert.equal(retiredRedirect("/coach/calendar"), "/coach");
  assert.equal(retiredRedirect("/admin/announcements"), "/admin");
  assert.equal(retiredRedirect("/admin/sessions"), "/admin");
  assert.equal(retiredRedirect("/admin/sessions/abc"), null);
  assert.equal(retiredRedirect("/my-sessions"), null);
});

const memberEdit = { full_name: "Sam Renamed", email: "sam.new@example.com", phone: "(619) 555-0199", emergency_contact: "Pat, 619 555 0100", role: "coach", status: "active" };

test("an admin can edit a member's details and role", async () => {
  const { store, ctxFor } = setup();
  const r = await runAction(await ctxFor(DEMO_IDS.leo), "adminUpdateMember", { user_id: DEMO_IDS.sam, ...memberEdit });
  assert.equal(r.ok, true);
  const p = await store.get("profiles", DEMO_IDS.sam);
  assert.equal(p?.full_name, "Sam Renamed");
  assert.equal(p?.email, "sam.new@example.com");
  assert.equal(p?.emergency_contact, "Pat, 619 555 0100");
  assert.equal(p?.role, "coach");
});

test("member editing is admin-only and rejects another member's email", async () => {
  const { store, ctxFor } = setup();
  assert.equal((await runAction(await ctxFor(DEMO_IDS.maya), "adminUpdateMember", { user_id: DEMO_IDS.sam, ...memberEdit })).ok, false);
  const maya = await store.get("profiles", DEMO_IDS.maya);
  const taken = await runAction(await ctxFor(DEMO_IDS.leo), "adminUpdateMember", { user_id: DEMO_IDS.sam, ...memberEdit, email: maya!.email, phone: "" });
  assert.equal(taken.ok, false);
});

test("an admin can't deactivate, demote or remove themselves", async () => {
  const { store, ctxFor } = setup();
  const ctx = await ctxFor(DEMO_IDS.leo);
  const leo = await store.get("profiles", DEMO_IDS.leo);
  const self = { user_id: DEMO_IDS.leo, full_name: leo!.full_name, email: leo!.email, phone: "", emergency_contact: "" };
  assert.equal((await runAction(ctx, "adminUpdateMember", { ...self, role: "admin", status: "inactive" })).ok, false);
  assert.equal((await runAction(ctx, "adminUpdateMember", { ...self, role: "member", status: "active" })).ok, false);
  assert.equal((await runAction(ctx, "adminRemoveMember", { user_id: DEMO_IDS.leo })).ok, false);
  assert.ok(await store.get("profiles", DEMO_IDS.leo));
});

test("removing a member frees their seat for the waitlist and clears their data", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.sam), "bookSession", { session_id: s.id })).ok, true);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.maya), "bookSession", { session_id: s.id })).ok, true);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.maya), "adminRemoveMember", { user_id: DEMO_IDS.sam })).ok, false);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.leo), "adminRemoveMember", { user_id: DEMO_IDS.sam })).ok, true);
  assert.equal(await store.get("profiles", DEMO_IDS.sam), null);
  const left = await store.list("bookings", { eq: { session_id: s.id } });
  assert.equal(left.length, 1);
  assert.equal(left[0].user_id, DEMO_IDS.maya);
  assert.equal(left[0].status, "confirmed");
});

test("removing a coach takes them off sessions and deletes their lessons", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4);
  await store.update("sessions", s.id, { coach_ids: [DEMO_IDS.leo, DEMO_IDS.kaan] });
  assert.equal((await runAction(await ctxFor(DEMO_IDS.kaan), "saveLesson", lessonInput)).ok, true);
  assert.equal((await runAction(await ctxFor(DEMO_IDS.leo), "adminRemoveMember", { user_id: DEMO_IDS.kaan })).ok, true);
  assert.deepEqual((await store.get("sessions", s.id))?.coach_ids, [DEMO_IDS.leo]);
  assert.equal((await store.list("lessons", { eq: { coach_id: DEMO_IDS.kaan } })).length, 0);
});

test("Balboa sessions and lessons keep a court; other places drop it", async () => {
  const { store, ctxFor } = setup();
  const leo = await ctxFor(DEMO_IDS.leo);
  const base = { session_type: "group", date: addDays(dateKey(new Date()), 4), time: "18:00", duration_min: 60, capacity: 8, price: "40", coach_ids: [DEMO_IDS.leo], status: "published", description: "", internal_notes: "" };
  const id = (r: Awaited<ReturnType<typeof runAction>>) => (r as { redirect: string }).redirect.split("/").pop()!;
  const balboa = id(await runAction(leo, "saveSession", { ...base, location: "", court: "3" }));
  assert.equal((await store.get("sessions", balboa))!.court, 3);
  const park = id(await runAction(leo, "saveSession", { ...base, location: "Morley Field", court: "3" }));
  assert.equal((await store.get("sessions", park))!.court, null);
  assert.equal((await runAction(leo, "saveSession", { ...base, location: "", court: "5" })).ok, false);

  assert.ok((await runAction(leo, "saveLesson", { ...lessonInput, court: "2" })).ok);
  assert.equal((await store.list("lessons")).find((l) => l.client_names.join() === "Rachel Green" && l.court === 2)?.location, "Balboa");
});

test("an admin can change a session's court", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4);
  const leo = await ctxFor(DEMO_IDS.leo);
  const form = (court: string) => ({
    id: s.id, session_type: "group", date: dateKey(s.starts_at), time: new Date(s.starts_at).toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" }),
    duration_min: 90, capacity: 4, price: "40", location: "Balboa Tennis Club, San Diego", court, coach_ids: [DEMO_IDS.leo], status: "published", description: "", internal_notes: "",
  });
  assert.ok((await runAction(leo, "saveSession", form("1"))).ok);
  assert.ok((await runAction(leo, "saveSession", form("2"))).ok);
  assert.equal((await store.get("sessions", s.id))!.court, 2);
  assert.ok((await runAction(leo, "saveSession", form(""))).ok);
  assert.equal((await store.get("sessions", s.id))!.court, null);
});

test("booking says where the player landed, so the confirmation can't show a stale guess", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1);
  const [a, b] = memberIds(demoSeed());
  const first = await runAction(await ctxFor(a), "bookSession", { session_id: s.id });
  assert.deepEqual(first.ok && first.data, { status: "confirmed", waitlist_position: null });
  const second = await runAction(await ctxFor(b), "bookSession", { session_id: s.id });
  assert.deepEqual(second.ok && second.data, { status: "waitlisted", waitlist_position: 1 });
});

test("a coach removing a player isn't told they left the waitlist", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 1);
  const [a, b] = memberIds(demoSeed());
  for (const uid of [a, b]) await runAction(await ctxFor(uid), "bookSession", { session_id: s.id });
  const waiting = (await store.list("bookings", { eq: { session_id: s.id, status: "waitlisted" } }))[0];
  const r = await runAction(await ctxFor(DEMO_IDS.leo), "cancelBooking", { booking_id: waiting.id });
  assert.equal(r.ok && r.message, "Taken off the waitlist.");
});

test("admin member history shows the live booking after a cancel and rebook", async () => {
  const { store, ctxFor, load } = setup();
  const s = await freshSession(store, 4);
  const [a] = memberIds(demoSeed());
  await runAction(await ctxFor(a), "bookSession", { session_id: s.id });
  const first = (await store.list("bookings", { eq: { session_id: s.id } }))[0];
  await runAction(await ctxFor(a), "cancelBooking", { booking_id: first.id });
  await runAction(await ctxFor(a), "bookSession", { session_id: s.id });
  const data = await loadAdminMember(await load(DEMO_IDS.leo, { id: a }));
  assert.equal(data.history.find((r) => r.session.id === s.id)?.booking.status, "confirmed");
});
