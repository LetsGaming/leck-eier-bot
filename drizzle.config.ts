import { defineConfig } from "drizzle-kit";

// Points at the working DB (DATA_DIR, defaulting to ./data like src/db/index.ts) so
// `drizzle-kit generate` always diffs against the same file the app actually migrates.
const dataDir = process.env.DATA_DIR ?? "./data";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `${dataDir}/bot.sqlite`,
  },
});
