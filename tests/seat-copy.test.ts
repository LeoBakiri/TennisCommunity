import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelNote, seatCopy } from "../src/ui/sessions";

const seat = (booked: number, capacity = 6, extra: { waitlist?: number; mine?: "confirmed" | "waitlisted" } = {}) => ({
  booked,
  capacity,
  spots_left: Math.max(0, capacity - booked),
  waitlist: extra.waitlist ?? 0,
  my_booking: extra.mine ? { id: "b", status: extra.mine, waitlist_position: null, spot_offered_at: null } : null,
});

test("the wording tightens as a session fills", () => {
  assert.deepEqual(seatCopy(seat(0)), { heat: "open", title: "Be the first in", sub: "6 spots open" });
  assert.deepEqual(seatCopy(seat(1)), { heat: "open", title: "5 spots left", sub: "Join 1 other player" });
  assert.deepEqual(seatCopy(seat(3)), { heat: "open", title: "3 spots left", sub: "Join 3 other players" });
  assert.deepEqual(seatCopy(seat(4)), { heat: "low", title: "Only 2 spots left", sub: "Join 4 other players" });
  assert.deepEqual(seatCopy(seat(5)), { heat: "low", title: "Last spot", sub: "Join 5 other players" });
});

test("a full session points to the waitlist", () => {
  assert.deepEqual(seatCopy(seat(6)), { heat: "full", title: "Full", sub: "Waitlist open" });
  assert.deepEqual(seatCopy(seat(6, 6, { waitlist: 2 })), { heat: "full", title: "Full", sub: "2 waiting" });
});

test("a waiting player sees the session is full and where they stand", () => {
  const waiting = (place: number, waitlist: number) => seatCopy({ ...seat(6, 6, { waitlist, mine: "waitlisted" }), my_booking: { id: "b", status: "waitlisted", waitlist_position: place, spot_offered_at: null } });
  assert.deepEqual(waiting(1, 1), { heat: "full", title: "Full", sub: "First open spot is yours" });
  assert.deepEqual(waiting(2, 2), { heat: "full", title: "Full", sub: "1 player ahead of you" });
  assert.deepEqual(waiting(4, 5), { heat: "full", title: "Full", sub: "3 players ahead of you" });
});

test("a booked player sees themself in the count", () => {
  assert.equal(seatCopy(seat(1, 6, { mine: "confirmed" })).sub, "You're the first in");
  assert.equal(seatCopy(seat(2, 6, { mine: "confirmed" })).sub, "You + 1 other");
  assert.equal(seatCopy(seat(6, 6, { mine: "confirmed" })).sub, "You + 5 others");
});

test("an empty small session isn't called scarce", () => {
  assert.equal(seatCopy(seat(0, 2)).heat, "open");
  assert.equal(seatCopy(seat(0, 1)).title, "Be the first in");
  assert.equal(seatCopy(seat(0, 1)).sub, "1 spot open");
});

test("the booking pop-up says until when a booking is free to cancel", () => {
  // Thu Nov 19, 5 PM Pacific; the 24-hour mark is Wed Nov 18, 5 PM.
  const s = { starts_at: "2026-11-20T01:00:00.000Z" };
  assert.equal(cancelNote(s, 24, Date.parse("2026-11-11T20:00:00Z")), "Free to cancel until Wed, Nov 18 at 5 PM. After that you can offer your spot to someone else.");
  assert.match(cancelNote(s, 24, Date.parse("2026-11-19T12:00:00Z")), /^It's less than 24 hours away, so once you're booked you can't cancel/);
});
