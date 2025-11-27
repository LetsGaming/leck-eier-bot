import { SlashCommandBuilder, MessageFlags  } from "discord.js";
import { updateBirthdayListFromMessage } from "../../services/birthdays.js";
import { isAdmin, loadConfig } from "../../utils/utils.js";
import { createNoAdminEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("refreshbirthdays")
  .setDescription("Re-scan and update the birthday list")

export async function execute(interaction) {
  // Extra server-side safety check
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral
    });
  }

  const config = loadConfig();

  await updateBirthdayListFromMessage(interaction.client, config.birthdayListChannelId, config.birthdayListMessageId);

  const successEmbd = createSuccessEmbed("Birthday list refreshed.");
  return interaction.reply({
    embeds: [successEmbd],
    flags: MessageFlags.Ephemeral
  });
}
