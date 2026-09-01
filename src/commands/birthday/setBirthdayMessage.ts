import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { setCurrentTemplate } from "../../services/birthdays.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.SetBirthdayMessage)
  .setDescription("Legt die Vorlage für Geburtstagsnachrichten fest.")
  .addStringOption((opt) =>
    opt
      .setName("template")
      .setDescription(
        "Neue Vorlage. Platzhalter: {userMention}, {everyoneMention}, {userNick}, \\n für einen Zeilenumbruch.",
      )
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const newTemplate = interaction.options.getString("template", true);

  // Quick validation: must include {userMention} and {userNick}
  if (
    !newTemplate.includes("{userMention}") ||
    !newTemplate.includes("{userNick}")
  ) {
    const errorEmbd = createErrorEmbed(
      "Die Vorlage muss mindestens {userMention} oder {userNick} enthalten. Optional kann {everyoneMention} verwendet werden.",
    );
    return interaction.reply({
      embeds: [errorEmbd],
      flags: MessageFlags.Ephemeral,
    });
  }

  setCurrentTemplate(newTemplate);

  const successEmbd = createSuccessEmbed("Geburtstagsvorlage erfolgreich aktualisiert.");
  return interaction.reply({
    embeds: [successEmbd],
    flags: MessageFlags.Ephemeral,
  });
}
