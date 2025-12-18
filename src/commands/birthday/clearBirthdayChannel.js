import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { deleteBirthdayMessages } from "../../services/birthdays.js";
import { isAdmin, loadConfig } from "../../utils/utils.js";
import { createNoAdminEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("clearbirthdaychannel")
  .setDescription("Clear all messages in the birthday announcements channel");

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral
    });
  }

  // Acknowledge immediately
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = loadConfig();

  const count = await deleteBirthdayMessages(
    interaction.client,
    config.birthdayListChannelId,
    config.birthdayListMessageId
  );

  const successEmbed = createSuccessEmbed(
    `Cleared ${count} messages from the birthday announcements channel.`
  );

  return interaction.editReply({
    embeds: [successEmbed]
  });
}
