import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// listSignups() ordering: within a choice category, signups must come back
// in the order the choice was last set (first signup, or last time it
// actually changed) — not alphabetically. Same DATA_DIR-before-dynamic-import
// harness as the other seam tests, since eventAttendanceRepository.ts pulls
// in the real db/index.ts as an import side effect.
const dataDir = mkdtempSync(path.join(tmpdir(), "leb-test-signup-order-"));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, "logs");

const { createEvent, upsertSignupByUser, listSignups } = await import("../../src/db/eventAttendanceRepository.js");

function makeEvent(title: string) {
  return createEvent({
    messageId: `msg-${title}`,
    channelId: "announce-channel",
    title,
    description: "",
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    configuredVoiceChannelId: null,
    useFont: false,
  });
}

test("listSignups: within a category, signups are ordered by when their choice was set, not alphabetically", async () => {
  const event = makeEvent("Order-Test-1");

  // "Zeta" signs up before "Anna" — alphabetically Anna would come first,
  // but signup order should keep Zeta first.
  upsertSignupByUser(event.id, "user-zeta", "Zeta", "accepted");
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-anna", "Anna", "accepted");

  const accepted = listSignups(event.id).filter((s) => s.choice === "accepted");
  assert.deepEqual(
    accepted.map((s) => s.rawName),
    ["Zeta", "Anna"],
  );
});

test("listSignups: changing a vote moves the signup to the end of its new category, ordered by change time", async () => {
  const event = makeEvent("Order-Test-2");

  upsertSignupByUser(event.id, "user-1", "Player1", "accepted");
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-2", "Player2", "accepted");
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-3", "Player3", "declined");

  // Player1 changes their mind and declines too, after Player3 already had.
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-1", "Player1", "declined");

  const all = listSignups(event.id);
  const accepted = all.filter((s) => s.choice === "accepted").map((s) => s.rawName);
  const declined = all.filter((s) => s.choice === "declined").map((s) => s.rawName);

  assert.deepEqual(accepted, ["Player2"]);
  // Player3 declined first, Player1 declined later (after changing their vote) — Player1 goes last.
  assert.deepEqual(declined, ["Player3", "Player1"]);
});

test("listSignups: re-submitting the same choice does not reshuffle order", async () => {
  const event = makeEvent("Order-Test-3");

  upsertSignupByUser(event.id, "user-a", "Alice", "accepted");
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-b", "Bob", "accepted");

  // Alice re-clicks "accepted" again — should not move her after Bob.
  await new Promise((r) => setTimeout(r, 5));
  upsertSignupByUser(event.id, "user-a", "Alice", "accepted");

  const accepted = listSignups(event.id).filter((s) => s.choice === "accepted");
  assert.deepEqual(
    accepted.map((s) => s.rawName),
    ["Alice", "Bob"],
  );
});
