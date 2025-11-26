// src/commands/checkBirthday.js
import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { getTodaysBirthdaysFromFileAsArray, getCurrentTemplate, sendBirthdayMessages } from "../services/birthdays.js";
import { isAdmin } from "../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("checkbirthday")
  .setDescription("Manually checks today's birthdays and mentions them.")

export async function execute(interaction) {
  // admin check double safety
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Only administrators can use this command.", flags: MessageFlags.Ephemeral });
  }

  const birthdays = getTodaysBirthdaysFromFileAsArray();

  if (!birthdays || birthdays.length === 0) {
    return interaction.reply({ content: "🎂 No birthdays today!", flags: MessageFlags.Ephemeral });
  }

  // fetch template and determine if template contains {everyoneMention}
  const template = getCurrentTemplate();
  const pingEveryone = template.includes("{everyoneMention}") && template.includes("@everyone");

  // reply first so command response is acknowledged
  await interaction.reply({ content: `🎉 Found ${birthdays.length} birthday(s) today. Sending congratulations...`, flags: MessageFlags.Ephemeral });

  // send messages according to template; template controls whether @everyone gets used
  // we treat presence of literal "@everyone" in template as opt-in (user may include it manually)
  const templateUsesEveryone = template.includes("{everyoneMention}");
  const shouldPingEveryone = templateUsesEveryone; // command does not override; template controls

  await sendBirthdayMessages(interaction.client, interaction.channelId, birthdays, shouldPingEveryone);
}
