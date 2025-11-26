import { SlashCommandBuilder, MessageFlags  } from "discord.js";
import { buildBirthdayMessage } from "../services/birthdays.js";
import { isAdmin } from "../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("testbirthdaymessage")
  .setDescription("Test how the birthday message will look like.")

export async function execute(interaction) {
  // Extra server-side safety check
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "❌ Only administrators can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const user = interaction.user;
  const birthdayEntry = {
    userId: user.id,
    name: user.username,
    mention: `<@${user.id}>`
  };
  const message = buildBirthdayMessage(birthdayEntry, true);
 
  interaction.reply({ content: `🎂 Here is how the birthday message will look like:\n\n${message}`, flags: MessageFlags.Ephemeral });
}
