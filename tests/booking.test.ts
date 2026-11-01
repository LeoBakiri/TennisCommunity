import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import type { Actor, DB, Session } from "../src/core/types";
import { addDays, dateKey } from "../src/core/time";
import { matchRoute, guard, retiredRedirect } from "../src/core/routes";
import { loadAdminCoaches, loadCoachSchedule, loadSchedule } from "../src/core/queries";

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
    coach_ids: [DEMO_IDS.leo], capacity, price_cents: 4000, location: "Court 1",
    status: "published", description: "", internal_notes: "", created_at: new Date().toISOString(),
  };
  await store.insert("sessions", s);
  return s;
}

const memberIds = (db: DB) => db.profiles.filter((p) => p.role === "member").map((p) => p.id);
const lessonInput = { kind: "private", client_names: "Rachel Green", date: addDays(dateKey(new Date()), 2), time: "08:00", duration_min: 60, location: "Balboa", price: "100", notes: "" };

test("books until full, then waitlists in order", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 2);
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

test("flags late cancellations inside the policy window", async () => {
  const { store, ctxFor } = setup();
  const s = await freshSession(store, 4, 5); // starts in 5 hours, window is 24
  const ctx = await ctxFor(DEMO_IDS.sam);
  await runAction(ctx, "bookSession", { session_id: s.id });
  const b = (await store.list("bookings", { eq: { session_id: s.id } }))[0];
  assert.equal((await runAction(ctx, "cancelBooking", { booking_id: b.id })).ok, true);
  assert.equal((await store.get("bookings", b.id))!.late_cancel, true);
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

test("the coaches page shows lesson counts without client names", async () => {
  const { load } = setup();
  const data = await loadAdminCoaches(await load(DEMO_IDS.leo));
  assert.ok(data.coaches.find((c) => c.id === DEMO_IDS.maya)!.lessons >= 1);
  assert.ok(!JSON.stringify(data).includes("Amir Sadeghi"));
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
