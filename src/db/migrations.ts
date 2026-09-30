import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves correctly whether this runs from src/ (tsx) or dist/ (built): both sit one level
// under src/db or dist/db, so "./migrations" always lands next to this file regardless of caller cwd.
const MIGRATIONS_FOLDER = path.join(__dirname, "migrations");

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
// Same DDL drizzle-orm's own migrator creates on first run (sqlite-core/dialect.js) — declared
// here too so a legacy DB can be pre-stamped with rows before migrate() ever runs.
const CREATE_DRIZZLE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_TABLE}" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`;

// One-time bridge for this migration-system switch: how many of the generated migrations
// (in journal order) are already reflected in a pre-Drizzle database's schema, keyed by its
// PRAGMA user_version. 41 is the real, currently-deployed prod baseline — its schema is exactly
// what migration 0 (the generated baseline) creates. 42 only ever existed locally, on databases
// that got this session's now-deleted hand-written v42 migration (`choice_changed_at`) applied
// before the switch to Drizzle — its effect is identical to generated migration 1, so both are
// stamped rather than re-applied (re-running 0001's `ALTER TABLE ADD COLUMN` would fail with
// "duplicate column name" against such a database). Any other pre-Drizzle version refuses to
// boot — see the error below for why.
const LEGACY_BASELINES: Record<number, number> = {
  41: 1,
  42: 2,
};

function hasAnyTable(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get() !== undefined;
}

function hasTable(db: Database.Database, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/**
 * Pre-stamps a pre-Drizzle database as having already applied its first `count` generated
 * migrations, without running their SQL — see `LEGACY_BASELINES` above. `migrate()` (called
 * right after this) then only applies whatever comes after those.
 */
function stampLegacyBaseline(db: Database.Database, count: number): void {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  db.exec(CREATE_DRIZZLE_MIGRATIONS_TABLE);
  const insert = db.prepare(`INSERT INTO "${DRIZZLE_MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`);
  for (const migration of migrations.slice(0, count)) {
    insert.run(migration.hash, migration.folderMillis);
  }
}

/**
 * Applies every pending migration. Safe to call on every process start: drizzle tracks what's
 * already applied and no-ops the rest, so this is how the app stays on a schema that actually
 * exists (a fresh clone or a wiped data/ dir just works instead of 500ing on "no such table").
 *
 * `migrate()` runs every pending migration file inside ONE `session.transaction(...)` (verified
 * directly in drizzle-orm's sqlite dialect). SQLite ignores `PRAGMA foreign_keys` *inside* a
 * transaction, so a generated migration's own `PRAGMA foreign_keys=OFF` header (drizzle-kit
 * emits one at the top of any table-recreate migration) is a silent no-op, so FK enforcement
 * stays on, and a recreate's `DROP TABLE` then cascades onto every child row instead of just
 * the table being rebuilt. Toggling the pragma from out here, before `migrate()` opens its own
 * transaction, is what actually disables it. The `foreign_key_check` afterward is the backstop:
 * cheap, and it's the only thing that would catch a mis-ordered or mis-written recreate leaving
 * orphaned rows instead of failing loudly. (Same approach as liftr's packages/db/src/migrations.ts.)
 */
export function runMigrations(db: Database.Database): void {
  if (hasAnyTable(db) && !hasTable(db, DRIZZLE_MIGRATIONS_TABLE)) {
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    const alreadyApplied = LEGACY_BASELINES[userVersion];
    if (alreadyApplied === undefined) {
      throw new Error(
        `Refusing to start: database is at schema version ${userVersion}, which predates the ` +
          "Drizzle migration baseline (introduced at v41). Upgrade this database on a release " +
          "before the Drizzle migration switch first, then retry.",
      );
    }
    stampLegacyBaseline(db, alreadyApplied);
  }

  db.pragma("foreign_keys = OFF");
  try {
    migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    db.pragma("foreign_keys = ON");
  }
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`runMigrations: foreign_key_check found ${violations.length} violation(s) after migrating`);
  }
}
