import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import logger, { errorMessage } from "../../utils/logger.js";
import { CommandName, CommandPermission, DISCORD_FETCH_PAGE_SIZE, DM_DELETE_DELAY_MS } from "../../constants.js";

export const permission = CommandPermission.Owner;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ClearDm)
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

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const shouldSave = interaction.options.getBoolean("save_history") ?? false;
  const amount = interaction.options.getInteger("amount"); // null if not set
  const dmChannel = await interaction.user.createDM();

  try {
    let allBotMessages: Message[] = [];
    let lastId: string | undefined = undefined;
    let fetching = true;

    // 1. Fetching Logic
    while (fetching) {
      const options: { limit: number; before?: string } = { limit: DISCORD_FETCH_PAGE_SIZE };
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
      lastId = fetched.last()!.id;

      // Stop if we hit the end of history or if we already have enough messages (if amount set)
      if (fetched.size < DISCORD_FETCH_PAGE_SIZE || (amount && allBotMessages.length >= amount)) {
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
        // Delay to prevent rate limits
        await new Promise((r) => setTimeout(r, DM_DELETE_DELAY_MS));
      } catch {
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
      });
    } else {
      await interaction.editReply({
        content: finalMsg,
      });
    }
  } catch (error) {
    logger.error(`Error in cleardm: ${errorMessage(error)}`);
    await interaction.editReply({
      content: "⚠️ An error occurred during the clearing process.",
    });
  }
}
