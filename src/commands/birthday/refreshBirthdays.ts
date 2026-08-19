import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { updateBirthdayListFromMessage, getBirthdayListLocation } from "../../services/birthdays.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.RefreshBirthdays)
  .setDescription("Re-scan and update the birthday list");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const location = getBirthdayListLocation();
  if (!location) {
    return interaction.editReply({
      embeds: [createErrorEmbed("Birthday list channel/message not configured yet. Set it via the dashboard.")],
    });
  }

  await updateBirthdayListFromMessage(
    interaction.client,
    location.channelId,
    location.messageId,
  );

  const successEmbd = createSuccessEmbed("Birthday list refreshed.");
  return interaction.editReply({
    embeds: [successEmbd],
  });
}
