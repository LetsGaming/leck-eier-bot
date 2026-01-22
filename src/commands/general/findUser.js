import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { transliterate } from "transliteration";
import { isAdmin } from "../../utils/utils.js";
import {
  createNoAdminEmbed,
  createSuccessEmbed,
  createErrorEmbed,
} from "../../utils/embedUtils.js";

/**
 * Fully normalizes usernames so Unicode fonts, emojis,
 * accents and symbols do not break searching.
 */
function normalizeForSearch(str) {
  return transliterate(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics
    .replace(/[^a-zA-Z0-9]/g, "") // symbols, emojis, punctuation
    .toLowerCase();
}

export const data = new SlashCommandBuilder()
  .setName("finduser")
  .setDescription("Find a user by their servername.")
  .addStringOption((opt) =>
    opt
      .setName("servername")
      .setDescription("The servername of the user to find.")
      .setRequired(true),
  );

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    const noAdmin = createNoAdminEmbed();
    return interaction.reply({
      embeds: [noAdmin],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawSearch = interaction.options.getString("servername", true);
  const search = normalizeForSearch(rawSearch);

  const guild = interaction.guild;
  if (!guild) {
    return interaction.editReply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const matchedMembers = guild.members.cache.filter((member) => {
    const username = normalizeForSearch(member.user.username);
    const nickname = member.nickname ? normalizeForSearch(member.nickname) : "";

    return username.includes(search) || nickname.includes(search);
  });

  if (matchedMembers.size === 0) {
    const errorEmbed = createErrorEmbed(
      `No users found with servername matching "${rawSearch}".`,
    );
    return interaction.editReply({
      embeds: [errorEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const memberList = matchedMembers
    .map((member) => `• ${member.user.tag} (Mention: <@${member.user.id}>)`)
    .join("\n");

  const successEmbed = createSuccessEmbed(
    `Found ${matchedMembers.size} user(s) matching "${rawSearch}":\n\n${memberList}`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
    flags: MessageFlags.Ephemeral,
  });
}
