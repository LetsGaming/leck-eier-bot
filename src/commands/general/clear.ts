import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, MAX_CLEAR_AMOUNT, MESSAGE_DELETE_DELAY_MS } from "../../constants.js";
import { bulkDeleteWithPagination } from "../../services/messageCleanup.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.Clear)
  .setDescription("Löscht Nachrichten in diesem Kanal und umgeht Discords Limit von 100 Nachrichten pro Anfrage.")
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Wie viele Nachrichten gelöscht werden sollen.")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_CLEAR_AMOUNT),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const amount = interaction.options.getInteger("amount", true);
  const channel = interaction.channel;

  if (!channel || !channel.isTextBased() || channel.isDMBased() || !("bulkDelete" in channel)) {
    return interaction.reply({
      embeds: [createErrorEmbed("Dieser Befehl kann nur in einem Text-Kanal eines Servers verwendet werden.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const me = interaction.guild?.members.me;
  if (!me?.permissionsIn(channel.id).has(PermissionsBitField.Flags.ManageMessages)) {
    return interaction.reply({
      embeds: [createErrorEmbed("Ich benötige die Berechtigung \"Nachrichten verwalten\" in diesem Kanal, um das zu tun.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let deleted = 0;

  try {
    // `bulkDelete`'s `filterOld: true` skips messages older than Discord's
    // 14-day bulk-delete cutoff instead of throwing, and returns only the
    // ones actually deleted — this is the "batching" that lets `amount`
    // exceed the per-call limit; the helper falls back to deleting whatever
    // bulkDelete couldn't touch one at a time, rate-limited.
    const result = await bulkDeleteWithPagination(channel, {
      amount,
      delayMs: MESSAGE_DELETE_DELAY_MS,
      onProgress: (deletedSoFar) => {
        deleted = deletedSoFar;
      },
      onDeleteError: (msg, err) => {
        logger.warn(`/clear: failed to delete message ${msg.id}: ${errorMessage(err)}`);
      },
      onBulkDeleteError: (err) => {
        logger.warn(`/clear: bulkDelete batch failed: ${errorMessage(err)}`);
      },
    });
    deleted = result.deletedCount;

    return interaction.editReply({
      embeds: [createSuccessEmbed(`**${deleted}** Nachricht${deleted === 1 ? "" : "en"} gelöscht.`)],
    });
  } catch (err) {
    logger.error(`/clear failed: ${errorMessage(err)}`);
    return interaction.editReply({
      embeds: [createErrorEmbed(`${deleted} Nachricht(en) gelöscht, bevor ein Fehler auftrat.`)],
    });
  }
}
