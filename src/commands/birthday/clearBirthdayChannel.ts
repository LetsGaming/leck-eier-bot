import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { deleteBirthdayMessages } from "../../services/birthdays.js";
import { loadConfig } from "../../config/index.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearBirthdayChannel)
  .setDescription("Clear all messages in the birthday announcements channel");

export async function execute(interaction: ChatInputCommandInteraction) {
  // Acknowledge immediately
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = loadConfig();

  const count = await deleteBirthdayMessages(
    interaction.client,
    config.birthdayListChannelId,
    config.birthdayListMessageId,
  );

  const successEmbed = createSuccessEmbed(
    `Cleared ${count} messages from the birthday announcements channel.`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
  });
}
