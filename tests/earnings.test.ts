import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadCoachEarnings, type LoadCtx } from "../src/core/queries";
import { buckets, commissionFor, lessonMoney, periodLabel, periodRange } from "../src/core/earnings";
import type { Actor, CommissionRule } from "../src/core/types";
import { addDays, dateKey } from "../src/core/time";

const rule = (r: Partial<CommissionRule>): CommissionRule => ({ id: "r", place: "Balboa", percent: 0, per_hour_cents: 0, per_lesson_cents: 0, created_at: "", ...r });
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
  assert.equal(saved.commission_cents, 2000); // demo rule: Balboa 20%

  // The admin (Leo) raises the rate. The saved lesson keeps 20% until its price or place changes.
  const rules = await store.list("commission_rules");
  const coach = await ctx(DEMO_IDS.maya);
  assert.equal((await runAction(coach, "saveCommissionRules", { id_0: rules[0].id, place_0: "Balboa", percent_0: "30" })).ok, false, "coaches can't change commission");
  assert.equal((await runAction(leo, "saveCommissionRules", { id_0: rules[0].id, place_0: "Balboa", percent_0: "30", per_hour_0: "", per_lesson_0: "" })).ok, true);
  assert.equal((await store.list("commission_rules"))[0].percent, 30);

  await runAction(leo, "saveLesson", lessonInput({ id: saved.id, notes: "moved nothing" }));
  assert.equal((await store.get("lessons", saved.id))!.commission_cents, 2000);
  await runAction(leo, "saveLesson", lessonInput({ id: saved.id, price: "120" }));
  assert.equal((await store.get("lessons", saved.id))!.commission_cents, 3600);
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
  // Earned + booked across the chart equals the lessons' net.
  const chart = data.chart.reduce((n, b) => n + b.earned + b.scheduled, 0);
  assert.equal(chart, data.lessons.reduce((n, r) => n + r.money.net, 0));
  assert.equal(data.totals.net, data.lessons.filter((r) => r.done).reduce((n, r) => n + r.money.net, 0));
  // Balboa lessons lose 20%; the Morley Field ones keep the full price.
  const balboa = data.lessons.find((r) => r.lesson.location.includes("Balboa") && r.money.priced)!;
  assert.equal(balboa.money.commission, balboa.money.gross * 0.2);
  const morley = data.lessons.find((r) => r.lesson.location === "Morley Field")!;
  assert.equal(morley.money.commission, 0);
  // The demo leaves one recent semi-private lesson unpaid.
  assert.ok(data.owed.lessons.length >= 1);
  assert.ok(data.owed.lessons.every((o) => !o.lesson.paid_at && o.lesson.ends_at <= new Date().toISOString()));
});
