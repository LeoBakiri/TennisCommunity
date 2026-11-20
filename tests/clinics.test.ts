import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadClinicEditor, loadCoachEarnings, loadCoachSchedule, type LoadCtx } from "../src/core/queries";
import { clinicDates, clinicMoney, firstOn, weekdayOf } from "../src/core/clinics";
import type { Actor, Clinic } from "../src/core/types";
import { addDays, dateKey, startOfWeek } from "../src/core/time";

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

const clinic = (c: Partial<Clinic> = {}): Clinic => ({ id: "c1", coach_id: "x", title: "Legacy Clinic", weekday: 0, start_time: "18:30", duration_min: 90, pay_cents: 7000, location: "Balboa Tennis Club, San Diego", starts_on: "2026-11-02", ends_on: null, notes: "", created_at: "", updated_at: "", ...c });

test("weekday helpers: Monday is 0", () => {
  assert.equal(weekdayOf("2026-11-23"), 0); // a Monday
  assert.equal(weekdayOf("2026-11-22"), 6); // a Sunday
  assert.equal(firstOn("2026-11-20", 2), "2026-11-25"); // Friday → next Wednesday
  assert.equal(firstOn("2026-11-25", 2), "2026-11-25");
});

test("a clinic runs every week from its first week up to its last, in Pacific time", () => {
  const nights = clinicDates(clinic({ ends_on: "2026-11-23" }), "2026-10-01", "2027-01-01");
  assert.deepEqual(nights.map((n) => n.day), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.equal(nights[0].starts_at, "2026-11-03T02:30:00.000Z"); // 6:30 PM PST
  assert.equal(nights[0].ends_at, "2026-11-03T04:00:00.000Z");
});

test("a covered night pays nothing; the others pay the flat amount with no commission", () => {
  const [a, b] = clinicDates(clinic(), "2026-11-02", "2026-11-10", [{ id: "x", clinic_id: "c1", coach_id: "x", day: "2026-11-09", covered_by: "Kaan", created_at: "" }]);
  assert.deepEqual(clinicMoney(a), { gross: 7000, commission: 0, net: 7000, priced: true });
  assert.equal(clinicMoney(b).net, 0);
});

test("adding a clinic, covering a night and seeing it on the schedule and in Earnings", async () => {
  const { store, ctx, load, now } = setup();
  const today = dateKey(now);
  const r = await runAction(await ctx(DEMO_IDS.leo), "saveClinic", { id: "", title: "Knockout 3.0–4.0", weekday: "4", time: "18:30", duration_min: "90", pay: "70", location: "BTC", starts_on: today, ends_on: "", notes: "" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = (await store.list("clinics", { eq: { title: "Knockout 3.0–4.0" } }))[0];
  assert.equal(c.weekday, 4);
  assert.equal(weekdayOf(c.starts_on), 4);
  assert.equal(c.location, "Balboa Tennis Club, San Diego");
  assert.equal(c.pay_cents, 7000);

  // On the week grid, not draggable, with the club's pay and no commission.
  const week = await loadCoachSchedule(await load(DEMO_IDS.leo, {}, { week: c.starts_on }));
  const item = week.items.find((i) => i.href.startsWith(`/coach/clinics/${c.id}`));
  assert.ok(item);
  assert.equal(item.clinic, true);
  assert.ok(!item.movable);

  // Someone else takes the first night.
  const cover = await runAction(await ctx(DEMO_IDS.leo), "coverClinic", { clinic_id: c.id, day: c.starts_on, covered_by: "Kaan" });
  assert.equal(cover.ok, true, JSON.stringify(cover));
  const after = await loadCoachSchedule(await load(DEMO_IDS.leo, {}, { week: c.starts_on }));
  assert.equal(after.items.find((i) => i.id === `${c.id}_${c.starts_on}`)?.faded, true);
  assert.equal(after.items.find((i) => i.id === `${c.id}_${c.starts_on}`)?.color, "#9A9F9B"); // grey once covered
  const page = await loadClinicEditor(await load(DEMO_IDS.leo, { id: c.id }, { day: c.starts_on }));
  assert.equal(page.day, c.starts_on);
  assert.equal(page.nights.find((n) => n.day === c.starts_on)?.covered_by, "Kaan");

  // A day it doesn't run is refused; another coach can't touch it.
  assert.equal((await runAction(await ctx(DEMO_IDS.leo), "coverClinic", { clinic_id: c.id, day: addDays(c.starts_on, 1), covered_by: "" })).ok, false);
  assert.equal((await runAction(await ctx(DEMO_IDS.maya), "coverClinic", { clinic_id: c.id, day: c.starts_on, covered_by: "" })).ok, false);

  // A lesson on top of a clinic night the coach teaches is a clash.
  const clash = await runAction(await ctx(DEMO_IDS.leo), "saveLesson", { id: "", kind: "private", client_names: "Nadia Brooks", date: addDays(c.starts_on, 7), time: "19:00", duration_min: 60, location: "BTC", price: "100", notes: "" });
  assert.equal(clash.ok, false);

  // Earnings for that week: the covered night is $0, the clinic shows under Club clinics.
  const month = await loadCoachEarnings(await load(DEMO_IDS.leo, {}, { period: "week", at: addDays(c.starts_on, 7) }));
  const mine = month.clinics.filter((x) => x.session.id === c.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].money.net, 7000);
  assert.ok(month.byKind.some((k) => k.kind === "clinic"));
  const covered = await loadCoachEarnings(await load(DEMO_IDS.leo, {}, { period: "week", at: c.starts_on }));
  assert.equal(covered.clinics.find((x) => x.session.id === c.id)?.money.net, 0);

  // Back to teaching it.
  assert.equal((await runAction(await ctx(DEMO_IDS.leo), "uncoverClinic", { clinic_id: c.id, day: c.starts_on })).ok, true);
  assert.equal((await store.list("clinic_covers", { eq: { clinic_id: c.id } })).length, 0);
});

test("the demo clinics count toward last week's earnings, minus the covered night", async () => {
  const { load, now } = setup();
  const lastWeek = addDays(startOfWeek(dateKey(now)), -7);
  const data = await loadCoachEarnings(await load(DEMO_IDS.leo, {}, { period: "week", at: lastWeek }));
  assert.equal(data.clinics.length, 2);
  assert.equal(data.clinics.reduce((n, r) => n + r.money.net, 0), 7000);
});
