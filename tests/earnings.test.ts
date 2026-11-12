import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadCoachEarnings, type LoadCtx } from "../src/core/queries";
import { buckets, commissionFor, lessonMoney, payday, payWindow, periodLabel, periodRange, sessionShare } from "../src/core/earnings";
import type { Actor, CommissionRule } from "../src/core/types";
import { addDays, dateKey } from "../src/core/time";

const rule = (r: Partial<CommissionRule>): CommissionRule => ({ id: "r", place: "Balboa", percent: 0, per_hour_cents: 0, per_lesson_cents: 0, max_players: null, created_at: "", ...r });
const hour = { starts_at: "2026-11-04T16:00:00.000Z", ends_at: "2026-11-04T17:30:00.000Z" }; // 90 minutes

test("commission applies by place name and mixes percent, hourly and flat fees", () => {
  const rules = [rule({ percent: 20, per_hour_cents: 1000, per_lesson_cents: 300 })];
  assert.equal(commissionFor({ ...hour, price_cents: 10000, location: "Balboa Tennis Club, San Diego" }, rules), 2000 + 1500 + 300);
  assert.equal(commissionFor({ ...hour, price_cents: 10000, location: "balboa park" }, rules), 3800);
  assert.equal(commissionFor({ ...hour, price_cents: 10000, location: "Morley Field" }, rules), null);
  // A rule with no amounts set doesn't count yet.
  assert.equal(commissionFor({ ...hour, price_cents: 10000, location: "Balboa" }, [rule({})]), null);
});

test("a saved commission wins over today's rule", () => {
  const rules = [rule({ percent: 25 })];
  const l = { ...hour, price_cents: 10000, location: "Balboa", commission_cents: 2000 };
  assert.deepEqual(lessonMoney(l, rules), { gross: 10000, commission: 2000, net: 8000, priced: true });
  assert.equal(lessonMoney({ ...l, commission_cents: null }, rules).commission, 2500);
  assert.deepEqual(lessonMoney({ ...l, price_cents: null, commission_cents: null }, []), { gross: 0, commission: 0, net: 0, priced: false });
});

test("periods: weeks start Monday, months split into weeks, years into months", () => {
  assert.deepEqual(periodRange("week", "2026-11-04"), { from: "2026-11-02", to: "2026-11-09", prev: "2026-10-26", next: "2026-11-09" });
  assert.deepEqual(periodRange("month", "2026-12-15"), { from: "2026-12-01", to: "2027-01-01", prev: "2026-11-01", next: "2027-01-01" });
  assert.equal(periodLabel("week", "2026-11-04"), "Nov 2 – 8, 2026");
  assert.equal(periodLabel("week", "2026-11-30"), "Nov 30 – Dec 6, 2026");
  assert.equal(periodLabel("month", "2026-11-04"), "November 2026");
  const weeks = buckets("month", "2026-11-04");
  assert.equal(weeks[0].from, "2026-11-01"); // Nov 1 2026 is a Sunday: a one-day first column
  assert.equal(weeks[1].from, "2026-11-02");
  assert.equal(weeks.at(-1)!.to, "2026-12-01");
  assert.equal(buckets("year", "2026-05-01").length, 12);
});

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const actor = async (id: string): Promise<Actor> => {
    const user = await store.get("profiles", id);
    return { auth_id: id, identifier: user?.email ?? null, user };
  };
  const ctx = async (id: string): Promise<Ctx> => ({ store, actor: await actor(id), now });
  const load = async (id: string, search: Record<string, string> = {}): Promise<LoadCtx> => ({ store, actor: await actor(id), params: {}, search, now });
  return { store, ctx, load, now };
}

const lessonInput = (extra: Record<string, unknown> = {}) => ({ id: "", kind: "private", client_names: "Rachel Green", date: addDays(dateKey(new Date()), 2), time: "12:00", duration_min: 60, location: "Balboa Tennis Club", price: "100", notes: "", ...extra });

test("saving a lesson stores the commission and keeps it when rates change", async () => {
  const { store, ctx } = setup();
  const leo = await ctx(DEMO_IDS.leo);
  assert.equal((await runAction(leo, "saveLesson", lessonInput())).ok, true);
  const [saved] = (await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } })).filter((l) => l.client_names[0] === "Rachel Green" && l.location === "Balboa Tennis Club");
  assert.equal(saved.commission_cents, 2500); // Balboa: $25 an hour for one player

  // The admin (Leo) raises the small-group rate. The saved lesson keeps $25 until its price, place, time or group changes.
  const [small, big] = [...(await store.list("commission_rules"))].sort((a, b) => (a.max_players ?? 99) - (b.max_players ?? 99));
  const form = { id_0: small.id, place_0: "Balboa", per_hour_0: "30", max_players_0: "4", id_1: big.id, place_1: "Balboa", percent_1: "30" };
  const coach = await ctx(DEMO_IDS.maya);
  assert.equal((await runAction(coach, "saveCommissionRules", form)).ok, false, "coaches can't change commission");
  assert.equal((await runAction(leo, "saveCommissionRules", form)).ok, true);
  const after = await store.list("commission_rules");
  assert.equal(after.length, 2);
  assert.equal(after.find((r) => r.max_players === 4)!.per_hour_cents, 3000);

  await runAction(leo, "saveLesson", lessonInput({ id: saved.id, notes: "moved nothing" }));
  assert.equal((await store.get("lessons", saved.id))!.commission_cents, 2500);
  await runAction(leo, "saveLesson", lessonInput({ id: saved.id, price: "120" }));
  assert.equal((await store.get("lessons", saved.id))!.commission_cents, 3000);
  // Six players is a big group: 30% of the price.
  await runAction(leo, "saveLesson", lessonInput({ id: saved.id, kind: "semi_private", client_names: "A, B, C, D, E, F", price: "300" }));
  assert.equal((await store.get("lessons", saved.id))!.commission_cents, 9000);
});

