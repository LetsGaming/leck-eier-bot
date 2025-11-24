// src/commands/checkBirthday.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { getTodaysBirthdaysFromFileAsArray, getCurrentTemplate, sendBirthdayMessagesUsingTemplate } from "../services/birthdays.js";

export const data = new SlashCommandBuilder()
  .setName("checkbirthday")
  .setDescription("Manually checks today's birthdays and mentions them.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // admin check double safety
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Only administrators can use this command.", ephemeral: true });
  }

  const birthdays = getTodaysBirthdaysFromFileAsArray();

  if (!birthdays || birthdays.length === 0) {
    return interaction.reply({ content: "🎂 No birthdays today!", ephemeral: true });
  }

  // fetch template and determine if template contains {everyoneMention}
  const template = getCurrentTemplate();
  const pingEveryone = template.includes("{everyoneMention}") && template.includes("@everyone");

  // reply first so command response is acknowledged
  await interaction.reply({ content: `🎉 Found ${birthdays.length} birthday(s) today. Sending congratulations...`, ephemeral: true });

  // send messages according to template; template controls whether @everyone gets used
  // we treat presence of literal "@everyone" in template as opt-in (user may include it manually)
  const templateUsesEveryone = template.includes("{everyoneMention}");
  const shouldPingEveryone = templateUsesEveryone; // command does not override; template controls

  await sendBirthdayMessagesUsingTemplate(interaction.client, interaction.channelId, template, birthdays, shouldPingEveryone);
}
