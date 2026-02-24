import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { isOwner } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("cleardm")
  .setDescription("Deletes bot messages in your DMs.")
  .addBooleanOption((opt) =>
    opt
      .setName("save_history")
      .setDescription(
        "If true, sends a .txt file of messages before deleting them.",
      )
      .setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("The number of messages to delete (leave empty for all).")
      .setRequired(false)
      .setMinValue(1),
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
  const amount = interaction.options.getInteger("amount"); // null if not set
  const dmChannel = await interaction.user.createDM();

  try {
    let allBotMessages = [];
    let lastId = null;
    let fetching = true;

    // 1. Fetching Logic
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

      // Stop if we hit the end of history or if we already have enough messages (if amount set)
      if (fetched.size < 100 || (amount && allBotMessages.length >= amount)) {
        fetching = false;
      }
    }

    // 2. Apply limit if specified
    if (amount && allBotMessages.length > amount) {
      allBotMessages = allBotMessages.slice(0, amount);
    }

    if (allBotMessages.length === 0) {
      return interaction.editReply({
        content: "ℹ️ No bot messages found to delete.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 3. Optional Backup
    let logContent = `DM CLEAR LOG\n`;
    logContent += `Exported: ${new Date().toLocaleString("de-DE")}\n`;
    logContent += `By: ${interaction.user.username} (${interaction.user.id})\n`;
    logContent += `----------------------------------\n\n`;

    if (shouldSave) {
      [...allBotMessages].reverse().forEach((msg) => {
        logContent += `[${msg.createdAt.toLocaleString("de-DE")}] BOT:\n${msg.cleanContent || "[Media/Embed]"}\n`;
        msg.attachments.forEach(
          (att) => (logContent += ` > Link: ${att.url}\n`),
        );
        logContent += `\n`;
      });
    }

    // 4. Deletion Logic
    let deletedCount = 0;
    for (const msg of allBotMessages) {
      try {
        await msg.delete();
        deletedCount++;
        // 500ms delay to prevent rate limits
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        continue;
      }
    }

    // 5. Response
    const finalMsg = `✅ Successfully wiped **${deletedCount}** bot messages.`;

    if (shouldSave) {
      const buffer = Buffer.from(logContent, "utf-8");
      const attachment = new AttachmentBuilder(buffer, {
        name: "dm-clear-backup.txt",
      });
      await interaction.editReply({
        content: finalMsg,
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        content: finalMsg,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("Error in cleardm:", error);
    await interaction.editReply({
      content: "⚠️ An error occurred during the clearing process.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
