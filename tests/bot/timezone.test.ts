import { test } from "node:test";
import assert from "node:assert/strict";
import { nextWeekdayOccurrenceUtc } from "../../src/utils/timezone.js";

const TZ = "Europe/Berlin";

test("nextWeekdayOccurrenceUtc: finds the next matching weekday when today doesn't match", () => {
  // 2026-09-14 is a Monday (weekday 1); ask for Wednesday (3) at 20:00-22:00.
  const now = Date.parse("2026-09-14T10:00:00.000Z");
  const { startsAt, endsAt } = nextWeekdayOccurrenceUtc(3, "20:00", "22:00", TZ, now);
  // 2026-09-16 20:00 Europe/Berlin (CEST, UTC+2) = 18:00 UTC.
  assert.equal(startsAt, "2026-09-16T18:00:00.000Z");
  assert.equal(endsAt, "2026-09-16T20:00:00.000Z");
});

test("nextWeekdayOccurrenceUtc: today counts if its occurrence hasn't started yet", () => {
  // 2026-09-14 is a Monday; ask for Monday at 20:00, while it's still 10:00 UTC that day.
  const now = Date.parse("2026-09-14T10:00:00.000Z");
  const { startsAt } = nextWeekdayOccurrenceUtc(1, "20:00", "22:00", TZ, now);
  assert.equal(startsAt, "2026-09-14T18:00:00.000Z");
});

test("nextWeekdayOccurrenceUtc: rolls to next week if today's occurrence already passed", () => {
  // Still Monday 2026-09-14, but past 20:00 Berlin time (18:00 UTC) already.
  const now = Date.parse("2026-09-14T19:00:00.000Z");
  const { startsAt } = nextWeekdayOccurrenceUtc(1, "20:00", "22:00", TZ, now);
  assert.equal(startsAt, "2026-09-21T18:00:00.000Z");
});

test("nextWeekdayOccurrenceUtc: an end time before the start time crosses midnight", () => {
  const now = Date.parse("2026-09-14T10:00:00.000Z");
  const { startsAt, endsAt } = nextWeekdayOccurrenceUtc(1, "22:00", "01:00", TZ, now);
  assert.equal(startsAt, "2026-09-14T20:00:00.000Z");
  // 01:00 CEST on Sept 15 is 23:00 UTC on Sept 14 — the UTC calendar day
  // doesn't roll over even though the wall-clock date (in Berlin) did.
  assert.equal(endsAt, "2026-09-14T23:00:00.000Z");
});
