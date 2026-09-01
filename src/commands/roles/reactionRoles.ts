import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { listPanels } from "../../db/reactionRolesRepository.js";
import { syncAllPanels } from "../../services/reactionRoles.js";
import { createEmbed, createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, EmbedColor, SelectionType } from "../../constants.js";
import type { ReactionRolePanelWithMappings } from "../../types.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.ReactionRoles)
  .setDescription("Verwaltet Reaktionsrollen-Panels. Vollständige Bearbeitung erfolgt über das Dashboard.")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("Listet alle Reaktionsrollen-Panels und ihre Zuordnungen auf"),
  )
  .addSubcommand((sub) =>
    sub.setName("sync").setDescription("Postet/bearbeitet jede gesendete Panel-Nachricht neu und gleicht die Reaktionen ab"),
  );

function selectionTypeLabel(type: SelectionType): string {
  switch (type) {
    case SelectionType.Reactions:
      return "Reaktionen";
    case SelectionType.Buttons:
      return "Buttons";
    case SelectionType.Dropdown:
      return "Dropdown";
  }
}

function panelBadges(panel: ReactionRolePanelWithMappings): string {
  const badges = [selectionTypeLabel(panel.selectionType)];
  if (panel.allowMultiple) badges.push("mehrere Rollen");
  if (!panel.removable) badges.push("nicht entfernbar");
  if (panel.selectionType === SelectionType.Reactions && panel.removeReaction) badges.push("entfernt Reaktionen");
  if (!panel.sent) badges.push("ENTWURF — nicht gesendet");
  return badges.join(", ");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "sync") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await syncAllPanels(interaction.client);
    return interaction.editReply({
      embeds: [createSuccessEmbed("Alle gesendeten Reaktionsrollen-Panels wurden synchronisiert. Entwürfe bleiben unverändert — sende sie zuerst über das Dashboard.")],
    });
  }

  // list
  const panels = listPanels();
  if (panels.length === 0) {
    return interaction.reply({
      embeds: [createErrorEmbed("Es sind noch keine Reaktionsrollen-Panels konfiguriert. Erstelle eines über das Dashboard.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  const fields = panels.map((panel) => {
    const jump =
      guildId && panel.messageId
        ? `[Zur Nachricht springen](https://discord.com/channels/${guildId}/${panel.channelId}/${panel.messageId})`
        : "_Noch nicht gesendet — über das Dashboard fertigstellen._";
    const mappingLines = panel.mappings.length
      ? panel.mappings
          .map((m) => {
            const emoji = m.emojiId ? `<:${m.emojiName}:${m.emojiId}>` : (m.emojiName ?? "");
            return `${emoji ? `${emoji} ` : ""}${m.label ?? ""} → ${m.roleIds.map((id) => `<@&${id}>`).join(", ")}`.trim();
          })
          .join("\n")
      : "_Keine Rollen konfiguriert_";
    return {
      name: `#${panel.id} — ${panel.name} (${panelBadges(panel)})`,
      value: `<#${panel.channelId}> — ${jump}\n${mappingLines}`,
    };
  });

  return interaction.reply({
    embeds: [
      createEmbed({
        title: "Reaktionsrollen-Panels",
        color: EmbedColor.Info,
        fields,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
