#!/usr/bin/env node
/**
 * Post-build step: `tsc` only emits `.js` for `.ts` inputs and silently drops everything else,
 * so the generated Drizzle migration files (`src/db/migrations/*.sql` + `meta/*.json`) need an
 * explicit copy into `dist/db/migrations/` — the same path `src/db/migrations.ts`'s
 * `__dirname`-relative `MIGRATIONS_FOLDER` resolves to once compiled. Run automatically as part
 * of `npm run build`, right after `tsc`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = path.join(repoRoot, "src", "db", "migrations");
const dest = path.join(repoRoot, "dist", "db", "migrations");

fs.cpSync(src, dest, { recursive: true });
console.log(`[copy-migrations] copied ${src} -> ${dest}`);
