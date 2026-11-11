import { test } from "node:test";
import assert from "node:assert/strict";
import { leaderboardFrom, MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadCoachSession, loadMyGame } from "../src/core/queries";
import { levelFor, progress, shortName, streakWeeks, type Played } from "../src/core/progress";
import { addDays, dateKey, startOfWeek, zonedToUtc } from "../src/core/time";
import type { Actor } from "../src/core/types";

// A Wednesday in the middle of a month, so week and month edges don't get in the way.
const NOW = zonedToUtc("2026-11-18", "12:00");
const monday = startOfWeek(dateKey(NOW));
const at = (key: string, time = "18:00") => zonedToUtc(key, time).toISOString();
const group = (key: string, time?: string): Played => ({ starts_at: at(key, time), session_type: "group" });

test("points stay small: 2 a Group Session, 3 a Performance Accelerator, 2 a skill moved up, 10 a level", () => {
  const p = progress({
    played: [group(addDays(monday, -14)), { starts_at: at(addDays(monday, -7)), session_type: "performance_accelerator" }],
    feedback: [{ skills: ["backhand"], created_at: NOW.toISOString() }],
    goal: 1,
    now: NOW,
  });
  // 2 + 3 for the sessions, +2 for one skill, +2 for two weeks that hit a goal of 1.
  assert.equal(p.points, 9);
  assert.equal(p.level, 1);
  assert.equal(p.into_level, 9);
  assert.equal(p.to_next, 1);
  assert.equal(p.sessions_to_next, 1);
  assert.equal(levelFor(10), 2);
  assert.equal(p.skills.find((s) => s.key === "backhand")?.level, 2);
  assert.equal(p.skills.find((s) => s.key === "backhand")?.recent, true);
});

test("the points log adds up to the total, one line per session", () => {
  const played: Played[] = [
    { id: "a", starts_at: at(addDays(monday, -7)), session_type: "group" },
    { id: "b", starts_at: at(addDays(monday, -5)), session_type: "performance_accelerator" },
    { id: "c", starts_at: at(monday, "07:30"), session_type: "group" },
  ];
  const p = progress({
    played,
    feedback: [
      { session_id: "b", coach_id: "leo", skills: ["serve", "volley"], tip: "Toss higher.", created_at: at(addDays(monday, -5), "20:00") },
      { session_id: "gone", coach_id: "leo", skills: ["movement"], tip: "", created_at: at(addDays(monday, -3)) },
    ],
    goal: 2,
    now: NOW,
  });
  assert.equal(p.log.reduce((n, e) => n + e.total, 0), p.points);
  // Newest first, and the goal bonus sits on the session that reached it.
  assert.deepEqual(p.log.map((e) => e.key), ["c", "note-0", "b", "a"]);
  const b = p.log.find((e) => e.key === "b")!;
  assert.deepEqual(b.parts.map((x) => [x.label, x.points]), [["Played", 3], ["Serve up", 2], ["Volley up", 2], ["Weekly goal", 1]]);
  assert.equal(b.tip, "Toss higher.");
  assert.equal(p.week_points, 2);
  assert.equal(p.skills.find((s) => s.key === "serve")?.raised, 1);
  assert.ok(p.closest_badge && !p.closest_badge.earned);
});

test("a weekly goal of 2 only pays out in weeks with 2 sessions", () => {
  const p = progress({ played: [group(addDays(monday, -7)), group(addDays(monday, -5)), group(addDays(monday, -14))], feedback: [], goal: 2, now: NOW });
  assert.equal(p.goal_weeks, 1);
  assert.equal(p.points, 3 * 2 + 1);
});

test("the streak counts back from last week while this week is still open", () => {
  const weeks = new Set([addDays(monday, -7), addDays(monday, -14), addDays(monday, -21)]);
  assert.equal(streakWeeks(weeks, NOW).weeks, 3);
});

test("one missed week a month is forgiven, a second one breaks the streak", () => {
  // Played this week and last, missed the week before, played the two before that.
  const weeks = new Set([monday, addDays(monday, -7), addDays(monday, -21), addDays(monday, -28)]);
  const s = streakWeeks(weeks, NOW);
  assert.equal(s.weeks, 4);
  assert.deepEqual(s.frozen, [addDays(monday, -14)]);
  // Two missed weeks in a row can't be bridged.
  assert.equal(streakWeeks(new Set([monday, addDays(monday, -21)]), NOW).weeks, 1);
});

test("badges show how close the player is", () => {
  const p = progress({ played: [group(addDays(monday, -7), "07:30"), group(addDays(monday, -42))], feedback: [], goal: 1, now: NOW });
  const badge = (k: string) => p.badges.find((b) => b.key === k)!;
  assert.equal(badge("first").earned, true);
  assert.equal(badge("comeback").earned, true);
  assert.deepEqual([badge("early").have, badge("early").need, badge("early").earned], [1, 3, false]);
  assert.equal(badge("s10").have, 2);
});

