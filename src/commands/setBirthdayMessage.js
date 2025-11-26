// src/commands/setBirthdayMessage.js
import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { setCurrentTemplate } from "../services/birthdays.js";
import { isAdmin } from "../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("setbirthdaymessage")
  .setDescription("Set the template used for birthday messages.")
  .addStringOption(opt => opt
    .setName("template")
    .setDescription("New template. Placeholders: {userMention}, {everyoneMention}, {userNick}")
    .setRequired(true)
  )

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Only administrators can use this command.", flags: MessageFlags.Ephemeral });
  }

  const newTemplate = interaction.options.getString("template", true);

  // Quick validation: must include {userMention} and {userNick}
  if (!newTemplate.includes("{userMention}") || !newTemplate.includes("{userNick}")) {
    return interaction.reply({
      content: "❌ Template must include at least {userMention} and {userNick}. Optionally include {everyoneMention}.",
      flags: MessageFlags.Ephemeral
    });
  }

  setCurrentTemplate(newTemplate);

  return interaction.reply({ content: "✅ Birthday template updated.", flags: MessageFlags.Ephemeral });
}
