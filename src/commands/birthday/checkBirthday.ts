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
    "Überprüft manuell die heutigen Geburtstage und sendet optional Nachrichten.",
  )
  .addBooleanOption((opt) =>
    opt
      .setName("sendmessage")
      .setDescription("Wenn aktiviert, sendet der Bot die Geburtstagsnachrichten.")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const birthdays = getTodaysBirthdays();
  const sendMessage = interaction.options.getBoolean("sendmessage") ?? false;

  if (birthdays.length === 0) {
    const nextBirthday = getNextBirthday();
    let replyContent = "🎂 Heute hat niemand Geburtstag!";

    if (nextBirthday) {
      replyContent += `\nDer nächste Geburtstag ist am **${nextBirthday.date.toLocaleDateString("de-DE")}**: ${nextBirthday.entries
        .map((e) => e.name ?? "Unbekannt")
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
    .map((b) => `• ${b.mention} (${b.name ?? "Unbekannt"})`)
    .join("\n");

  const embd = createEmbed({
    title: "🎂 Heutige Geburtstage",
    description: `${birthdays.length} Geburtstag(e) heute gefunden.`,
    color: EmbedColor.Success,
    fields: [
      {
        name: "Geburtstage",
        value: previewList,
      },
      {
        name: "Nachricht(en) senden",
        value: sendMessage ? "Ja" : "Nein",
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
