import { test } from "node:test";
import assert from "node:assert/strict";
import { levelLabel, memberStats } from "../src/core/members";
import type { Booking, Session } from "../src/core/types";

const now = new Date("2026-11-20T18:00:00Z");
const sess = (id: string, starts: string, over: Partial<Session> = {}): Session => ({
  id, session_type: "group", title: "", starts_at: starts, ends_at: new Date(new Date(starts).getTime() + 3600000).toISOString(), coach_ids: [], capacity: 12, price_cents: null,
  location: "", court: null, status: "published", description: "", internal_notes: "", created_at: "", ...over,
});
const book = (id: string, session_id: string, over: Partial<Booking> = {}): Booking =>
  ({ id, session_id, user_id: "u1", status: "confirmed", seats: 1, waitlist_position: null, attended: null, late_cancel: false, created_at: "", ...over }) as Booking;

test("counts played, upcoming, no-shows and late cancels per member", () => {
  const sessions = new Map(
    [
      sess("a", "2026-10-28T17:00:00Z"),
      sess("b", "2026-11-04T17:00:00Z", { session_type: "performance_accelerator" }),
      sess("c", "2026-11-11T17:00:00Z"),
      sess("d", "2026-11-25T17:00:00Z"),
      sess("e", "2026-11-13T17:00:00Z", { status: "cancelled" }),
      sess("f", "2026-11-14T17:00:00Z"),
      sess("g", "2026-11-15T17:00:00Z"),
      sess("h", "2026-11-16T17:00:00Z", { session_type: null }),
    ].map((s) => [s.id, s]),
  );
  const st = memberStats(
    [
      book("1", "a"),
      book("2", "b", { attended: true }),
      book("3", "c"),
      book("3b", "c", { status: "cancelled" }), // booked again after cancelling: counts once
      book("4", "d"),
      book("5", "e"),
      book("6", "f", { attended: false }),
      book("7", "g", { status: "cancelled", late_cancel: true }),
      book("8", "h"),
      book("9", "a", { user_id: "u2", status: "waitlisted" }),
    ],
    sessions,
    now,
    "2026-11-01T07:00:00Z",
  ).get("u1")!;
  assert.deepEqual(st, { played: 3, group: 2, pa: 1, upcoming: 1, noShows: 1, lateCancels: 1, lastPlayed: "2026-11-11T17:00:00Z", playedThisMonth: 2 });
});

test("level labels", () => {
  assert.equal(levelLabel("intermediate"), "Intermediate");
  assert.equal(levelLabel(""), "");
  assert.equal(levelLabel(undefined), "");
});
