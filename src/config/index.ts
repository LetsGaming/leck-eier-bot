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
  const webComplete = publicUrls.length > 0 && !!env.WEB_SESSION_SECRET && !!env.DISCORD_CLIENT_SECRET;

  let web: Config["web"];
  if (webRequested && webComplete) {
    web = {
      port: env.WEB_PORT ?? 3000,
      publicUrls,
      sessionSecret: env.WEB_SESSION_SECRET!,
      clientSecret: env.DISCORD_CLIENT_SECRET!,
    };
  } else if (webRequested) {
    logger.warn(
      "Dashboard not starting: WEB_PUBLIC_URLS, WEB_SESSION_SECRET, and DISCORD_CLIENT_SECRET must all be set. " +
        "Set WEB_ENABLED=false to silence this warning if you don't want the dashboard.",
    );
  }

  cachedConfig = {
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    botOwnerId: env.DISCORD_BOT_OWNER_ID,
    guildId: env.DISCORD_GUILD_ID,
    web,
  };
  return cachedConfig;
}

export type { Config } from "./schema.js";
