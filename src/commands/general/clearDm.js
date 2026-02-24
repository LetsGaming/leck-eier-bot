import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { isAdmin } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("cleardm")
  .setDescription(
    "Deletes the bot's messages in your DMs with an optional backup.",
  )
  .addBooleanOption((opt) =>
    opt
      .setName("save_history")
      .setDescription(
        "If true, sends a .txt file of the messages before deleting them.",
      )
      .setRequired(false),
  );

export async function execute(interaction) {
  // Owner check
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const shouldSave = interaction.options.getBoolean("save_history") ?? false;
  const dmChannel = await interaction.user.createDM();

  try {
    // Fetch last 100 messages from the DM channel
    const messages = await dmChannel.messages.fetch({ limit: 100 });
    // Bots can only delete their own messages in DMs
    const botMessages = messages.filter(
      (m) => m.author.id === interaction.client.user.id,
    );

    if (botMessages.size === 0) {
      return interaction.editReply({
        content: "ℹ️ No bot messages found to delete.",
        flags: MessageFlags.Ephemeral,
      });
    }

    let logContent = `CLEARED DM LOG\n`;
    logContent += `Exported on: ${new Date().toLocaleString("de-DE")}\n`;
    logContent += `--------------------------------------------------\n\n`;

    // 1. Generate the backup if requested
    if (shouldSave) {
      const sorted = [...botMessages.values()].reverse();
      sorted.forEach((msg) => {
        const time = msg.createdAt.toLocaleString("de-DE");
        logContent += `[${time}] BOT:\n${msg.cleanContent || "[Embed/Media]"}\n`;

        if (msg.attachments.size > 0) {
          msg.attachments.forEach(
            (att) => (logContent += ` > Attachment: ${att.url}\n`),
          );
        }
        logContent += `\n`;
      });
    }

    // 2. Perform the deletion
    let deletedCount = 0;
    for (const msg of botMessages.values()) {
      try {
        await msg.delete();
        deletedCount++;
        // 500ms delay to avoid aggressive rate limiting in DMs
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        // Continue if a specific message fails to delete
        continue;
      }
    }

    // 3. Final Reply
    if (shouldSave) {
      const buffer = Buffer.from(logContent, "utf-8");
      const attachment = new AttachmentBuilder(buffer, {
        name: "dm-backup.txt",
      });

      await interaction.editReply({
        content: `✅ Deleted ${deletedCount} messages. Here is your backup:`,
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        content: `✅ Successfully deleted ${deletedCount} messages from our DMs.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("Error in cleardm:", error);
    await interaction.editReply({
      content: "⚠️ An error occurred while trying to clear the DMs.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
