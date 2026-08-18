import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import {
  getTodaysBirthdays,
  getNextBirthday,
  getCurrentTemplate,
  sendBirthdayMessages,
} from "../../services/birthdays.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, EmbedColor } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.CheckBirthday)
  .setDescription(
    "Manually checks today's birthdays and optionally sends messages.",
  )
  .addBooleanOption((opt) =>
    opt
      .setName("sendmessage")
      .setDescription("If true, the bot will send the birthday messages.")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const birthdays = getTodaysBirthdays();
  const sendMessage = interaction.options.getBoolean("sendmessage") ?? false;

  if (birthdays.length === 0) {
    const nextBirthday = getNextBirthday();
    let replyContent = "🎂 No birthdays today!";

    if (nextBirthday) {
      replyContent += `\nThe next birthday is on **${nextBirthday.date.toLocaleDateString()}**: ${nextBirthday.entries
        .map((e) => e.name ?? "Unknown")
        .join(", ")}`;
    }

    return interaction.editReply({
      content: replyContent,
    });
  }

  // Template logic
  const template = getCurrentTemplate();
  const templateUsesEveryone = template.includes("{everyoneMention}");
  const shouldPingEveryone = templateUsesEveryone;

  // Ephemeral preview
  const previewList = birthdays
    .map((b) => `• ${b.mention} (${b.name ?? "Unknown"})`)
    .join("\n");

  const embd = createEmbed({
    title: "🎂 Birthdays Today",
    description: `Found ${birthdays.length} birthday(s) today.`,
    color: EmbedColor.Success,
    fields: [
      {
        name: "Birthdays",
        value: previewList,
      },
      {
        name: "Send Message(s)",
        value: sendMessage ? "Yes" : "No",
        inline: true,
      },
    ],
  });
  await interaction.editReply({
    embeds: [embd],
  });

  // Only send messages if sendmessage=true
  if (sendMessage) {
    await sendBirthdayMessages(
      interaction.client,
      interaction.channelId,
      birthdays,
      shouldPingEveryone,
    );
  }
}
