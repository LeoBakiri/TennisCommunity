import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadCoachClient, loadCoachClients, loadLessonEditor, type LoadCtx } from "../src/core/queries";
import { clientSummary, nextSameWeekday, overlaps, weeklyDates } from "../src/core/clients";
import type { Actor, Lesson } from "../src/core/types";
import { addDays, dateKey } from "../src/core/time";

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const actor = async (id: string): Promise<Actor> => {
    const user = await store.get("profiles", id);
    return { auth_id: id, identifier: user?.email ?? null, user };
  };
  const ctx = async (id: string): Promise<Ctx> => ({ store, actor: await actor(id), now });
  const load = async (id: string, params: Record<string, string> = {}, search: Record<string, string> = {}): Promise<LoadCtx> => ({ store, actor: await actor(id), params, search, now });
  return { store, ctx, load, now };
}

// Far enough ahead to miss the demo schedule, at an hour nothing else uses.
const free = (weeks = 30) => addDays(dateKey(new Date()), weeks * 7);
const lessonInput = (extra: Record<string, unknown> = {}) => ({ id: "", kind: "private", client_names: "Nadia Brooks", date: free(), time: "12:00", duration_min: 60, location: "Balboa Tennis Club", price: "100", notes: "", ...extra });

const lesson = (l: Partial<Lesson>): Lesson => ({ id: "l", coach_id: "c", kind: "private", client_names: ["Ana"], starts_at: "", ends_at: "", location: "", court: null, price_cents: 10000, commission_cents: 0, paid_at: null, notes: "", created_at: "", updated_at: "", ...l });
const at = (iso: string, mins = 60) => ({ starts_at: iso, ends_at: new Date(new Date(iso).getTime() + mins * 60000).toISOString() });

test("a client's summary: status, money split on semi-privates, and how often they come", () => {
  const now = new Date("2026-11-03T20:00:00.000Z");
  const lessons = [
    lesson({ id: "1", ...at("2026-10-13T16:00:00.000Z"), paid_at: "x" }),
    lesson({ id: "2", ...at("2026-10-20T16:00:00.000Z"), paid_at: "x" }),
    lesson({ id: "3", ...at("2026-10-27T16:00:00.000Z"), kind: "semi_private", client_names: ["ana ", "Ben"], price_cents: 12000 }),
    lesson({ id: "4", ...at("2026-10-28T16:00:00.000Z"), client_names: ["Ben"] }),
  ];
  const s = clientSummary("Ana", lessons, [], now);
  assert.equal(s.lessons, 3);
  assert.equal(s.paid, 20000);
  assert.equal(s.owed, 6000); // half of the semi-private
  assert.equal(s.every_days, 7);
  assert.equal(s.status, "rebook");
  assert.equal(clientSummary("Ana", lessons, [], new Date("2026-12-20T00:00:00.000Z")).status, "lapsed");
  assert.equal(clientSummary("Ana", [...lessons, lesson({ id: "5", ...at("2026-11-10T16:00:00.000Z") })], [], now).status, "booked");
  assert.equal(clientSummary("Zoe", lessons, [], now).status, "new");
});

test("dates for booking ahead", () => {
  assert.deepEqual(weeklyDates("2026-11-04", 3), ["2026-11-04", "2026-11-11", "2026-11-18"]);
  assert.equal(nextSameWeekday("2026-10-28", "2026-11-03"), "2026-11-04"); // a Wednesday, the day after a Tuesday
  assert.equal(nextSameWeekday("2026-10-27", "2026-11-03"), "2026-11-10"); // same weekday as today: next week
  assert.ok(overlaps(at("2026-11-04T16:00:00.000Z"), at("2026-11-04T16:30:00.000Z")));
  assert.ok(!overlaps(at("2026-11-04T16:00:00.000Z"), at("2026-11-04T17:00:00.000Z")));
});

