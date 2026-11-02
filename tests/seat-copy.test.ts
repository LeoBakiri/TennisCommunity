import assert from "node:assert/strict";
import { test } from "node:test";
import { seatCopy } from "../src/ui/sessions";

const seat = (booked: number, capacity = 6, extra: { waitlist?: number; mine?: "confirmed" | "waitlisted" } = {}) => ({
  booked,
  capacity,
  spots_left: Math.max(0, capacity - booked),
  waitlist: extra.waitlist ?? 0,
  my_booking: extra.mine ? { id: "b", status: extra.mine, waitlist_position: null } : null,
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

test("a waiting player sees their place in line", () => {
  const waiting = (place: number, waitlist: number) => seatCopy({ ...seat(6, 6, { waitlist, mine: "waitlisted" }), my_booking: { id: "b", status: "waitlisted", waitlist_position: place } });
  assert.deepEqual(waiting(1, 1), { heat: "line", title: "You're next in", sub: "First open spot is yours" });
  assert.deepEqual(waiting(1, 3), { heat: "line", title: "You're next in", sub: "First open spot is yours · 2 behind you" });
  assert.deepEqual(waiting(2, 2), { heat: "line", title: "1 player ahead of you", sub: "You move in automatically" });
  assert.deepEqual(waiting(4, 5), { heat: "line", title: "3 players ahead of you", sub: "You move in automatically" });
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
