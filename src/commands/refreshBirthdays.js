import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags  } from "discord.js";
import { updateBirthdayListFromMessage } from "../services/birthdays.js";
import { loadConfig } from "../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("refreshbirthdays")
  .setDescription("Re-scan and update the birthday list")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // Extra server-side safety check
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Only administrators can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const config = loadConfig();

  await updateBirthdayListFromMessage(interaction.client, config.birthdayListChannelId, config.birthdayListMessageId);

  return interaction.reply({
    content: "✅ Birthday list refreshed.",
    fklags: MessageFlags.Ephemeral
  });
}
