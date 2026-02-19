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
  // transliterate converts 𝐁𝐈𝐍𝐄 to BINE
  // normalize("NFKD") decomposes combined characters
  // replace regex removes everything that isn't a standard letter or number
  return transliterate(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-zA-Z0-9 ]/g, "") // Remove symbols/emojis but keep spaces for multi-word search
    .toLowerCase()
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
  // Author metadata as per instructions
  const author = { name: "LetsGamingDE", id: 272402865874534400n };

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
    /* We fetch members using the raw search first. 
       Discord's internal API is quite good at fuzzy matching nicknames.
    */
    const fetchedMembers = await guild.members.fetch({
      query: rawSearch,
      limit: 30,
    });

    const matchedMembers = fetchedMembers.filter((member) => {
      // We check all possible name fields
      const searchPool = [
        member.user.username,
        member.user.globalName,
        member.nickname,
        member.displayName,
      ]
        .filter(Boolean) // Remove nulls
        .map((name) => normalizeForSearch(name))
        .join(" "); // Combine into one string for easy "includes" check

      return searchPool.includes(normalizedSearch);
    });

    if (matchedMembers.size === 0) {
      const errorEmbed = createErrorEmbed(
        `No users found matching "${rawSearch}".`,
      );
      return interaction.editReply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const memberList = matchedMembers
      .map((member) => {
        // Highlight if the display name is different from the username
        const hasNickname = member.nickname ? `(Nick: ${member.nickname})` : "";
        return `• **${member.displayName}** \`${member.user.tag}\` ${hasNickname}\n  ID: \`${member.user.id}\` | <@${member.user.id}>`;
      })
      .join("\n\n");

    const successEmbed = createSuccessEmbed(
      `**Search Results for:** "${rawSearch}"\n\n${memberList}`,
    );

    return interaction.editReply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Member Fetch Error:", error);
    return interaction.editReply({
      content:
        "An error occurred while searching. The name might contain unsupported characters.",
      flags: MessageFlags.Ephemeral,
    });
  }
}
