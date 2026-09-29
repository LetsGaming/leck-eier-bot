import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTempVoiceChannelName,
  validateTempVoiceRequest,
  resolveCategoryId,
  selectBindingEvent,
  isTempChannelDue,
} from "../../src/shared/temporaryVoiceChannels.js";
import { TEMP_VOICE_HARD_MAX_AMOUNT } from "../../src/constants.js";
import type { Event, EventStatus } from "../../src/types.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    messageId: "msg-1",
    channelId: "chan-1",
    title: "Test-Event",
    description: "",
    startsAt: "2026-01-01T20:00:00.000Z",
    endsAt: "2026-01-01T22:00:00.000Z",
    status: "scheduled",
    configuredVoiceChannelId: null,
    voiceChannelId: null,
    activatedAt: null,
    completedAt: null,
    trackingIncomplete: false,
    remindedAt: null,
    useFont: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    channelClearedAt: null,
    ...overrides,
  };
}

// --- buildTempVoiceChannelName ---------------------------------------------

test("buildTempVoiceChannelName: substitutes {n} with the 1-based index", () => {
  assert.equal(buildTempVoiceChannelName("Gruppe {n}", { index: 1, eventTitle: null }), "Gruppe 1");
  assert.equal(buildTempVoiceChannelName("Gruppe {n}", { index: 3, eventTitle: null }), "Gruppe 3");
});

test("buildTempVoiceChannelName: substitutes {event} with the bound event's title", () => {
  assert.equal(buildTempVoiceChannelName("{event} – Team {n}", { index: 2, eventTitle: "Raid Night" }), "Raid Night – Team 2");
});

test("buildTempVoiceChannelName: {event} collapses to nothing when unbound, without leaving stray whitespace", () => {
  assert.equal(buildTempVoiceChannelName("{event} Gruppe {n}", { index: 1, eventTitle: null }), "Gruppe 1");
});

test("buildTempVoiceChannelName: appends the index when the format has no {n}", () => {
  assert.equal(buildTempVoiceChannelName("Team", { index: 4, eventTitle: null }), "Team 4");
});

test("buildTempVoiceChannelName: truncates to Discord's 100-character channel-name cap", () => {
  const longFormat = "x".repeat(120) + " {n}";
  const name = buildTempVoiceChannelName(longFormat, { index: 1, eventTitle: null });
  assert.ok(name.length <= 100);
});

test("buildTempVoiceChannelName: falls back to the bare index if the result would otherwise be empty", () => {
  assert.equal(buildTempVoiceChannelName("{event}", { index: 5, eventTitle: null }), "5");
});

// --- validateTempVoiceRequest -----------------------------------------------

test("validateTempVoiceRequest: rejects a group size of 0 or above 99", () => {
  assert.equal(validateTempVoiceRequest({ amount: 1, groupSize: 0, configuredMax: 15 }).ok, false);
  assert.equal(validateTempVoiceRequest({ amount: 1, groupSize: 100, configuredMax: 15 }).ok, false);
});

test("validateTempVoiceRequest: accepts group sizes of 1 and 99", () => {
  assert.equal(validateTempVoiceRequest({ amount: 1, groupSize: 1, configuredMax: 15 }).ok, true);
  assert.equal(validateTempVoiceRequest({ amount: 1, groupSize: 99, configuredMax: 15 }).ok, true);
});

test("validateTempVoiceRequest: rejects an amount of 0", () => {
  assert.equal(validateTempVoiceRequest({ amount: 0, groupSize: 4, configuredMax: 15 }).ok, false);
});

test("validateTempVoiceRequest: amount is bounded by the configured max, not just the hard ceiling", () => {
  assert.equal(validateTempVoiceRequest({ amount: 16, groupSize: 4, configuredMax: 15 }).ok, false);
  assert.equal(validateTempVoiceRequest({ amount: 16, groupSize: 4, configuredMax: 20 }).ok, true);
});

test("validateTempVoiceRequest: the hard ceiling wins even when the configured max is higher", () => {
  const result = validateTempVoiceRequest({ amount: TEMP_VOICE_HARD_MAX_AMOUNT + 1, groupSize: 4, configuredMax: 99 });
  assert.equal(result.ok, false);
});

test("validateTempVoiceRequest: the hard ceiling itself is accepted", () => {
  assert.equal(validateTempVoiceRequest({ amount: TEMP_VOICE_HARD_MAX_AMOUNT, groupSize: 4, configuredMax: 99 }).ok, true);
});

// --- resolveCategoryId -------------------------------------------------------

test("resolveCategoryId: the configured category wins over the invoking channel's parent", () => {
  assert.equal(resolveCategoryId("configured-cat", "invoking-parent"), "configured-cat");
});

test("resolveCategoryId: falls back to the invoking channel's parent when nothing is configured", () => {
  assert.equal(resolveCategoryId(null, "invoking-parent"), "invoking-parent");
});

test("resolveCategoryId: falls back to null (guild root) when neither is set", () => {
  assert.equal(resolveCategoryId(null, null), null);
});

// --- selectBindingEvent -------------------------------------------------------

test("selectBindingEvent: an active event wins over any scheduled ones", () => {
  const active = makeEvent({ id: 1, status: "active" });
  const scheduled = makeEvent({ id: 2, status: "scheduled", startsAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(selectBindingEvent([active], [scheduled]), active);
});

test("selectBindingEvent: the soonest-starting scheduled event is picked when nothing is active", () => {
  const soon = makeEvent({ id: 1, startsAt: "2026-01-01T10:00:00.000Z" });
  const later = makeEvent({ id: 2, startsAt: "2026-01-02T10:00:00.000Z" });
  assert.equal(selectBindingEvent([], [later, soon]), soon);
});

test("selectBindingEvent: null when there's neither an active nor a scheduled event", () => {
  assert.equal(selectBindingEvent([], []), null);
});

// --- isTempChannelDue ---------------------------------------------------------

test("isTempChannelDue: an unbound set is never due automatically", () => {
  assert.equal(isTempChannelDue(makeEvent({ status: "completed" }), null), false);
  assert.equal(isTempChannelDue(null, null), false);
});

test("isTempChannelDue: a bound set whose event row has vanished is due", () => {
  assert.equal(isTempChannelDue(null, 1), true);
});

test("isTempChannelDue: due once the bound event is completed or cancelled, not while scheduled/active", () => {
  const statuses: [EventStatus, boolean][] = [
    ["scheduled", false],
    ["active", false],
    ["completed", true],
    ["cancelled", true],
  ];
  for (const [status, expected] of statuses) {
    assert.equal(isTempChannelDue(makeEvent({ status }), 1), expected, `status=${status}`);
  }
});
