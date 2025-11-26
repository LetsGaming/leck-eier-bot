import { SlashCommandBuilder, MessageFlags  } from "discord.js";
import { updateBirthdayListFromMessage } from "../services/birthdays.js";
import { isAdmin, loadConfig } from "../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("refreshbirthdays")
  .setDescription("Re-scan and update the birthday list")

export async function execute(interaction) {
  // Extra server-side safety check
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "❌ Only administrators can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const config = loadConfig();

  await updateBirthdayListFromMessage(interaction.client, config.birthdayListChannelId, config.birthdayListMessageId);

  return interaction.reply({
    content: "✅ Birthday list refreshed.",
    flags: MessageFlags.Ephemeral
  });
}
