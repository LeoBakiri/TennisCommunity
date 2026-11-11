import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type Store } from "../src/core/store";
import { demoSeed, DEMO_IDS } from "../src/core/seed";
import { runAction, type Ctx } from "../src/core/services";
import { loadMySessions } from "../src/core/queries";
import { cleanFeedUrl, parseIcs, upcomingClubEvents } from "../src/core/ical";
import type { Actor } from "../src/core/types";

const LINK = "https://app.courtreserve.com/Online/PublicIcal/Index/8017/4947373/4f66251d-b498-42a4-a11a-65c422f5455f";

const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

test("only CourtReserve calendar links are accepted", () => {
  assert.equal(cleanFeedUrl(`  ${LINK}/ `), LINK);
  assert.equal(cleanFeedUrl(LINK.replace("https://", "webcal://")), LINK);
  assert.equal(cleanFeedUrl("https://app.courtreserve.com/Online/Portal/Index/8017"), null);
  assert.equal(cleanFeedUrl("https://evil.example/Online/PublicIcal/Index/1"), null);
  assert.equal(cleanFeedUrl("https://app.courtreserve.com.evil.example/Online/PublicIcal/Index/1"), null);
  assert.equal(cleanFeedUrl("http://app.courtreserve.com/Online/PublicIcal/Index/1"), null);
  assert.equal(cleanFeedUrl(""), null);
});

test("reads UTC, zoned and all-day times, folded lines and escapes", () => {
  const events = parseIcs(
    ics(
      vevent("UID:b", "SUMMARY:Private Lesson", "DTSTART;TZID=America/Los_Angeles:20261114T080000", "DTEND;TZID=America/Los_Angeles:20261114T090000", "LOCATION:Balboa Tennis Club\\, San Diego"),
      vevent("UID:a", "SUMMARY:3.5 Drill Clinic with a very long name that Court", " Reserve folds onto a second line", "DTSTART:20261113T020000Z", "DTEND:20261113T033000Z"),
      vevent("UID:c", "SUMMARY:Club Social", "DTSTART;VALUE=DATE:20261120"),
      vevent("UID:d", "SUMMARY:Rained out", "STATUS:CANCELLED", "DTSTART:20261115T170000Z", "DTEND:20261115T180000Z"),
    ),
  );
  assert.deepEqual(events.map((e) => e.uid), ["a", "b", "c"]);
  assert.equal(events[0].title, "3.5 Drill Clinic with a very long name that CourtReserve folds onto a second line");
  assert.equal(events[0].starts_at, "2026-11-13T02:00:00.000Z");
  assert.equal(events[0].ends_at, "2026-11-13T03:30:00.000Z");
  assert.equal(events[1].starts_at, "2026-11-14T16:00:00.000Z"); // 8 AM Pacific in November
  assert.equal(events[1].location, "Balboa Tennis Club, San Diego");
  assert.equal(events[2].all_day, true);
  assert.equal(events[2].starts_at, "2026-11-20T08:00:00.000Z");
});

test("an empty CourtReserve calendar has no events", () => {
  assert.deepEqual(parseIcs("BEGIN:VCALENDAR\r\nPRODID:-//github.com/rianjs/ical.net//NONSGML ical.net 4.0//EN\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"), []);
});

test("only events that haven't ended, up to 60 days out, are shown", () => {
  const now = new Date("2026-11-11T20:00:00Z");
  const e = (uid: string, start: string, end: string) => ({ uid, title: uid, starts_at: start, ends_at: end, location: "", all_day: false });
  const kept = upcomingClubEvents([e("past", "2026-11-10T18:00:00Z", "2026-11-10T19:00:00Z"), e("now", "2026-11-11T19:30:00Z", "2026-11-11T20:30:00Z"), e("soon", "2026-11-20T18:00:00Z", "2026-11-20T19:00:00Z"), e("far", "2027-02-01T18:00:00Z", "2027-02-01T19:00:00Z")], now);
  assert.deepEqual(kept.map((x) => x.uid), ["now", "soon"]);
});

function setup(invoke?: Store["invoke"]) {
  const store = new MemoryStore({ load: async () => null, save: async () => undefined }, () => demoSeed(new Date()));
  if (invoke) (store as Store).invoke = invoke;
  const ctxFor = async (userId: string): Promise<Ctx> => {
    const user = await store.get("profiles", userId);
    const actor: Actor = { auth_id: userId, identifier: user?.email ?? null, user };
    return { store, actor, now: new Date() };
  };
  const load = async (userId: string) => loadMySessions({ ...(await ctxFor(userId)), params: {}, search: {} });
  return { store, ctxFor, load };
}

test("a player connects, sees their CourtReserve bookings in Upcoming, and disconnects", async () => {
  const soon = new Date(Date.now() + 2 * 86400000).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const later = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const { store, ctxFor, load } = setup(async <T>() => ({ ics: ics(vevent("UID:x", "SUMMARY:Tuesday Clinic", `DTSTART:${soon}`, `DTEND:${later}`)) }) as T);
  const sam = await ctxFor(DEMO_IDS.sam);

  assert.deepEqual((await load(DEMO_IDS.sam)).club, { connected: false, events: [], error: null });
  const bad = await runAction(sam, "connectCourtReserve", { url: "https://example.com/calendar.ics" });
  assert.equal(bad.ok, false);

  assert.equal((await runAction(sam, "connectCourtReserve", { url: LINK })).ok, true);
  assert.equal((await store.get("calendar_feeds", DEMO_IDS.sam))?.url, LINK);
  // Saving a new link replaces the old one.
  assert.equal((await runAction(sam, "connectCourtReserve", { url: `${LINK}x` })).ok, true);
  assert.equal((await store.list("calendar_feeds")).length, 1);

  const club = (await load(DEMO_IDS.sam)).club;
  assert.equal(club.connected, true);
  assert.deepEqual(club.events.map((e) => e.title), ["Tuesday Clinic"]);
  // Nobody else's page shows it.
  assert.equal((await load(DEMO_IDS.maya)).club.connected, false);

  assert.equal((await runAction(sam, "disconnectCourtReserve", {})).ok, true);
  assert.equal((await load(DEMO_IDS.sam)).club.connected, false);
});

test("My Sessions still loads when CourtReserve can't be reached", async () => {
  const { ctxFor, load } = setup(async () => {
    throw new Error("Couldn't reach CourtReserve.");
  });
  await runAction(await ctxFor(DEMO_IDS.sam), "connectCourtReserve", { url: LINK });
  const data = await load(DEMO_IDS.sam);
  assert.equal(data.club.connected, true);
  assert.deepEqual(data.club.events, []);
  assert.match(data.club.error!, /Couldn't reach CourtReserve/);
  assert.ok(Array.isArray(data.confirmed));
});

test("the demo shows sample club bookings once connected", async () => {
  const { ctxFor, load } = setup();
  await runAction(await ctxFor(DEMO_IDS.sam), "connectCourtReserve", { url: LINK });
  const { club } = await load(DEMO_IDS.sam);
  assert.equal(club.events.length, 3);
  assert.ok(club.events.every((e) => e.location === "Balboa Tennis Club"));
});
