import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Exercises migration v33 (see MIGRATIONS in src/db/index.ts) in isolation,
// against a throwaway in-memory database, rather than importing
// src/db/index.ts directly — that module opens the real data/bot.sqlite file
// as a top-level side effect of import (see its own comment), which isn't
// something a unit test should trigger. There's no existing pattern in this
// repo for testing a migration against the real MIGRATIONS array, so this
// mirrors the exact v33 SQL instead — keep it in sync if that statement ever
// changes.
const V33_ALTER_TABLE_SQL = `ALTER TABLE command_settings ADD COLUMN permission_gate TEXT;`;

function makePreV33Db(): Database.Database {
  const db = new Database(":memory:");
  // Mirrors v2's command_settings table shape (src/db/index.ts) — the state
  // every real install is in immediately before v33 runs.
  db.exec(`
    CREATE TABLE command_settings (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      guild_only INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

test("migration v33: existing command_settings rows get permission_gate = NULL", () => {
  const db = makePreV33Db();
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only) VALUES (?, 1, 1)").run("preexisting-command");

  db.exec(V33_ALTER_TABLE_SQL);

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("preexisting-command") as
    | { permission_gate: string | null }
    | undefined;
  assert.ok(row);
  assert.equal(row.permission_gate, null);

  db.close();
});

test("migration v33: a NULL permission_gate falls back to defaultGateFor(permission), not a hardcoded default", async () => {
  const { defaultGateFor } = await import("../../src/types.js");
  const { CommandPermission } = await import("../../src/constants.js");

  const db = makePreV33Db();
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only) VALUES (?, 1, 1)").run("some-admin-command");
  db.exec(V33_ALTER_TABLE_SQL);

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("some-admin-command") as {
    permission_gate: string | null;
  };
  // Same "null -> null-coalesce to defaultGateFor()" logic as
  // getCommandOverride()/resolveCommandGate() (db/settingsRepository.ts,
  // utils/commandPermissions.ts) — a pre-v33 row never has an opinion of its
  // own, so the *code's* declared CommandPermission is what actually governs
  // enforcement immediately after upgrading.
  const gate = row.permission_gate !== null ? JSON.parse(row.permission_gate) : defaultGateFor(CommandPermission.Admin);
  assert.deepEqual(gate, { mode: "tier", tier: "admin" });

  db.close();
});

test("migration v33: a newly-set permission_gate round-trips as JSON", () => {
  const db = makePreV33Db();
  db.exec(V33_ALTER_TABLE_SQL);
  db.prepare("INSERT INTO command_settings (name, enabled, guild_only, permission_gate) VALUES (?, 1, 1, ?)").run(
    "gated-command",
    JSON.stringify({ mode: "role", roleId: "123" }),
  );

  const row = db.prepare("SELECT permission_gate FROM command_settings WHERE name = ?").get("gated-command") as {
    permission_gate: string;
  };
  assert.deepEqual(JSON.parse(row.permission_gate), { mode: "role", roleId: "123" });

  db.close();
});
