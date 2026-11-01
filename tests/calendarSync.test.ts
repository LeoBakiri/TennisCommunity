import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMinutes, desiredEvents, eventIdFor, GoogleError, ReconnectNeeded, signState, syncSource, verifyState, type EventLink, type GoogleApi, type GoogleEvent, type LessonRow, type SessionRow, type SyncDeps } from "../supabase/functions/_shared/calendarSync";

const COACH_A = "11111111-1111-4111-8111-111111111111";
const COACH_B = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";

/** An in-memory stand-in for Google Calendar and the link table. */
function harness(source: SessionRow | LessonRow | null, opts: { connected?: string[]; lapsed?: string[] } = {}) {
  const google = new Map<string, Map<string, GoogleEvent>>(); // coach → event id → event
  const tombstones = new Set<string>();
  const links: EventLink[] = [];
  const log: string[] = [];
  const state = { source, failNext: 0, status: 500, reconnect: [] as string[], synced: [] as string[] };
  const connected = opts.connected ?? [COACH_A, COACH_B];
  const api = (coach: string): GoogleApi => {
    const cal = () => google.get(coach) ?? google.set(coach, new Map()).get(coach)!;
    const maybeFail = () => {
      if (state.failNext > 0) {
        state.failNext--;
        if (state.status === 401) throw new ReconnectNeeded("revoked");
        throw new GoogleError(state.status, `Google ${state.status}`);
      }
    };
    return {
      insert: async (_c, id, e) => {
        maybeFail();
        log.push("insert");
        if (cal().has(id) || tombstones.has(id)) throw new GoogleError(409, "exists");
        cal().set(id, e);
        return { id };
      },
      update: async (_c, id, e) => {
        maybeFail();
        log.push("update");
        if (!cal().has(id) && !tombstones.has(id)) throw new GoogleError(404, "missing");
        tombstones.delete(id);
        cal().set(id, e);
        return { id };
      },
      remove: async (_c, id) => {
        maybeFail();
        log.push("remove");
        if (!cal().delete(id)) throw new GoogleError(404, "missing");
        tombstones.add(id);
      },
    };
  };
  const deps: SyncDeps = {
    loadSource: async () => state.source,
    listLinks: async () => links.map((l) => ({ ...l })),
    saveLink: async (l) => {
      const i = links.findIndex((x) => x.coach_id === l.coach_id);
      if (i >= 0) links[i] = l;
      else links.push(l);
    },
    deleteLink: async (l) => void links.splice(links.findIndex((x) => x.coach_id === l.coach_id), 1),
    connection: async (c) => (opts.lapsed?.includes(c) ? "reconnect" : connected.includes(c) ? api(c) : "none"),
    markSynced: async (c) => void state.synced.push(c),
    markReconnect: async (c) => void state.reconnect.push(c),
  };
  return { deps, google, links, log, state, tombstones };
}

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: SID, session_type: "performance_accelerator", title: "Approach + Volley", starts_at: "2026-11-10T02:00:00.000Z", ends_at: "2026-11-10T03:00:00.000Z",
  coach_ids: [COACH_A], location: "Balboa", status: "published", description: "Notes", capacity: 8, ...over,
});
const lesson = (over: Partial<LessonRow> = {}): LessonRow => ({
  id: SID, coach_id: COACH_A, kind: "semi_private", client_names: ["Ann", "Bo"], starts_at: "2026-11-10T02:00:00.000Z", ends_at: "2026-11-10T03:00:00.000Z",
  location: "Balboa", price_cents: 11000, notes: "Doubles", ...over,
});
const events = (h: ReturnType<typeof harness>, coach = COACH_A) => [...(h.google.get(coach)?.values() ?? [])];

test("creating a session adds one event and stores its id", async () => {
  const h = harness(session());
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.equal(events(h)[0].summary, "Performance Accelerator: Approach + Volley");
  assert.equal(events(h)[0].start.timeZone, "America/Los_Angeles");
  assert.equal(h.links[0].google_event_id, eventIdFor("session", SID, COACH_A));
  assert.deepEqual(h.state.synced, [COACH_A]);
});

test("event ids use only the characters Google accepts", () => {
  assert.match(eventIdFor("lesson", SID, COACH_A), /^[a-v0-9]{5,1024}$/);
});

test("syncing again with no change makes no Google calls", async () => {
  const h = harness(session());
  await syncSource(h.deps, "session", SID);
  h.log.length = 0;
  await syncSource(h.deps, "session", SID);
  assert.deepEqual(h.log, []);
});

