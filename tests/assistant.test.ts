import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction } from "../src/core/services";
import { canUseAssistant, contactFor, propose, runRead, toolCalls, toolResult, type AssistantCtx, type Msg } from "../src/core/assistant";
import { demoReply } from "../src/core/assistant-demo";
import { addDays, dateKey, timeKey } from "../src/core/time";

function setup() {
  const now = new Date();
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(now));
  const as = async (id: string): Promise<AssistantCtx> => {
    const user = await store.get("profiles", id);
    return { store, actor: { auth_id: id, identifier: user?.email ?? null, user }, now };
  };
  return { store, as, now, today: dateKey(now) };
}
type Schedule = { lessons: { lesson_id: string; clients: string[]; date: string; time: string; price: number | null; paid: boolean }[]; community_sessions: { session_id: string; players: string[]; booked: number }[] };
type Clients = { clients: Record<string, unknown>[] };
// Far enough ahead to miss the demo schedule.
const free = (weeks = 30) => addDays(dateKey(new Date()), weeks * 7);

test("the schedule tool shows the coach their own lessons and the sessions they coach, not another coach's", async () => {
  const { as, today } = setup();
  const leo = (await runRead(await as(DEMO_IDS.leo), "get_schedule", { from: addDays(today, -7), to: addDays(today, 14) })) as Schedule;
  const names = leo.lessons.flatMap((l) => l.clients);
  assert.ok(names.includes("Rachel Green"));
  assert.ok(!names.includes("Amir Sadeghi")); // Maya's client
  assert.ok(leo.community_sessions.length > 0);
});

