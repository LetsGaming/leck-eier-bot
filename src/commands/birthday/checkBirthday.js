// src/commands/checkBirthday.js
import { SlashCommandBuilder, MessageFlags } from "discord.js";
import {
  getTodaysBirthdaysFromFileAsArray,
  getNextBirthdayFromFile,
  getCurrentTemplate,
  sendBirthdayMessages,
} from "../../services/birthdays.js";
import { isAdmin } from "../../utils/utils.js";
import { createEmbed, createNoAdminEmbed } from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("checkbirthday")
  .setDescription(
    "Manually checks today's birthdays and optionally sends messages.",
  )
  .addBooleanOption((opt) =>
    opt
      .setName("sendmessage")
      .setDescription("If true, the bot will send the birthday messages.")
      .setRequired(false),
  );

export async function execute(interaction) {
  // admin check
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const birthdays = getTodaysBirthdaysFromFileAsArray();
  const sendMessage = interaction.options.getBoolean("sendmessage") ?? false;

  if (!birthdays || birthdays.length === 0) {
    const nextBirthday = getNextBirthdayFromFile();
    let replyContent = "🎂 No birthdays today!";

    if (nextBirthday) {
      replyContent += `\nThe next birthday is on **${nextBirthday.date.toLocaleDateString()}**: ${nextBirthday.entries
        .map((e) => e.name ?? "Unknown")
        .join(", ")}`;
    }

    return interaction.reply({
      content: replyContent,
      flags: MessageFlags.Ephemeral,
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
    color: 0x55ff55,
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
    flags: MessageFlags.Ephemeral,
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
