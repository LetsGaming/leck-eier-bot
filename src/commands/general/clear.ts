import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import {
  CommandName,
  CommandPermission,
  DISCORD_FETCH_PAGE_SIZE,
  MAX_CLEAR_AMOUNT,
  MESSAGE_DELETE_DELAY_MS,
} from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.Clear)
  .setDescription("Löscht Nachrichten in diesem Kanal und umgeht dabei Discords Limit von 100 Nachrichten pro Löschanfrage.")
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Wie viele Nachrichten gelöscht werden sollen.")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_CLEAR_AMOUNT),
  );

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  let lastId: string | undefined;

  try {
    while (deleted < amount) {
      const batchSize = Math.min(DISCORD_FETCH_PAGE_SIZE, amount - deleted);
      const fetched = await channel.messages.fetch({ limit: batchSize, before: lastId });
      if (fetched.size === 0) break;
      lastId = fetched.last()?.id;

      // `filterOld: true` skips messages older than Discord's 14-day bulk-delete
      // cutoff instead of throwing, and returns only the ones actually deleted —
      // this is the "batching" that lets `amount` exceed the per-call limit.
      const bulkDeleted = await channel.bulkDelete(fetched, true).catch((err) => {
        logger.warn(`/clear: bulkDelete batch failed: ${errorMessage(err)}`);
        return null;
      });
      deleted += bulkDeleted?.size ?? 0;

      // Whatever bulkDelete couldn't touch (too old, or the whole batch
      // failed) still needs deleting one at a time, rate-limited.
      const remaining = bulkDeleted ? fetched.filter((m) => !bulkDeleted.has(m.id)) : fetched;
      for (const msg of remaining.values()) {
        try {
          await msg.delete();
          deleted++;
        } catch (err) {
          logger.warn(`/clear: failed to delete message ${msg.id}: ${errorMessage(err)}`);
        }
        await sleep(MESSAGE_DELETE_DELAY_MS);
      }

      if (fetched.size < batchSize) break; // ran out of channel history
    }

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
