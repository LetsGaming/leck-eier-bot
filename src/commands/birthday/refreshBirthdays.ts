import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { updateBirthdayListFromMessage } from "../../services/birthdays.js";
import { loadConfig } from "../../config/index.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.RefreshBirthdays)
  .setDescription("Re-scan and update the birthday list");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = loadConfig();

  await updateBirthdayListFromMessage(
    interaction.client,
    config.birthdayListChannelId,
    config.birthdayListMessageId,
  );

  const successEmbd = createSuccessEmbed("Birthday list refreshed.");
  return interaction.editReply({
    embeds: [successEmbd],
  });
}
