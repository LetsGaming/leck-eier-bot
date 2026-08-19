import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { deleteBirthdayMessages, getBirthdayListLocation } from "../../services/birthdays.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearBirthdayChannel)
  .setDescription("Clear all messages in the birthday announcements channel");

export async function execute(interaction: ChatInputCommandInteraction) {
  // Acknowledge immediately
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const location = getBirthdayListLocation();
  if (!location) {
    return interaction.editReply({
      embeds: [createErrorEmbed("Birthday list channel/message not configured yet. Set it via the dashboard.")],
    });
  }

  const count = await deleteBirthdayMessages(
    interaction.client,
    location.channelId,
    location.messageId,
  );

  const successEmbed = createSuccessEmbed(
    `Cleared ${count} messages from the birthday announcements channel.`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
  });
}
