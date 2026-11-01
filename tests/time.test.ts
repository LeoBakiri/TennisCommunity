import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dateKey, fmtRange, startOfWeek, timeKey, weekdayOf, zonedToUtc } from "../src/core/time";

test("converts Los Angeles wall time to UTC in standard and daylight time", () => {
  // PDT (UTC-7)
  assert.equal(zonedToUtc("2026-07-06", "17:00").toISOString(), "2026-07-07T00:00:00.000Z");
  // PST (UTC-8)
  assert.equal(zonedToUtc("2026-12-07", "17:00").toISOString(), "2026-12-08T01:00:00.000Z");
});

test("handles the DST boundaries", () => {
  // Spring forward: 2026-03-08 02:00 → 03:00. 01:30 is PST, 03:30 is PDT.
  assert.equal(zonedToUtc("2026-03-08", "01:30").toISOString(), "2026-03-08T09:30:00.000Z");
  assert.equal(zonedToUtc("2026-03-08", "03:30").toISOString(), "2026-03-08T10:30:00.000Z");
  // Fall back: 2026-11-01. 17:00 that day is PST.
  assert.equal(zonedToUtc("2026-11-01", "17:00").toISOString(), "2026-11-02T01:00:00.000Z");
  // A weekly 5 PM clinic stays at 5 PM local across the change.
  const before = zonedToUtc("2026-10-26", "17:00");
  const after = zonedToUtc(addDays("2026-10-26", 7), "17:00");
  assert.equal(timeKey(before), "17:00");
  assert.equal(timeKey(after), "17:00");
  assert.equal(after.getTime() - before.getTime(), 7 * 86400000 + 3600000);
});

test("round-trips date and time keys", () => {
  const d = zonedToUtc("2026-11-15", "18:30");
  assert.equal(dateKey(d), "2026-11-15");
  assert.equal(timeKey(d), "18:30");
});

test("weeks start on Monday", () => {
  assert.equal(weekdayOf("2026-11-01"), 0);
  assert.equal(startOfWeek("2026-11-01"), "2026-10-26");
  assert.equal(startOfWeek("2026-11-02"), "2026-11-02");
});

test("formats time ranges compactly", () => {
  assert.equal(fmtRange(zonedToUtc("2026-11-02", "17:00"), zonedToUtc("2026-11-02", "18:30")), "5 – 6:30 PM");
  assert.equal(fmtRange(zonedToUtc("2026-11-02", "11:00"), zonedToUtc("2026-11-02", "12:00")), "11 AM – 12 PM");
});
