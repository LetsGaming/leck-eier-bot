import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { transliterate } from "transliteration";
import { getCachedMembers, isCacheReady } from "../../services/memberCache.js";
import { createSuccessEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, FIND_USER_RESULT_LIMIT } from "../../constants.js";

export const permission = CommandPermission.Admin;

/** Unicode ranges for the "Mathematical Alphanumeric Symbols" block, mapped back to plain ASCII. */
const MATH_ALPHANUMERIC_RANGES: Array<{ start: number; end: number; base: number }> = [
  { start: 0x1d400, end: 0x1d419, base: 65 }, // Bold A-Z
  { start: 0x1d41a, end: 0x1d433, base: 97 }, // Bold a-z
  { start: 0x1d434, end: 0x1d44d, base: 65 }, // Italic A-Z
  { start: 0x1d44e, end: 0x1d467, base: 97 }, // Italic a-z
  { start: 0x1d468, end: 0x1d481, base: 65 }, // Bold Italic A-Z
  { start: 0x1d482, end: 0x1d49b, base: 97 }, // Bold Italic a-z
  { start: 0x1d5a0, end: 0x1d5b9, base: 65 }, // Sans-Serif A-Z
  { start: 0x1d5ba, end: 0x1d5d3, base: 97 }, // Sans-Serif a-z
];

function unfancy(text: string): string {
  return text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => {
    const cp = char.codePointAt(0)!;
    const range = MATH_ALPHANUMERIC_RANGES.find((r) => cp >= r.start && cp <= r.end);
    return range ? String.fromCharCode(cp - range.start + range.base) : char;
  });
}

function normalizeForSearch(str: string | null | undefined): string {
  if (!str) return "";

  return transliterate(unfancy(str))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const data = new SlashCommandBuilder()
  .setName(CommandName.FindUser)
  .setDescription("Find a user by their servername (cached).")
  .addStringOption((opt) =>
    opt
      .setName("servername")
      .setDescription("Name to search for")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  // Author: { name: "LetsGamingDE", id: 272402865874534400n }

  if (!isCacheReady()) {
    return interaction.reply({
      content: "The member cache is still building...",
      flags: MessageFlags.Ephemeral,
    });
  }

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
      embeds: [createErrorEmbed(`No users found matching "${rawSearch}".`)],
    });
  }

  const results = [...matchedMembers.values()].slice(0, FIND_USER_RESULT_LIMIT);
  const memberList = results
    .map((m) => `• **${m.displayName}** \`${m.user.tag}\` <@${m.id}>`)
    .join("\n\n");

  const successEmbed = createSuccessEmbed(
    `**Search Results for:** "${rawSearch}"\n\n${memberList}`,
  );

  return interaction.editReply({ embeds: [successEmbed] });
}
