import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { transliterate } from "transliteration";
import { isAdmin } from "../../utils/utils.js";
import { getCachedMembers, isCacheReady } from "../../services/memberCache.js";
import {
  createNoAdminEmbed,
  createSuccessEmbed,
  createErrorEmbed,
} from "../../utils/embedUtils.js";

/**
 * Normalizes complex strings.
 * Handles Mathematical Bold (𝐁𝐈𝐍𝐄), Emojis (🍂), and standardizes the string.
 */
function normalizeForSearch(str) {
  if (!str) return "";

  const fancyToNormal = (text) => {
    return text.replace(/[\u1d400-\u1d7ff]/g, (char) => {
      const cp = char.codePointAt(0);
      if (cp >= 0x1d400 && cp <= 0x1d419) return String.fromCharCode(cp - 0x1d400 + 65);
      if (cp >= 0x1d41a && cp <= 0x1d433) return String.fromCharCode(cp - 0x1d41a + 97);
      return char;
    });
  };

  let normalized = fancyToNormal(str);
  normalized = transliterate(normalized);

  return normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const data = new SlashCommandBuilder()
  .setName("finduser")
  .setDescription("Find a user by their servername (cached).")
  .addStringOption((opt) =>
    opt
      .setName("servername")
      .setDescription("Name to search for")
      .setRequired(true),
  );

export async function execute(interaction) {
  // Author: { name: "LetsGamingDE", id: 272402865874534400n }

  if (!isAdmin(interaction)) {
    return interaction.reply({
      embeds: [createNoAdminEmbed()],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!isCacheReady()) {
    return interaction.reply({
      content: "The member cache is still building. Please wait a moment.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // CRITICAL FIX: Added await here
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawSearch = interaction.options.getString("servername", true);
  const normalizedSearch = normalizeForSearch(rawSearch);
  const members = getCachedMembers();

  const matchedMembers = members.filter((member) => {
    const names = [
      member.user.username,
      member.user.globalName,
      member.nickname,
      member.displayName,
    ].filter(Boolean);

    return names.some((n) => normalizeForSearch(n).includes(normalizedSearch));
  });

  if (matchedMembers.size === 0) {
    return interaction.editReply({
      embeds: [createErrorEmbed(`No users found matching "${rawSearch}".`, true)],
    });
  }

  const results = [...matchedMembers.values()].slice(0, 15);
  const memberList = results
    .map((m) => `• **${m.displayName}** \`${m.user.tag}\` <@${m.id}>`)
    .join("\n\n");

  const successEmbed = createSuccessEmbed(
    `**Search Results for:** "${rawSearch}"\n\n${memberList}`,
  );

  return interaction.editReply({
    embeds: [successEmbed],
  });
}