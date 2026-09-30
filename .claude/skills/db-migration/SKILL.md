---
name: db-migration
description: Generate a Drizzle migration after changing src/db/schema.ts. User-invoked only (schema changes have side effects on the local SQLite database).
disable-model-invocation: true
---

# DB Migration (Drizzle)

This repo uses `drizzle-kit generate` to produce migrations from `src/db/schema.ts`, and
`src/db/migrations.ts`'s `runMigrations()` to apply them — called automatically from
`src/db/index.ts` on every process start (dev, tests, prod), so there is no separate "apply"
step to run by hand. Migration files under `src/db/migrations/` are generated artifacts: never
hand-edit them (see the `PreToolUse` guard in `.claude/settings.json`, which blocks edits under
that folder). See `docs/DATABASE.md`'s [Migrations](../../docs/DATABASE.md#migrations) section
for the full design (legacy-baseline bridge, foreign-key safety during recreates, etc.).

## Steps

1. Confirm the schema change is complete and typechecks:
   ```
   npm run typecheck
   ```
2. Generate the migration:
   ```
   npm run db:generate
   ```
   (equivalent to `drizzle-kit generate`, using `drizzle.config.ts` at the repo root)
3. **Read the generated SQL** in the new `src/db/migrations/000N_*.sql` file before committing,
   checking for:
   - Unexpected `DROP COLUMN` / `DROP TABLE`, or a table *recreate* (drizzle-kit's usual
     strategy for a SQLite column change it can't do in place) on a table holding real data
   - Column type changes that could truncate or reject existing rows
   - Missing default values on new `NOT NULL` columns (SQLite will fail the migration on
     existing rows without one)
4. Apply and verify — just run the app or the tests; `runMigrations()` applies pending
   migrations as a side effect of opening the database:
   ```
   npm test          # tests/helpers/testDb.ts's createTestDb() migrates a fresh :memory: DB
   node scripts/dev-up.mjs --id <session-id>   # or a real isolated dev boot — see CLAUDE.md
   ```
5. If the schema change affects a repository's query shape, update the relevant
   `src/db/*Repository.ts` file's hand-written `db.prepare(...)` SQL and its `SignupRow`-style
   interface/mapper — `schema.ts` only drives migrations, nothing here auto-generates query code
   or TypeScript row types for the raw `better-sqlite3` layer.

## Notes

- There is no migration-rollback tooling. Treat schema changes as forward-only; if a mistake is
  generated, fix `schema.ts` and generate a corrective follow-up migration rather than editing
  or deleting the bad one once it has shipped to a real database.
- Never run `db:generate` against, or point `drizzle.config.ts`/`DATA_DIR` at, the shared
  `data/bot.sqlite` for exploratory schema changes — work against an isolated dev session's
  database (`node scripts/dev-up.mjs --id <session-id>`, per CLAUDE.md) or a throwaway copy, and
  confirm the target database with the user before applying anything to real data.
- A pre-Drizzle database (schema version older than the legacy baseline in
  `src/db/migrations.ts`'s `LEGACY_BASELINES`) refuses to boot with a clear error rather than
  silently corrupting — see that file's comments before touching the baseline logic.