test("the leaderboard shows short names, skips no-shows and hidden players, and breaks ties by who got there first", () => {
  assert.equal(shortName("Diego  Alvarez"), "Diego A.");
  assert.equal(shortName("Cher"), "Cher");
  const db = demoSeed(NOW);
  const from = at(`${dateKey(NOW).slice(0, 7)}-01`, "00:00");
  const to = at("2026-12-01", "00:00");
  const board = leaderboardFrom(db, from, to, NOW.toISOString());
  assert.ok(board.length > 0);
  for (const r of board) assert.match(r.name, /^\S+( \S\.)?$/);
  for (let i = 1; i < board.length; i++) {
    const [a, b] = [board[i - 1], board[i]];
    assert.ok(a.played > b.played || (a.played === b.played && a.reached_at <= b.reached_at));
  }
  const top = board[0];
  db.profiles.find((p) => p.id === top.user_id)!.leaderboard_hidden = true;
  assert.ok(!leaderboardFrom(db, from, to, NOW.toISOString()).some((r) => r.user_id === top.user_id));
});

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const ctxFor = async (userId: string): Promise<Ctx> => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    return { store, actor, now };
  };
  return { store, ctxFor, now };
}

test("a coach's skill tap and tip reach the player's My Game page, and go if they're marked a no-show", async () => {
  const { store, ctxFor, now } = setup();
  const past = (await store.list("sessions")).find((s) => s.session_type && s.coach_ids.includes(DEMO_IDS.leo) && s.starts_at < now.toISOString() && s.status === "published")!;
  const booking = (await store.list("bookings", { eq: { session_id: past.id, status: "confirmed" } }))[0];
  const leo = await ctxFor(DEMO_IDS.leo);
  await runAction(leo, "setAttendance", { booking_id: booking.id, attended: "yes" });
  const r = await runAction(leo, "saveFeedback", { booking_id: booking.id, skills: ["volley"], tip: "Racket up early at the net." });
  assert.equal(r.ok, true);

  const player = await ctxFor(booking.user_id);
  const game = await loadMyGame({ ...player, params: {}, search: {} });
  assert.equal(game.focus?.tip, "Racket up early at the net.");
  assert.ok(game.me.skills.find((s) => s.key === "volley")!.level >= 2);
  assert.equal(game.history.volley[0].tip, "Racket up early at the net.");
  assert.ok(game.log.some((e) => e.session_id === past.id && e.parts.some((x) => x.label === "Volley up")));

  const coachView = await loadCoachSession({ ...leo, params: { id: past.id }, search: {} });
  assert.deepEqual(coachView.feedback?.[booking.user_id]?.skills, ["volley"]);

  await runAction(leo, "setAttendance", { booking_id: booking.id, attended: "no" });
  assert.equal((await store.list("feedback", { eq: { session_id: past.id, user_id: booking.user_id } })).length, 0);
});

test("only the session's coaches can give feedback, and only for players who came", async () => {
  const { store, ctxFor, now } = setup();
  const past = (await store.list("sessions")).find((s) => s.session_type && s.coach_ids.includes(DEMO_IDS.maya) && !s.coach_ids.includes(DEMO_IDS.leo) && s.starts_at < now.toISOString())!;
  const booking = (await store.list("bookings", { eq: { session_id: past.id, status: "confirmed" } }))[0];
  const maya = await ctxFor(DEMO_IDS.maya);
  await runAction(maya, "setAttendance", { booking_id: booking.id, attended: "clear" });
  assert.equal((await runAction(maya, "saveFeedback", { booking_id: booking.id, skills: ["serve"], tip: "" })).ok, false);
  await runAction(maya, "setAttendance", { booking_id: booking.id, attended: "yes" });
  assert.equal((await runAction(await ctxFor(DEMO_IDS.sam), "saveFeedback", { booking_id: booking.id, skills: ["serve"], tip: "" })).ok, false);
  assert.equal((await runAction(maya, "saveFeedback", { booking_id: booking.id, skills: ["serve", "spin"], tip: "" })).ok, false);
  assert.equal((await runAction(maya, "saveFeedback", { booking_id: booking.id, skills: ["serve"], tip: "" })).ok, true);
});

test("players set their weekly goal and can leave the leaderboard", async () => {
  const { store, ctxFor } = setup();
  const sam = await ctxFor(DEMO_IDS.sam);
  assert.equal((await runAction(sam, "setWeeklyGoal", { goal: 2 })).ok, true);
  assert.equal((await runAction(sam, "setWeeklyGoal", { goal: 5 })).ok, false);
  assert.equal((await runAction(sam, "setLeaderboardHidden", { hidden: true })).ok, true);
  const p = (await store.get("profiles", DEMO_IDS.sam))!;
  assert.equal(p.weekly_goal, 2);
  assert.equal(p.leaderboard_hidden, true);
});
