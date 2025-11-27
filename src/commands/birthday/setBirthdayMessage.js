// src/commands/setBirthdayMessage.js
import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { setCurrentTemplate } from "../../services/birthdays.js";
import { isAdmin } from "../../utils/utils.js";
import { createErrorEmbed, createNoAdminEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("setbirthdaymessage")
  .setDescription("Set the template used for birthday messages.")
  .addStringOption((opt) =>
    opt
      .setName("template")
      .setDescription(
        "New template. Placeholders: {userMention}, {everyoneMention}, {userNick}, \\n for new line."
      )
      .setRequired(true)
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral,
    });
  }

  const newTemplate = interaction.options.getString("template", true);

  // Quick validation: must include {userMention} and {userNick}
  if (
    !newTemplate.includes("{userMention}") ||
    !newTemplate.includes("{userNick}")
  ) {
    const errorEmbd = createErrorEmbed(
      "Template must include at least {userMention} or {userNick}. Optionally include {everyoneMention}."
    );
    return interaction.reply({
      embeds: [errorEmbd],
      flags: MessageFlags.Ephemeral,
    });
  }

  setCurrentTemplate(newTemplate);

  const successEmbd = createSuccessEmbed("Birthday template updated successfully.");
  return interaction.reply({
    embeds: [successEmbd],
    flags: MessageFlags.Ephemeral,
  });
}
