import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type Store } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import type { Ctx } from "../src/core/services";
import { calendarLinks, loadMySessions } from "../src/core/queries";
import type { Actor } from "../src/core/types";
import { buildCalendar, type FeedSession } from "../supabase/functions/player-calendar/index";

const NOW = new Date("2026-11-11T20:00:00Z");
const session = (over: Partial<FeedSession> = {}): FeedSession => ({
  id: "6f1c2b9e-0d7a-4c1e-9a52-3b8e2f1d4c77",
  session_type: "group",
  title: "",
  starts_at: "2026-11-16T01:00:00Z",
  ends_at: "2026-11-16T02:30:00Z",
  location: "Balboa Tennis Club, San Diego",
  court: 3,
  status: "published",
  description: "",
  coach_ids: ["leo", "kaan"],
  ...over,
});
const build = (sessions: FeedSession[]) => buildCalendar({ sessions, coachNames: { leo: "Leo", kaan: "Kaan" }, brand: "El Patio Tennis", appUrl: "https://example.test/app", now: NOW });

test("the calendar lists booked sessions with title, time, place and coaches", () => {
  const ics = build([session({ session_type: "performance_accelerator", title: "Return of Serve", description: "Bring water; we start on time." })]);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /\r\nX-WR-CALNAME:El Patio Tennis\r\n/);
  assert.match(ics, /\r\nUID:session-6f1c2b9e-0d7a-4c1e-9a52-3b8e2f1d4c77@elpatiotennis\r\n/);
  assert.match(ics, /\r\nDTSTART:20261116T010000Z\r\nDTEND:20261116T023000Z\r\n/);
  assert.match(ics, /\r\nSUMMARY:Performance Accelerator: Return of Serve · El Patio Tennis\r\n/);
  assert.match(ics, /\r\nLOCATION:Balboa Tennis Club\\, San Diego · Court 3\r\n/);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DESCRIPTION:Coaches: Leo\\, Kaan\\n\\nBring water\\; we start on time\.\\n\\nYour sessions: https:\/\/example\.test\/app\/#\/my-sessions\r\n/);
});

test("cancelled, draft and long-past sessions stay off the calendar", () => {
  const ics = build([
    session({ id: "a", status: "cancelled" }),
    session({ id: "b", status: "draft" }),
    session({ id: "c", starts_at: "2026-08-01T01:00:00Z", ends_at: "2026-08-01T02:00:00Z" }),
    session({ id: "d", starts_at: "2026-10-20T01:00:00Z", ends_at: "2026-10-20T02:00:00Z" }),
  ]);
  assert.deepEqual([...ics.matchAll(/UID:session-(\w+)@/g)].map((m) => m[1]), ["d"]);
});

test("long lines are folded at 75 bytes so every calendar app reads them", () => {
  const ics = build([session({ description: "Footwork ladder, then live ball. ".repeat(10) })]);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test("links subscribe Apple through webcal and Google through its add-by-URL page", () => {
  const links = calendarLinks("https://abc.supabase.co/functions/v1", "0123456789abcdef0123456789abcdef");
  assert.equal(links.feed, "https://abc.supabase.co/functions/v1/player-calendar?token=0123456789abcdef0123456789abcdef");
  assert.equal(links.apple, "webcal://abc.supabase.co/functions/v1/player-calendar?token=0123456789abcdef0123456789abcdef");
  assert.equal(links.google, `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(links.apple)}`);
  assert.equal(links.session("s1"), `${links.feed}&session=s1`);
});

function setup(functionsUrl?: string) {
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()));
  if (functionsUrl) (store as { functionsUrl?: string }).functionsUrl = functionsUrl;
  const load = async (userId: string) => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    const ctx: Ctx = { store, actor, now: new Date() };
    return loadMySessions({ ...ctx, params: {}, search: {} });
  };
  return { store: store as Store, load };
}

test("each player gets one private link that stays the same", async () => {
  const { store, load } = setup("https://abc.supabase.co/functions/v1");
  const first = (await load(DEMO_IDS.sam)).calendar!;
  const again = (await load(DEMO_IDS.sam)).calendar!;
  assert.equal(first.feed, again.feed);
  assert.match(first.feed, /token=[0-9a-f]{32}$/);
  assert.notEqual((await load(DEMO_IDS.maya)).calendar!.feed, first.feed);
  assert.equal((await store.list("player_calendars")).length, 2);
});

test("the demo has no calendar link, and My Sessions still loads", async () => {
  const { load } = setup();
  const data = await load(DEMO_IDS.sam);
  assert.equal(data.calendar, null);
  assert.ok(Array.isArray(data.confirmed));
});