test("marking paid is the coach's own, and only for their lessons", async () => {
  const { store, ctx } = setup();
  const leo = await ctx(DEMO_IDS.leo);
  const maya = await ctx(DEMO_IDS.maya);
  const [mine] = await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } });
  assert.equal((await runAction(maya, "setLessonPaid", { lesson_id: mine.id, paid: "yes" })).ok, false);
  assert.equal((await runAction(leo, "setLessonPaid", { lesson_id: mine.id, paid: "no" })).ok, true);
  assert.equal((await store.get("lessons", mine.id))!.paid_at, null);
  await runAction(leo, "setLessonPaid", { lesson_id: mine.id, paid: "yes" });
  assert.ok((await store.get("lessons", mine.id))!.paid_at);
});

test("the earnings page counts only the coach's own lessons, after commission", async () => {
  const { store, load } = setup();
  const data = await loadCoachEarnings(await load(DEMO_IDS.leo, { period: "year" }));
  const mine = await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } });
  assert.ok(data.lessons.length > 0);
  assert.ok(data.lessons.every((r) => r.lesson.coach_id === DEMO_IDS.leo));
  assert.ok(data.lessons.length <= mine.length);
  // Earned + booked across the chart equals the lessons' and community sessions' net.
  const rows = [...data.lessons, ...data.sessions];
  const chart = data.chart.reduce((n, b) => n + b.earned + b.scheduled, 0);
  assert.equal(chart, rows.reduce((n, r) => n + r.money.net, 0));
  assert.equal(data.totals.net, rows.filter((r) => r.done).reduce((n, r) => n + r.money.net, 0));
  assert.ok(data.sessions.length > 0, "community sessions count as earnings");
  // One-hour Balboa lessons for up to 4 players lose $25; the Morley Field ones keep the full price.
  const balboa = data.lessons.find((r) => r.lesson.location.includes("Balboa") && r.money.priced)!;
  assert.equal(balboa.money.commission, 2500);
  assert.equal(balboa.payday, payday(dateKey(balboa.lesson.starts_at)));
  const morley = data.lessons.find((r) => r.lesson.location === "Morley Field")!;
  assert.equal(morley.money.commission, 0);
  assert.equal(morley.payday, null);
  // Only lessons outside Balboa wait to be marked paid; Balboa pays on its paydays.
  assert.ok(data.owed.lessons.every((o) => !o.lesson.paid_at && !o.lesson.location.includes("Balboa") && o.lesson.ends_at <= new Date().toISOString()));
  assert.ok(data.paydays.length > 0 && data.paydays.every((p) => p.date >= dateKey(new Date())));
});

// Balboa: $25 an hour for 4 players or fewer, 30% for 5 or more.
const balboa = [rule({ id: "small", per_hour_cents: 2500, max_players: 4 }), rule({ id: "big", percent: 30 })];

test("Balboa charges $25 an hour up to 4 players and 30% above that", () => {
  const at = { ...hour, location: "Balboa Tennis Club" }; // 90 minutes
  assert.equal(commissionFor({ ...at, price_cents: 15000, client_names: ["Ana"] }, balboa), 3750);
  assert.equal(commissionFor({ ...at, price_cents: 24000, client_names: ["A", "B", "C", "D"] }, balboa), 3750);
  assert.equal(commissionFor({ ...at, price_cents: 30000, client_names: ["A", "B", "C", "D", "E"] }, balboa), 9000);
  // Rule order in the table doesn't matter: the tightest player limit that fits wins.
  assert.equal(commissionFor({ ...at, price_cents: 15000, client_names: ["Ana"] }, [...balboa].reverse()), 3750);
  assert.equal(commissionFor({ ...at, price_cents: 15000, client_names: ["Ana"] }, [rule({ per_hour_cents: 2500, max_players: 4 })]), 3750);
  assert.equal(commissionFor({ ...at, price_cents: 30000, client_names: ["A", "B", "C", "D", "E"] }, [rule({ per_hour_cents: 2500, max_players: 4 })]), null);
});

test("a community session is players times price, minus commission, split between its coaches", () => {
  const s = { ...hour, location: "Balboa Tennis Club", price_cents: 4000, coach_ids: ["leo", "kaan"] };
  // 11 players x $40 = $440; Balboa takes 30% = $132; each coach gets $154.
  assert.deepEqual(sessionShare(s, 11, balboa), { gross: 22000, commission: 6600, net: 15400, priced: true });
  // Somewhere with no commission: $220 each.
  assert.deepEqual(sessionShare({ ...s, location: "Morley Field" }, 11, balboa), { gross: 22000, commission: 0, net: 22000, priced: true });
  // Small group at Balboa: 3 x $40 = $120, minus $37.50 for 90 minutes, one coach.
  assert.deepEqual(sessionShare({ ...s, coach_ids: ["leo"] }, 3, balboa), { gross: 12000, commission: 3750, net: 8250, priced: true });
  // Nobody booked: nothing earned, no fee.
  assert.equal(sessionShare(s, 0, balboa).net, 0);
});

test("Balboa pays on the 20th for the 1st-15th and on the 5th for the 16th-end", () => {
  assert.equal(payday("2026-11-01"), "2026-11-20");
  assert.equal(payday("2026-11-15"), "2026-11-20");
  assert.equal(payday("2026-11-16"), "2026-12-05");
  assert.equal(payday("2026-12-31"), "2027-01-05");
  assert.deepEqual(payWindow("2026-11-20"), { from: "2026-11-01", to: "2026-11-16" });
  assert.deepEqual(payWindow("2027-01-05"), { from: "2026-12-16", to: "2027-01-01" });
});