test("weekly booking adds every week, skips clashes and marks only the first paid", async () => {
  const { store, ctx } = setup();
  const leo = await ctx(DEMO_IDS.leo);
  // Something already in week 2.
  assert.equal((await runAction(leo, "saveLesson", lessonInput({ client_names: "Someone Else", date: addDays(free(), 7), time: "12:30" }))).ok, true);
  const r = await runAction(leo, "saveLesson", lessonInput({ repeat_weeks: 4, paid: "on" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match((r as { message: string }).message, /^3 weekly lessons added\. Skipped .+: you're busy then\.$/);
  const mine = (await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } })).filter((l) => l.client_names[0] === "Nadia Brooks").sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  assert.deepEqual(mine.map((l) => dateKey(l.starts_at)), [free(), addDays(free(), 14), addDays(free(), 21)]);
  assert.deepEqual(mine.map((l) => !!l.paid_at), [true, false, false]);
  // A single lesson that clashes is refused, with what it clashes with.
  const one = await runAction(leo, "saveLesson", lessonInput({ client_names: "Third Person", time: "12:15" }));
  assert.deepEqual(one, { ok: false, error: "That time overlaps Nadia Brooks's lesson. Pick another time." });
});

test("lessons create client cards; renaming a card renames their lessons", async () => {
  const { store, ctx, load } = setup();
  const leo = await ctx(DEMO_IDS.leo);
  await runAction(leo, "saveLesson", lessonInput({ kind: "semi_private", client_names: "Nadia Brooks, Omar Haddad", back: "/coach/clients/abc" }));
  const cards = await store.list("clients", { eq: { coach_id: DEMO_IDS.leo } });
  const nadia = cards.find((c) => c.full_name === "Nadia Brooks")!;
  assert.ok(nadia && cards.some((c) => c.full_name === "Omar Haddad"));
  // Saving again with different casing doesn't make a second card.
  await runAction(leo, "saveLesson", lessonInput({ client_names: "nadia brooks", date: addDays(free(), 1) }));
  assert.equal((await store.list("clients", { eq: { coach_id: DEMO_IDS.leo } })).filter((c) => c.full_name.toLowerCase() === "nadia brooks").length, 1);

  const saved = await runAction(leo, "saveClient", { id: nadia.id, full_name: "Nadia Brooks-Lee", phone: "619 555 0199", email: "", level: "4.0", goals: "", notes: "" });
  assert.equal(saved.ok, true);
  const names = (await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } })).flatMap((l) => l.client_names);
  assert.equal(names.filter((n) => n === "Nadia Brooks-Lee").length, 2);
  assert.ok(!names.some((n) => n.toLowerCase() === "nadia brooks"));
  assert.equal((await store.get("clients", nadia.id))!.phone, "+16195550199");
  // Names stay unique per coach.
  const dup = await runAction(leo, "saveClient", { id: "", full_name: "omar haddad", phone: "", email: "", level: "", goals: "", notes: "" });
  assert.deepEqual(dup, { ok: false, error: "You already have a client called omar haddad." });

  // The card shows their lessons, and Book again repeats the latest one a week later.
  const page = await loadCoachClient(await load(DEMO_IDS.leo, { id: nadia.id }));
  assert.equal(page.lessons.length, 2);
  assert.equal(page.again!.date, addDays(free(), 8));
  assert.equal(page.again!.time, "12:00");
});

test("coaches only see their own clients", async () => {
  const { store, ctx, load } = setup();
  const maya = (await store.list("clients", { eq: { coach_id: DEMO_IDS.maya } }))[0];
  await assert.rejects(loadCoachClient(await load(DEMO_IDS.leo, { id: maya.id })));
  const del = await runAction(await ctx(DEMO_IDS.leo), "deleteClient", { client_id: maya.id });
  assert.equal(del.ok, false);
  const list = await loadCoachClients(await load(DEMO_IDS.leo));
  assert.ok(list.clients.every((r) => r.client.coach_id === DEMO_IDS.leo));
  assert.ok(list.clients.some((r) => r.client.full_name === "Rachel Green"));
});

test("community players and booking a lesson for one of them", async () => {
  const { load } = setup();
  const list = await loadCoachClients(await load(DEMO_IDS.leo, {}, { tab: "community" }));
  assert.ok(list.community.length > 0);
  const p = list.community[0];
  assert.ok(p.sessions > 0 && p.client_id === null);
  const editor = await loadLessonEditor(await load(DEMO_IDS.leo, { id: "new" }, { member: p.id, duration: "90", price: "120", back: "javascript:alert(1)" }));
  assert.equal(editor.prefill!.client, p.full_name);
  assert.equal(editor.prefill!.duration, 90);
  assert.equal(editor.prefill!.price, "120");
  assert.equal(editor.back, "");
});
