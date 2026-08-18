import { PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
import { loadConfig } from "../config/index.js";

/**
 * Checks if the user is the bot owner.
 */
export function isOwner(interaction: ChatInputCommandInteraction): boolean {
  const { botOwnerId } = loadConfig();
  return interaction.user.id === botOwnerId;
}

/**
 * Checks if user is either the bot owner or has administrator permissions.
 */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const ownerCheck = isOwner(interaction);

  // Check perms (with safety for DM interactions where member might be null)
  const hasAdminPerms =
    interaction.memberPermissions?.has(
      PermissionsBitField.Flags.Administrator,
    ) ?? false;

  return ownerCheck || hasAdminPerms;
}

/**
 * Checks if the interaction happened in the configured guild.
 */
export function isConfigGuild(interaction: ChatInputCommandInteraction): boolean {
  const { guildId } = loadConfig();
  return interaction.guildId === guildId;
}
