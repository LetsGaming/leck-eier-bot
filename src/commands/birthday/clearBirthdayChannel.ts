import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { deleteBirthdayMessages, getAnchorProtectedMessageIds } from "../../services/birthdays.js";
import { getSettings } from "../../db/settingsRepository.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearBirthdayChannel)
  .setDescription("Clear all messages in the birthday announcements channel");

export async function execute(interaction: ChatInputCommandInteraction) {
  // Acknowledge immediately
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { birthdayListChannelId } = getSettings();
  if (!birthdayListChannelId) {
    return interaction.editReply({
      embeds: [createErrorEmbed("Birthday announcements channel not configured yet. Set it via the dashboard.")],
    });
  }

  // Never delete an anchor chunk — deleteBirthdayMessages() otherwise has no
  // way to tell a live anchor message apart from a stale announcement.
  const count = await deleteBirthdayMessages(
    interaction.client,
    birthdayListChannelId,
    getAnchorProtectedMessageIds(),
  );

  const successEmbed = createSuccessEmbed(
    `Cleared ${count} messages from the birthday announcements channel.`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
  });
}
