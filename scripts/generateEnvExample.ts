/**
 * Generates .env.example from the zod EnvSchema so the template file can
 * never drift from what the app actually validates. Each field's example
 * value comes from its `.describe()` call in src/config/schema.ts — update
 * the schema, then re-run this script.
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { EnvSchema } from "../src/config/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function unwrapOptional<T extends z.ZodType>(schema: T): z.ZodType {
  return schema instanceof z.ZodOptional ? schema.unwrap() : schema;
}

function example(field: string, schema: z.ZodType): string {
  const inner = unwrapOptional(schema);
  const description = inner.description;
  if (description === undefined) {
    throw new Error(`EnvSchema field "${field}" is missing a .describe() example value`);
  }
  return description;
}

const { shape } = EnvSchema;

const lines: string[] = [
  "# Required — the bot won't start without these.",
  `DISCORD_TOKEN=${example("DISCORD_TOKEN", shape.DISCORD_TOKEN)}`,
  `DISCORD_CLIENT_ID=${example("DISCORD_CLIENT_ID", shape.DISCORD_CLIENT_ID)}`,
  `DISCORD_BOT_OWNER_ID=${example("DISCORD_BOT_OWNER_ID", shape.DISCORD_BOT_OWNER_ID)}`,
  `DISCORD_GUILD_ID=${example("DISCORD_GUILD_ID", shape.DISCORD_GUILD_ID)}`,
  "",
  "# Optional — IANA timezone name. Every user-facing date/time (dashboard",
  "# timestamps, Discord replies, and what counts as \"today\" for birthday",
  "# matching) uses this instead of the server's default (commonly UTC in",
  "# Docker). Dates are still always stored in UTC. Defaults to Europe/Berlin.",
  `TIMEZONE=${example("TIMEZONE", shape.TIMEZONE)}`,
  "",
  "# Optional — the web dashboard. Everything else (reaction roles, the",
  "# birthday template/channel/schedule, per-command toggles) is configured",
  "# from the dashboard itself once it's running, not here.",
  "# Leave these unset (or set WEB_ENABLED=false) to run without it.",
  `WEB_ENABLED=${example("WEB_ENABLED", shape.WEB_ENABLED)}`,
  `WEB_PORT=${example("WEB_PORT", shape.WEB_PORT)}`,
  `WEB_PUBLIC_URLS=${example("WEB_PUBLIC_URLS", shape.WEB_PUBLIC_URLS)}`,
  `WEB_SESSION_SECRET=${example("WEB_SESSION_SECRET", shape.WEB_SESSION_SECRET)}`,
  `DISCORD_CLIENT_SECRET=${example("DISCORD_CLIENT_SECRET", shape.DISCORD_CLIENT_SECRET)}`,
  "",
];

const outPath = path.resolve(__dirname, "..", ".env.example");
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`✔ Generated ${outPath}`);
