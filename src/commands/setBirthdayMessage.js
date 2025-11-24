// src/commands/setBirthdayMessage.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { setCurrentTemplate } from "../services/birthdays.js";

export const data = new SlashCommandBuilder()
  .setName("setbirthdaymessage")
  .setDescription("Set the template used for birthday messages.")
  .addStringOption(opt => opt
    .setName("template")
    .setDescription("New template. Placeholders: {userMention}, {everyoneMention}, {userNick}")
    .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Only administrators can use this command.", ephemeral: true });
  }

  const newTemplate = interaction.options.getString("template", true);

  // Quick validation: must include {userMention} and {userNick}
  if (!newTemplate.includes("{userMention}") || !newTemplate.includes("{userNick}")) {
    return interaction.reply({
      content: "❌ Template must include at least {userMention} and {userNick}. Optionally include {everyoneMention}.",
      ephemeral: true
    });
  }

  setCurrentTemplate(newTemplate);

  return interaction.reply({ content: "✅ Birthday template updated.", ephemeral: true });
}
