import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import logger from "../utils/logger.js";
import { EnvSchema, type Config } from "./schema.js";

let cachedConfig: Config | null = null;

/**
 * Loads and validates process.env (via `.env` at the current working
 * directory — `npm run dev`/`npm start`/the Docker image all run with cwd
 * at the project root, so one `.env` file covers every mode; no more
 * src/-vs-dist/ path juggling like the old config.json had).
 *
 * `dotenv` never overwrites variables already set in the environment, so
 * real env vars (e.g. injected by Docker/systemd) always win over `.env`.
 */
export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  loadDotenv();

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = z.prettifyError(parsed.error);
    const message = `❌ Environment configuration is invalid:\n${issues}\n\nCopy .env.example to .env and fill in real values (see docs/CONFIGURATION.md).`;
    logger.error(message);
    throw new Error(message);
  }
  const env = parsed.data;
  const devMockDiscord = env.DEV_MOCK_DISCORD === "true";

  if (!devMockDiscord) {
    const missing = (
      [
        ["DISCORD_TOKEN", env.DISCORD_TOKEN],
        ["DISCORD_CLIENT_ID", env.DISCORD_CLIENT_ID],
        ["DISCORD_BOT_OWNER_ID", env.DISCORD_BOT_OWNER_ID],
        ["DISCORD_GUILD_ID", env.DISCORD_GUILD_ID],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      const message = `❌ Missing required environment variable(s): ${missing.join(", ")}.\n\nCopy .env.example to .env and fill in real values (see docs/CONFIGURATION.md), or set DEV_MOCK_DISCORD=true for a no-credentials local dashboard build.`;
      logger.error(message);
      throw new Error(message);
    }
  } else {
    logger.warn(
      "DEV_MOCK_DISCORD=true — running with a synthetic Discord guild/session, no real bot login or OAuth. Never use this in production.",
    );
  }

  const timezone = env.TIMEZONE || "Europe/Berlin";
  try {
    // Intl throws RangeError on an unrecognized IANA name — fail fast at
    // startup rather than silently falling back somewhere deep in a date
    // formatter.
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    const message = `❌ TIMEZONE "${timezone}" is not a recognized IANA timezone name (e.g. "Europe/Berlin").`;
    logger.error(message);
    throw new Error(message);
  }

  // Comma-separated list -> normalized, deduplicated origins (no trailing
  // slash, so string comparison against a request's computed origin is a
  // plain equality check everywhere else in the app).
  const publicUrls = [
    ...new Set(
      (env.WEB_PUBLIC_URLS ?? "")
        .split(",")
        .map((url) => url.trim().replace(/\/+$/, ""))
        .filter(Boolean),
    ),
  ];

  const webRequested = env.WEB_ENABLED !== "false";
  // Mock mode needs no real OAuth app, so it fills in placeholder web
  // fields itself rather than requiring WEB_SESSION_SECRET/CLIENT_SECRET
  // just to reach the dashboard — DEV_MOCK_DISCORD=true is meant to be the
  // only line a fresh checkout needs.
  const webComplete = devMockDiscord || (publicUrls.length > 0 && !!env.WEB_SESSION_SECRET && !!env.DISCORD_CLIENT_SECRET);

  let web: Config["web"];
  if (webRequested && webComplete) {
    web = {
      port: env.WEB_PORT ?? 3000,
      publicUrls: publicUrls.length > 0 ? publicUrls : ["http://localhost:3000"],
      sessionSecret: env.WEB_SESSION_SECRET ?? "dev-mock-session-secret-do-not-use-in-production!",
      clientSecret: env.DISCORD_CLIENT_SECRET ?? "dev-mock-client-secret",
    };
  } else if (webRequested) {
    logger.warn(
      "Dashboard not starting: WEB_PUBLIC_URLS, WEB_SESSION_SECRET, and DISCORD_CLIENT_SECRET must all be set. " +
        "Set WEB_ENABLED=false to silence this warning if you don't want the dashboard.",
    );
  }

  cachedConfig = {
    token: env.DISCORD_TOKEN ?? "dev-mock-token",
    clientId: env.DISCORD_CLIENT_ID ?? "dev-mock-client-id",
    botOwnerId: env.DISCORD_BOT_OWNER_ID ?? "1000000000000000001",
    guildId: env.DISCORD_GUILD_ID ?? "1000000000000000002",
    timezone,
    web,
    devMockDiscord,
  };
  return cachedConfig;
}

export type { Config } from "./schema.js";
