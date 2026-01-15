import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { isAdmin } from "../../utils/utils.js";
import {
  createNoAdminEmbed,
  createSuccessEmbed,
  createErrorEmbed,
} from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("finduser")
  .setDescription("Find a user by their servername.")
  .addStringOption((opt) =>
    opt
      .setName("servername")
      .setDescription("The servername of the user to find.")
      .setRequired(true)
  );

export async function execute(interaction) {
  // Extra server-side safety check
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral,
    });
  }

  const servername = interaction.options
    .getString("servername", true)
    .toLowerCase();
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const members = await guild.members.fetch();
  const matchedMembers = members.filter(
    (member) =>
      member.user.username.toLowerCase().includes(servername) ||
      (member.nickname && member.nickname.toLowerCase().includes(servername))
  );
  if (matchedMembers.size === 0) {
    const errorEmbed = createErrorEmbed(
      `No users found with servername matching "${servername}".`
    );
    return interaction.reply({
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const memberList = matchedMembers
    .map((member) => `• ${member.user.tag} (ID: ${member.user.id})`)
    .join("\n");
  const successEmbed = createSuccessEmbed(
    `Found ${matchedMembers.size} user(s) matching "${servername}":\n\n${memberList}`
  );
  return interaction.reply({
    embeds: [successEmbed],
    flags: MessageFlags.Ephemeral,
  });
}
