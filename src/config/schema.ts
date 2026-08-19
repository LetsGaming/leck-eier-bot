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
  DISCORD_TOKEN: z.string().min(1).describe("YOUR_BOT_TOKEN"),
  DISCORD_CLIENT_ID: z.string().min(1).describe("YOUR_APPLICATION_ID"),
  DISCORD_BOT_OWNER_ID: z.string().min(1).describe("YOUR_DISCORD_USER_ID"),
  DISCORD_GUILD_ID: z.string().min(1).describe("YOUR_GUILD_ID"),

  /**
   * The dashboard is on by default whenever its required fields below are
   * all present; set this to "false" to force it off regardless.
   */
  WEB_ENABLED: z.enum(["true", "false"]).describe("true").optional(),
  WEB_PORT: z.coerce.number().int().describe("3000").optional(),
  /** Must match the OAuth2 redirect registered on the Discord application, with `/auth/callback` appended. */
  WEB_PUBLIC_URL: z.string().min(1).describe("http://localhost:3000").optional(),
  WEB_SESSION_SECRET: z.string().min(32).describe("RANDOM_STRING_AT_LEAST_32_CHARS_LONG").optional(),
  /** Discord application's OAuth2 client secret — used for the dashboard login's code exchange. */
  DISCORD_CLIENT_SECRET: z.string().min(1).describe("YOUR_APPLICATION_SECRET").optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface WebConfig {
  port: number;
  publicUrl: string;
  sessionSecret: string;
  clientSecret: string;
}

export interface Config {
  token: string;
  clientId: string;
  botOwnerId: string;
  guildId: string;
  /** Present only when the dashboard is enabled *and* fully configured — see {@link EnvSchema}'s WEB_* fields. */
  web?: WebConfig;
}
