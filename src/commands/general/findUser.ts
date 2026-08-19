import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { isCacheReady } from "../../services/memberCache.js";
import { searchCachedMembers } from "../../services/memberSearch.js";
import { createSuccessEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

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
  const results = searchCachedMembers(rawSearch);

  if (results.length === 0) {
    return interaction.editReply({
      embeds: [createErrorEmbed(`No users found matching "${rawSearch}".`)],
    });
  }

  const memberList = results
    .map((m) => `• **${m.displayName}** \`${m.user.tag}\` <@${m.id}>`)
    .join("\n\n");

  const successEmbed = createSuccessEmbed(
    `**Search Results for:** "${rawSearch}"\n\n${memberList}`,
  );

  return interaction.editReply({ embeds: [successEmbed] });
}
