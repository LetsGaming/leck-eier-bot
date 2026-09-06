import type { ChatInputCommandInteraction } from "discord.js";
import { loadConfig } from "../config/index.js";

/**
 * Checks if the interaction happened in the configured guild.
 */
export function isConfigGuild(interaction: ChatInputCommandInteraction): boolean {
  const { guildId } = loadConfig();
  return interaction.guildId === guildId;
}
