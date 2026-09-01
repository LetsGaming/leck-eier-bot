import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { deleteBirthdayMessages, getAnchorProtectedMessageIds } from "../../services/birthdays.js";
import { getSettings } from "../../db/settingsRepository.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearBirthdayChannel)
  .setDescription("Löscht alle Nachrichten im Geburtstags-Ankündigungskanal");

export async function execute(interaction: ChatInputCommandInteraction) {
  // Acknowledge immediately
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { birthdayListChannelId } = getSettings();
  if (!birthdayListChannelId) {
    return interaction.editReply({
      embeds: [createErrorEmbed("Der Geburtstags-Ankündigungskanal ist noch nicht konfiguriert. Lege ihn über das Dashboard fest.")],
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
    `${count} Nachrichten aus dem Geburtstags-Ankündigungskanal gelöscht.`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
  });
}
