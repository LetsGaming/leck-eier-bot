import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { buildBirthdayMessage } from "../../services/birthdays.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.TestBirthdayMessage)
  .setDescription("Teste, wie die Geburtstagsnachricht aussehen wird.");

export async function execute(interaction: ChatInputCommandInteraction) {
  const user = interaction.user;
  const birthdayEntry = {
    userId: user.id,
    name: user.username,
    mention: `<@${user.id}>`,
  };
  const message = buildBirthdayMessage(birthdayEntry, true);

  interaction.reply({
    content: `🎂 So wird die Geburtstagsnachricht aussehen:\n\n${message}`,
    flags: MessageFlags.Ephemeral,
  });
}
