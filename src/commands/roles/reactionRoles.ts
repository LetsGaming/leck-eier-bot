import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { listPanels } from "../../db/reactionRolesRepository.js";
import { syncAllPanels } from "../../services/reactionRoles.js";
import { createEmbed, createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, EmbedColor, SelectionType } from "../../constants.js";
import type { ReactionRolePanelWithMappings } from "../../types.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ReactionRoles)
  .setDescription("Manage reaction-role panels. Full editing lives on the dashboard.")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all reaction-role panels and their mappings"),
  )
  .addSubcommand((sub) =>
    sub.setName("sync").setDescription("Re-post/edit every sent panel message and reconcile its reactions"),
  );

function selectionTypeLabel(type: SelectionType): string {
  switch (type) {
    case SelectionType.Reactions:
      return "Reactions";
    case SelectionType.Buttons:
      return "Buttons";
    case SelectionType.Dropdown:
      return "Dropdown";
  }
}

function panelBadges(panel: ReactionRolePanelWithMappings): string {
  const badges = [selectionTypeLabel(panel.selectionType)];
  if (panel.allowMultiple) badges.push("multiple roles");
  if (!panel.removable) badges.push("not removable");
  if (panel.selectionType === SelectionType.Reactions && panel.removeReaction) badges.push("clears reactions");
  if (!panel.sent) badges.push("DRAFT — not sent");
  return badges.join(", ");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "sync") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await syncAllPanels(interaction.client);
    return interaction.editReply({
      embeds: [createSuccessEmbed("All sent reaction-role panels have been synced. Drafts are untouched — send them from the dashboard first.")],
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
        : "_Not sent yet — finish it on the dashboard._";
    const mappingLines = panel.mappings.length
      ? panel.mappings
          .map((m) => {
            const emoji = m.emojiId ? `<:${m.emojiName}:${m.emojiId}>` : (m.emojiName ?? "");
            return `${emoji ? `${emoji} ` : ""}${m.label ?? ""} → <@&${m.roleId}>`.trim();
          })
          .join("\n")
      : "_No roles configured_";
    return {
      name: `#${panel.id} — ${panel.name} (${panelBadges(panel)})`,
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
