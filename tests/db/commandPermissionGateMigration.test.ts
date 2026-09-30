import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../helpers/testDb.js";

// command_settings.permission_gate is nullable — a row with no override falls back to the
// code-declared CommandPermission (see getCommandOverride()/resolveCommandGate() in
// db/settingsRepository.ts / utils/commandPermissions.ts), and a set override round-trips as
// JSON. Exercised here against a real migrated schema (createTestDb()) rather than the real
// data/bot.sqlite, which src/db/index.ts opens as a top-level import side effect.

test("command_settings.permission_gate: a fresh row defaults to NULL (no override)", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only) VALUES (?, 1, 1)").run("preexisting-command");

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("preexisting-command") as
    | { permission_gate: string | null }
    | undefined;
  assert.ok(row);
  assert.equal(row.permission_gate, null);
});

test("command_settings.permission_gate: NULL falls back to defaultGateFor(permission), not a hardcoded default", async () => {
  const { defaultGateFor } = await import("../../src/types.js");
  const { CommandPermission } = await import("../../src/constants.js");

  const db = createTestDb();
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only) VALUES (?, 1, 1)").run("some-admin-command");

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("some-admin-command") as {
    permission_gate: string | null;
  };
  // Same "null -> null-coalesce to defaultGateFor()" logic as
  // getCommandOverride()/resolveCommandGate() — a row with no override of its own is governed
  // by the code's declared CommandPermission.
  const gate = row.permission_gate !== null ? JSON.parse(row.permission_gate) : defaultGateFor(CommandPermission.Admin);
  assert.deepEqual(gate, { mode: "tier", tier: "admin" });
});

test("command_settings.permission_gate: a set override round-trips as JSON", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only, permission_gate) VALUES (?, 1, 1, ?)").run(
    "gated-command",
    JSON.stringify({ mode: "role", roleId: "123" }),
  );

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("gated-command") as {
    permission_gate: string;
  };
  assert.deepEqual(JSON.parse(row.permission_gate), { mode: "role", roleId: "123" });
});
