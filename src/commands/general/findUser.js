import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { transliterate } from "transliteration";
import { isAdmin } from "../../utils/utils.js";
import {
  createNoAdminEmbed,
  createSuccessEmbed,
  createErrorEmbed,
} from "../../utils/embedUtils.js";

/**
 * Fully normalizes usernames so Unicode fonts (like 𝐁𝐈𝐍𝐄),
 * emojis (🍂), accents, and symbols do not break searching.
 */
function normalizeForSearch(str) {
  if (!str) return "";
  // Transliterate handles the mathematical bold "𝐁𝐈𝐍𝐄" -> "BINE"
  return transliterate(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-zA-Z0-9 ]/g, " ") // Replace symbols/emojis with spaces
    .toLowerCase()
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

export const data = new SlashCommandBuilder()
  .setName("finduser")
  .setDescription(
    "Find a user by their servername (supports nicknames and special fonts).",
  )
  .addStringOption((opt) =>
    opt
      .setName("servername")
      .setDescription("The name, nickname, or part of the name to search for.")
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
  const normalizedSearch = normalizeForSearch(rawSearch);

  const guild = interaction.guild;
  if (!guild) {
    return interaction.editReply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    /* STRATEGY CHANGE: 
       Discord's 'query' API often fails on symbols like "—" or "🍂".
       Instead, we fetch ALL members (or a large chunk) and filter them ourselves locally.
    */
    const allMembers = await guild.members.fetch();

    const matchedMembers = allMembers.filter((member) => {
      // Check every name field available
      const namesToCheck = [
        member.user.username,
        member.user.globalName,
        member.nickname,
        member.displayName,
      ];

      return namesToCheck.some((name) => {
        if (!name) return false;
        const normalizedName = normalizeForSearch(name);
        return normalizedName.includes(normalizedSearch);
      });
    });

    if (matchedMembers.size === 0) {
      const errorEmbed = createErrorEmbed(
        `No users found matching "${rawSearch}".\n\n*Note: I searched through ${allMembers.size} members using deep normalization.*`,
      );
      return interaction.editReply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Limit results to 15 to avoid embed character limits
    const results = [...matchedMembers.values()].slice(0, 15);
    const memberList = results
      .map((member) => {
        const hasNickname = member.nickname ? `(Nick: ${member.nickname})` : "";
        return `• **${member.displayName}** \`${member.user.tag}\` ${hasNickname}\n  ID: \`${member.user.id}\` | <@${member.user.id}>`;
      })
      .join("\n\n");

    const successEmbed = createSuccessEmbed(
      `**Search Results for:** "${rawSearch}"\nFound ${matchedMembers.size} match(es):\n\n${memberList}${matchedMembers.size > 15 ? "\n\n*...and more results.*" : ""}`,
    );

    return interaction.editReply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Member Fetch Error:", error);
    return interaction.editReply({
      content:
        "The member list is too large to fetch at once or the bot lacks 'Server Members Intent'.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
