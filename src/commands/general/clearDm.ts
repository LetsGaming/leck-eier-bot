import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { CommandName, CommandPermission, DM_DELETE_DELAY_MS } from "../../constants.js";
import { bulkDeleteWithPagination } from "../../services/messageCleanup.js";

export const permission = CommandPermission.Owner;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearDm)
  .setDescription("Löscht Bot-Nachrichten in deinen DMs.")
  .addBooleanOption((opt) =>
    opt
      .setName("save_history")
      .setDescription(
        "Wenn aktiviert, wird vor dem Löschen eine .txt-Datei mit den Nachrichten gesendet.",
      )
      .setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("Die Anzahl der zu löschenden Nachrichten (leer lassen für alle).")
      .setRequired(false)
      .setMinValue(1),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const shouldSave = interaction.options.getBoolean("save_history") ?? false;
  const amount = interaction.options.getInteger("amount"); // null if not set
  const dmChannel = await interaction.user.createDM();

  try {
    // Collects bot-authored messages (up to `amount`, or all of them) before
    // deleting anything, so the optional backup below is built from the
    // untouched messages and a fetch failure aborts before any deletion.
    const matchedMessages: Message[] = [];

    const { deletedCount } = await bulkDeleteWithPagination(dmChannel, {
      amount: amount ?? Infinity,
      amountMode: "matched",
      delayMs: DM_DELETE_DELAY_MS,
      delayOnFailure: false,
      filter: (m) => m.author.id === interaction.client.user.id,
      onCandidate: (msg) => matchedMessages.push(msg),
    });

    if (matchedMessages.length === 0) {
      return interaction.editReply({
        content: "ℹ️ Keine Bot-Nachrichten zum Löschen gefunden.",
      });
    }

    // Optional Backup
    let logContent = `DM CLEAR LOG\n`;
    logContent += `Exported: ${new Date().toLocaleString("de-DE")}\n`;
    logContent += `By: ${interaction.user.username} (${interaction.user.id})\n`;
    logContent += `----------------------------------\n\n`;

    if (shouldSave) {
      [...matchedMessages].reverse().forEach((msg) => {
        logContent += `[${msg.createdAt.toLocaleString("de-DE")}] BOT:\n${msg.cleanContent || "[Medien/Embed]"}\n`;
        msg.attachments.forEach(
          (att) => (logContent += ` > Link: ${att.url}\n`),
        );
        logContent += `\n`;
      });
    }

    // Response
    const finalMsg = `✅ **${deletedCount}** Bot-Nachrichten erfolgreich gelöscht.`;

    if (shouldSave) {
      const buffer = Buffer.from(logContent, "utf-8");
      const attachment = new AttachmentBuilder(buffer, {
        name: "dm-clear-backup.txt",
      });
      await interaction.editReply({
        content: finalMsg,
        files: [attachment],
      });
    } else {
      await interaction.editReply({
        content: finalMsg,
      });
    }
  } catch (error) {
    logger.error(`Error in cleardm: ${errorMessage(error)}`);
    await interaction.editReply({
      content: "⚠️ Beim Löschvorgang ist ein Fehler aufgetreten.",
    });
  }
}