test("changing a lesson updates the existing event instead of creating a duplicate", async () => {
  const h = harness(lesson());
  await syncSource(h.deps, "lesson", SID);
  h.state.source = lesson({ location: "Court 9", client_names: ["Ann", "Bo", "Cy"] });
  await syncSource(h.deps, "lesson", SID);
  assert.deepEqual(h.log, ["insert", "update"]);
  assert.equal(events(h).length, 1);
  assert.equal(events(h)[0].location, "Court 9");
  assert.equal(events(h)[0].summary, "Semi-Private Lesson: Ann, Bo, Cy");
});

test("deleting a lesson removes its event and link", async () => {
  const h = harness(lesson());
  await syncSource(h.deps, "lesson", SID);
  h.state.source = null;
  assert.deepEqual(await syncSource(h.deps, "lesson", SID), []);
  assert.equal(events(h).length, 0);
  assert.equal(h.links.length, 0);
});

test("reassigning a session moves the event between coaches", async () => {
  const h = harness(session());
  await syncSource(h.deps, "session", SID);
  h.state.source = session({ coach_ids: [COACH_B] });
  await syncSource(h.deps, "session", SID);
  assert.equal(events(h, COACH_A).length, 0);
  assert.equal(events(h, COACH_B).length, 1);
  assert.deepEqual(h.links.map((l) => l.coach_id), [COACH_B]);
});

test("cancelled, draft and retired sessions have no calendar event", async () => {
  for (const over of [{ status: "cancelled" }, { status: "draft" }, { session_type: null }]) {
    const h = harness(session());
    await syncSource(h.deps, "session", SID);
    h.state.source = session(over);
    await syncSource(h.deps, "session", SID);
    assert.equal(events(h).length, 0, JSON.stringify(over));
  }
});

test("a coach who hasn't connected is skipped without error", async () => {
  const h = harness(session({ coach_ids: [COACH_A, COACH_B] }), { connected: [COACH_B] });
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.equal(events(h, COACH_B).length, 1);
  assert.deepEqual(h.links.map((l) => l.coach_id), [COACH_B]);
});

test("a Google failure is reported for retry and the retry succeeds without duplicates", async () => {
  const h = harness(session());
  h.state.failNext = 1;
  const errors = await syncSource(h.deps, "session", SID);
  assert.equal(errors.length, 1);
  assert.equal(h.links.length, 0);
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.equal(events(h).length, 1);
});

test("a crash after creating the event but before saving the link can't duplicate it", async () => {
  const h = harness(session());
  await syncSource(h.deps, "session", SID);
  h.links.length = 0; // the link was never saved
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.equal(events(h).length, 1);
  assert.equal(h.links.length, 1);
  assert.deepEqual(h.log, ["insert", "insert", "update"]);
});

test("an event deleted by hand in Google is restored on the next change", async () => {
  const h = harness(session());
  await syncSource(h.deps, "session", SID);
  const id = h.links[0].google_event_id;
  h.google.get(COACH_A)!.delete(id); // gone entirely, as Google reports 404
  h.state.source = session({ title: "Serve" });
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.equal(events(h)[0].summary, "Performance Accelerator: Serve");
});

test("revoked access pauses that coach without retrying forever", async () => {
  const h = harness(session());
  h.state.failNext = 1;
  h.state.status = 401;
  assert.deepEqual(await syncSource(h.deps, "session", SID), []);
  assert.deepEqual(h.state.reconnect, [COACH_A]);
});

test("while access has lapsed, links are kept so reconnecting can clean up", async () => {
  const h = harness(session(), { lapsed: [] });
  await syncSource(h.deps, "session", SID);
  const lapsed = harness(null, { lapsed: [COACH_A] });
  lapsed.links.push(...h.links);
  assert.deepEqual(await syncSource(lapsed.deps, "session", SID), []);
  assert.equal(lapsed.links.length, 1);
});

test("lesson events carry the price and notes", () => {
  const e = desiredEvents("lesson", lesson())!;
  assert.deepEqual(e.coachIds, [COACH_A]);
  assert.equal(e.event.description, "Price: $110\n\nDoubles");
});

test("retries back off and cap at six hours", () => {
  assert.deepEqual([1, 2, 3, 20].map(backoffMinutes), [1, 2, 4, 360]);
});

test("OAuth state is tamper-proof and expires", async () => {
  const state = await signState("secret", COACH_A, 1000);
  assert.equal(await verifyState("secret", state, 2000), COACH_A);
  assert.equal(await verifyState("other", state, 2000), null);
  assert.equal(await verifyState("secret", state, 1000 + 16 * 60000), null);
  assert.equal(await verifyState("secret", `x${state}`, 2000), null);
  assert.equal(await verifyState("secret", "", 2000), null);
});
