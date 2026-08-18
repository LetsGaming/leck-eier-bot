import { z } from "zod";

/**
 * Per-command overrides. `describe()` doubles as the example value used
 * when generating the config template (see scripts/generateConfigTemplate.ts).
 */
export const CommandConfigSchema = z.object({
  enabled: z.boolean().describe("true").optional(),
  guildOnly: z.boolean().describe("true").optional(),
});

export const ConfigSchema = z.object({
  token: z.string().min(1).describe("YOUR_BOT_TOKEN"),
  clientId: z.string().min(1).describe("YOUR_APPLICATION_ID"),
  botOwnerId: z.string().min(1).describe("YOUR_DISCORD_USER_ID"),
  guildId: z.string().min(1).describe("YOUR_GUILD_ID"),
  birthdayListChannelId: z.string().min(1).describe("CHANNEL_ID_OF_THE_LIST"),
  birthdayListMessageId: z.string().min(1).describe("MESSAGE_ID_OF_THE_LIST"),
  commands: z.record(z.string(), CommandConfigSchema).optional(),
});

export type CommandConfig = z.infer<typeof CommandConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
