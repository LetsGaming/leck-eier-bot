import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { listPanels } from "../../db/reactionRolesRepository.js";
import { syncAllPanels } from "../../services/reactionRoles.js";
import { createEmbed, createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, EmbedColor, ReactionRoleMode } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ReactionRoles)
  .setDescription("Manage reaction-role panels. Full editing lives on the dashboard.")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all reaction-role panels and their mappings"),
  )
  .addSubcommand((sub) =>
    sub.setName("sync").setDescription("Re-post/edit every panel message and reconcile its reactions"),
  );

function modeLabel(mode: ReactionRoleMode): string {
  switch (mode) {
    case ReactionRoleMode.Toggle:
      return "Toggle";
    case ReactionRoleMode.Unique:
      return "Unique (one at a time)";
    case ReactionRoleMode.Verify:
      return "Verify (add-only)";
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "sync") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await syncAllPanels(interaction.client);
    return interaction.editReply({
      embeds: [createSuccessEmbed("All reaction-role panels have been synced.")],
    });
  }

  // list
  const panels = listPanels();
  if (panels.length === 0) {
    return interaction.reply({
      embeds: [createErrorEmbed("No reaction-role panels configured yet. Create one on the dashboard.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  const fields = panels.map((panel) => {
    const jump =
      guildId && panel.messageId
        ? `[Jump to message](https://discord.com/channels/${guildId}/${panel.channelId}/${panel.messageId})`
        : "_Not posted yet — use `/reactionroles sync` or save it on the dashboard._";
    const mappingLines = panel.mappings.length
      ? panel.mappings
          .map((m) => `${m.emojiId ? `<:${m.emojiName}:${m.emojiId}>` : m.emojiName} → <@&${m.roleId}>`)
          .join("\n")
      : "_No roles configured_";
    return {
      name: `#${panel.id} — ${panel.title ?? "Untitled panel"} (${modeLabel(panel.mode)}${panel.removeReaction ? ", clears reactions" : ""})`,
      value: `<#${panel.channelId}> — ${jump}\n${mappingLines}`,
    };
  });

  return interaction.reply({
    embeds: [
      createEmbed({
        title: "Reaction Role Panels",
        color: EmbedColor.Info,
        fields,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
