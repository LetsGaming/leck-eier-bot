import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { isOwner } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("cleardm")
  .setDescription(
    "Deletes all bot messages in your DMs (handles more than 100).",
  )
  .addBooleanOption((opt) =>
    opt
      .setName("save_history")
      .setDescription(
        "If true, sends a .txt file of all messages before deleting them.",
      )
      .setRequired(false),
  );

export async function execute(interaction) {
  if (!isOwner(interaction)) {
    return interaction.reply({
      content: "❌ You do not have permission to use this command.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const shouldSave = interaction.options.getBoolean("save_history") ?? false;
  const dmChannel = await interaction.user.createDM();

  try {
    let allBotMessages = [];
    let lastId = null;
    let fetching = true;

    // 1. Fetch ALL messages (Looping 100 at a time)
    while (fetching) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await dmChannel.messages.fetch(options);
      if (fetched.size === 0) {
        fetching = false;
        break;
      }

      // Filter only bot messages
      const batch = fetched.filter(
        (m) => m.author.id === interaction.client.user.id,
      );
      allBotMessages.push(...batch.values());

      lastId = fetched.last().id;

      // If we fetched fewer than 100 total messages, we've reached the end of history
      if (fetched.size < 100) fetching = false;
    }

    if (allBotMessages.length === 0) {
      return interaction.editReply({
        content: "ℹ️ No bot messages found to delete.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 2. Optional Backup
    let logContent = `FULL CLEARED DM LOG\nExported: ${new Date().toLocaleString("de-DE")}\n----------------------------------\n\n`;
    if (shouldSave) {
      // Reverse to chronological order for the log
      [...allBotMessages].reverse().forEach((msg) => {
        logContent += `[${msg.createdAt.toLocaleString("de-DE")}] BOT:\n${msg.cleanContent || "[Media]"}\n`;
        msg.attachments.forEach(
          (att) => (logContent += ` > Link: ${att.url}\n`),
        );
        logContent += `\n`;
      });
    }

    // 3. Delete messages one-by-one
    let deletedCount = 0;
    for (const msg of allBotMessages) {
      try {
        await msg.delete();
        deletedCount++;
        // Keep the 500ms delay to prevent Discord's "Spam Trigger"
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        continue;
      }
    }

    // 4. Final Response
    if (shouldSave) {
      const buffer = Buffer.from(logContent, "utf-8");
      const attachment = new AttachmentBuilder(buffer, {
        name: "dm-full-backup.txt",
      });
      await interaction.editReply({
        content: `✅ Full wipe complete. Deleted **${deletedCount}** messages.`,
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        content: `✅ Successfully wiped **${deletedCount}** bot messages from our DMs.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("Error in full cleardm:", error);
    await interaction.editReply({
      content: "⚠️ An error occurred during the deep clean.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
