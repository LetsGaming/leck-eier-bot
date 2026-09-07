import { z } from "zod";

/**
 * Raw `.env` shape. Everything here is a bootstrap/secret value needed
 * before the process (or the dashboard's HTTP server) can start at all —
 * settings an admin might want to change while the bot is running (birthday
 * template/channel/cron, per-command overrides, reaction-role panels) live
 * in the database instead and are edited from the dashboard, never here.
 * `.describe()` doubles as the example value used when generating
 * `.env.example` (see scripts/generateEnvExample.ts).
 */
export const EnvSchema = z.object({
  /**
   * Dev-only escape hatch: skips the real Discord gateway login and OAuth
   * dashboard login entirely, replacing them with a synthetic guild/roles/
   * channels/bot-owner session so the dashboard can be built and inspected
   * (design review, screenshotting, UI work) with no real Discord
   * application at all. `loadConfig()` fills every other required field
   * below with a mock default when this is `true`, and `startWebServer`
   * (via `registerAuthRoutes`) exposes `/auth/dev-login` to skip the OAuth
   * round-trip. Never set this in production — see docs/CONFIGURATION.md.
   */
  DEV_MOCK_DISCORD: z.enum(["true", "false"]).describe("false").optional(),

  DISCORD_TOKEN: z.string().min(1).describe("YOUR_BOT_TOKEN").optional(),
  DISCORD_CLIENT_ID: z.string().min(1).describe("YOUR_APPLICATION_ID").optional(),
  DISCORD_BOT_OWNER_ID: z.string().min(1).describe("YOUR_DISCORD_USER_ID").optional(),
  DISCORD_GUILD_ID: z.string().min(1).describe("YOUR_GUILD_ID").optional(),

  /**
   * IANA timezone name (e.g. "Europe/Berlin") the bot/dashboard treats as
   * "local" — every user-facing date/time (dashboard timestamps, Discord
   * replies that show a date, and what counts as "today" for birthday
   * matching) is displayed/computed in this zone instead of whatever the
   * server happens to default to (commonly UTC in a Docker container).
   * Dates are still always stored in UTC; this only affects display/"what
   * day is it" logic. Defaults to "Europe/Berlin" if unset.
   */
  TIMEZONE: z.string().min(1).describe("Europe/Berlin").optional(),

  /**
   * The dashboard is on by default whenever its required fields below are
   * all present; set this to "false" to force it off regardless.
   */
  WEB_ENABLED: z.enum(["true", "false"]).describe("true").optional(),
  WEB_PORT: z.coerce.number().int().describe("3000").optional(),
  /**
   * One or more origins (scheme + host + optional port, no trailing slash)
   * the dashboard is reachable at, comma-separated — e.g. a LAN name and a
   * public domain at once: `http://eier.lan.net,https://bot.example.com`.
   * Each one needs its own `<origin>/auth/callback` added as an OAuth2
   * redirect on the Discord application (see docs/DASHBOARD.md). Login
   * only works from an origin listed here; the bot rejects any other Host.
   */
  WEB_PUBLIC_URLS: z.string().min(1).describe("http://localhost:3000").optional(),
  WEB_SESSION_SECRET: z.string().min(32).describe("RANDOM_STRING_AT_LEAST_32_CHARS_LONG").optional(),
  /** Discord application's OAuth2 client secret — used for the dashboard login's code exchange. */
  DISCORD_CLIENT_SECRET: z.string().min(1).describe("YOUR_APPLICATION_SECRET").optional(),

  /**
   * Directory winston writes rotated log files to (error/combined/exceptions/
   * rejections logs — see src/utils/logger.ts). Defaults to `../logs`
   * relative to the process cwd if unset; created on startup if missing.
   */
  /**
   * Overrides where the SQLite database file lives (default: `data/` at
   * the project root — see src/db/index.ts). Only meant for
   * scripts/dev-up.mjs, so each isolated dev session gets its own DB file
   * instead of colliding on the shared one. Leave unset in production.
   */
  DATA_DIR: z.string().min(1).describe("./data").optional(),
  LOG_DIR: z.string().min(1).describe("../logs").optional(),
  /**
   * winston log level (e.g. "error", "warn", "info", "debug") controlling
   * both console and file output verbosity. Defaults to "info" if unset.
   */
  LOG_LEVEL: z.string().min(1).describe("info").optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface WebConfig {
  port: number;
  /** Non-empty; each entry is a bare origin (no trailing slash) — see {@link EnvSchema}'s WEB_PUBLIC_URLS. */
  publicUrls: string[];
  sessionSecret: string;
  clientSecret: string;
}

export interface Config {
  token: string;
  clientId: string;
  botOwnerId: string;
  guildId: string;
  /** IANA timezone name — see {@link EnvSchema}'s TIMEZONE. Always a validated, real timezone by the time it lands here. */
  timezone: string;
  /** Present only when the dashboard is enabled *and* fully configured — see {@link EnvSchema}'s WEB_* fields. */
  web?: WebConfig;
  /** See {@link EnvSchema}'s DEV_MOCK_DISCORD. Always `false` outside of deliberate local dev use. */
  devMockDiscord: boolean;
  // Deliberately no logDir/logLevel here: EnvSchema validates and
  // `.env.example` documents LOG_DIR/LOG_LEVEL, but nothing reads them via
  // Config — src/utils/logger.ts reads process.env directly (its own
  // dotenv-aware read, done that way specifically to avoid an import cycle
  // with this module; see the comments in both files), so surfacing them
  // here too would just be a second, unused, out-of-sync copy.
}