test("only the admin has the assistant: another coach can't look anything up or change anything", async () => {
  const { as, today } = setup();
  const maya = await as(DEMO_IDS.maya);
  assert.equal(maya.actor.user!.role, "coach");
  assert.equal(canUseAssistant(maya.actor.user), false);
  assert.equal(canUseAssistant((await as(DEMO_IDS.leo)).actor.user), true);
  for (const tool of ["get_schedule", "get_clients", "get_earnings"]) await assert.rejects(runRead(maya, tool, {}), /isn't available/);
  await assert.rejects(propose(maya, "book_lesson", { clients: ["Amir Sadeghi"], date: free(), time: "12:00" }), /isn't available/);
  await assert.rejects(contactFor(maya, "Amir Sadeghi"), /isn't available/);
  const s = (await runRead(await as(DEMO_IDS.leo), "get_schedule", { from: addDays(today, -7), to: addDays(today, 14) })) as Schedule;
  await assert.rejects(propose(maya, "cancel_lesson", { lesson_id: s.lessons[0].lesson_id }), /isn't available/);
});

test("players can't use the assistant's tools", async () => {
  const { as } = setup();
  const sam = await as(DEMO_IDS.sam);
  await assert.rejects(runRead(sam, "get_schedule", {}), /isn't available/);
  await assert.rejects(runRead(sam, "get_clients", {}), /isn't available/);
  await assert.rejects(propose(sam, "book_lesson", { clients: ["A"], date: free(), time: "12:00" }), /isn't available/);
});

test("client phone numbers and emails never go to the model, but drafts can still find them", async () => {
  const { as, store } = setup();
  const leo = await as(DEMO_IDS.leo);
  await runAction(leo, "saveClient", { id: "", full_name: "Nadia Brooks", phone: "(619) 555-0177", email: "nadia@example.com", level: "3.5", goals: "", notes: "" });
  const out = JSON.stringify(await runRead(leo, "get_clients", {}));
  assert.ok(out.includes("Nadia Brooks"));
  assert.ok(!out.includes("555") && !out.includes("nadia@example.com"));
  const nadia = ((await runRead(leo, "get_clients", {})) as Clients).clients.find((c) => c.name === "Nadia Brooks")!;
  assert.equal(nadia.has_phone, true);
  assert.equal(await contactFor(leo, "nadia brooks"), "+16195550177");
  assert.equal((await store.list("clients", { eq: { coach_id: DEMO_IDS.maya } })).some((c) => c.full_name === "Nadia Brooks"), false);
});

test("booking: nothing is saved until the proposal's action runs, then weekly lessons appear", async () => {
  const { as, store } = setup();
  const leo = await as(DEMO_IDS.leo);
  const before = (await store.list("lessons")).length;
  const p = await propose(leo, "book_lesson", { clients: ["Nadia Brooks"], date: free(), time: "12:00", price: 95, weeks: 3 });
  assert.equal((await store.list("lessons")).length, before);
  assert.equal(p.action, "saveLesson");
  assert.match(p.lines.join("\n"), /Nadia Brooks/);
  assert.match(p.lines.join("\n"), /Every week for 3 weeks/);
  assert.match(p.lines.join("\n"), /\$95/);
  const r = await runAction(leo, p.action, p.input);
  assert.deepEqual([r.ok, r.ok && r.message], [true, "3 weekly lessons added."]);
  const mine = (await store.list("lessons", { eq: { coach_id: DEMO_IDS.leo } })).filter((l) => l.client_names[0] === "Nadia Brooks");
  assert.equal(mine.length, 3);
  assert.equal(mine[0].price_cents, 9500);
  assert.equal(mine[0].kind, "private");
  assert.equal(timeKey(mine[0].starts_at), "12:00");
});

test("two names make a semi-private, and a missing date is sent back to the model", async () => {
  const { as } = setup();
  const leo = await as(DEMO_IDS.leo);
  const p = await propose(leo, "book_lesson", { clients: ["Ana Diaz", "Ben Diaz"], date: free(), time: "13:00" });
  assert.equal(p.input.kind, "semi_private");
  assert.match(p.lines[0], /Semi-Private/i);
  await assert.rejects(propose(leo, "book_lesson", { clients: ["Ana Diaz"], time: "5pm" }), /date/);
});

test("changing, paying for and cancelling a lesson, and only your own", async () => {
  const { as, store, today } = setup();
  const leo = await as(DEMO_IDS.leo);
  const s = (await runRead(leo, "get_schedule", { from: addDays(today, -7), to: addDays(today, 14) })) as Schedule;
  const rachel = s.lessons.find((l) => l.clients[0] === "Rachel Green")!;

  // Someone else's lesson is refused, as a missing one is.
  const amir = (await store.list("lessons", { eq: { coach_id: DEMO_IDS.maya } }))[0];
  await assert.rejects(propose(leo, "change_lesson", { lesson_id: amir.id, time: "09:00" }), /isn't on your schedule/);
  await assert.rejects(propose(leo, "cancel_lesson", { lesson_id: "nope" }), /isn't on your schedule/);

  const move = await propose(leo, "change_lesson", { lesson_id: rachel.lesson_id, date: free(), time: "14:30", price: 120 });
  assert.ok((await runAction(leo, move.action, move.input)).ok);
  const moved = (await store.get("lessons", rachel.lesson_id))!;
  assert.deepEqual([dateKey(moved.starts_at), timeKey(moved.starts_at), moved.price_cents, moved.client_names], [free(), "14:30", 12000, ["Rachel Green"]]);
  assert.equal(moved.notes, "Second serve. Bring the speed gun."); // untouched fields stay

  const pay = await propose(leo, "mark_lesson_paid", { lesson_id: rachel.lesson_id });
  assert.ok((await runAction(leo, pay.action, pay.input)).ok);
  assert.ok((await store.get("lessons", rachel.lesson_id))!.paid_at);

  const cancel = await propose(leo, "cancel_lesson", { lesson_id: rachel.lesson_id });
  assert.equal(cancel.danger, true);
  assert.ok((await runAction(leo, cancel.action, cancel.input)).ok);
  assert.equal(await store.get("lessons", rachel.lesson_id), null);
});

test("updating a client card keeps what wasn't mentioned", async () => {
  const { as, store } = setup();
  const leo = await as(DEMO_IDS.leo);
  await runAction(leo, "saveClient", { id: "", full_name: "Nadia Brooks", phone: "(619) 555-0177", email: "", level: "3.0", goals: "Play league", notes: "" });
  const p = await propose(leo, "save_client", { name: "nadia brooks", level: "3.5", notes: "Left-handed" });
  assert.equal(p.title, "Update Nadia Brooks");
  assert.ok((await runAction(leo, p.action, p.input)).ok);
  const card = (await store.list("clients", { eq: { coach_id: DEMO_IDS.leo } })).find((c) => c.full_name === "Nadia Brooks")!;
  assert.deepEqual([card.level, card.notes, card.goals, card.phone], ["3.5", "Left-handed", "Play league", "+16195550177"]);
});

test("earnings come back in dollars for the period asked", async () => {
  const { as } = setup();
  const e = (await runRead(await as(DEMO_IDS.leo), "get_earnings", { period: "year" })) as { period: string; earned_so_far: { take_home: number }; next_paydays: unknown[] };
  assert.match(e.period, /\d{4}/);
  assert.equal(typeof e.earned_so_far.take_home, "number");
  assert.ok(Number.isFinite(e.earned_so_far.take_home));
});

test("the demo stand-in walks a whole exchange: question, look-up, answer", async () => {
  const { as, now } = setup();
  const leo = await as(DEMO_IDS.leo);
  let messages: Msg[] = [{ role: "user", content: "What's on this week?" }];
  const first = demoReply(messages, now);
  const [call] = toolCalls(first);
  assert.equal(call.name, "get_schedule");
  messages = [...messages, { role: "assistant", content: first.content }, { role: "user", content: [toolResult(call.id!, await runRead(leo, call.name!, call.input!))] }];
  const second = demoReply(messages, now);
  assert.equal(second.stop_reason, "end_turn");
  assert.match(second.content[0].text!, /next week|Nothing on your schedule/);
  assert.equal(toolCalls(demoReply([{ role: "user", content: "Book Rachel every Wednesday" }], now))[0].name, "book_lesson");
});
