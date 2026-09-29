import { SlashCommandBuilder, MessageFlags, PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
import { createTemporaryVoiceChannels, clearTemporaryVoiceChannels } from "../../services/temporaryVoiceChannels.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission, TEMP_VOICE_HARD_MAX_AMOUNT, TEMP_VOICE_GROUP_SIZE_MAX } from "../../constants.js";
import logger, { errorMessage } from "../../utils/logger.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.VoiceChannel)
  .setDescription("Temporäre Gruppen-Sprachkanäle für ein Event.")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Erstellt eine Gruppe temporärer Sprachkanäle")
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Wie viele Sprachkanäle erstellt werden sollen")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(TEMP_VOICE_HARD_MAX_AMOUNT),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("group_size")
          .setDescription("Maximale Nutzerzahl pro Kanal")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(TEMP_VOICE_GROUP_SIZE_MAX),
      ),
  )
  .addSubcommand((sub) => sub.setName("clear").setDescription("Löscht alle aktuell verwalteten temporären Sprachkanäle"));

async function executeCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const amount = interaction.options.getInteger("amount", true);
  const groupSize = interaction.options.getInteger("group_size", true);

  const result = await createTemporaryVoiceChannels({
    guild: interaction.guild!,
    invokingChannelParentId: interaction.channel && "parentId" in interaction.channel ? interaction.channel.parentId : null,
    amount,
    groupSize,
    actorId: interaction.user.id,
  });

  if (!result.ok) {
    await interaction.editReply({ embeds: [createErrorEmbed(result.message)] });
    return;
  }

  const categoryLabel = result.categoryId
    ? `<#${result.categoryId}>${result.categoryFellBackToRoot ? " (konfigurierte Kategorie nicht gefunden, auf Kategorie des aktuellen Kanals ausgewichen)" : ""}`
    : result.categoryFellBackToRoot
      ? "Server-Root (konfigurierte Kategorie nicht gefunden)"
      : "Server-Root";
  const eventLabel = result.eventTitle ? `an Event **${result.eventTitle}** gebunden` : "kein Event gebunden — manuelles `/voice-channel clear` nötig";

  await interaction.editReply({
    embeds: [
      createSuccessEmbed(
        `**${result.created}** Sprachkanal/-kanäle erstellt (max. ${result.groupSize} Nutzer je Kanal) in ${categoryLabel}. ${eventLabel}.`,
      ),
    ],
  });
}

async function executeClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await clearTemporaryVoiceChannels(interaction.client);
  if (result.deleted + result.alreadyGone + result.failed === 0) {
    await interaction.editReply({ embeds: [createSuccessEmbed("Es gab keine temporären Sprachkanäle zu löschen.")] });
    return;
  }
  const parts = [`**${result.deleted}** gelöscht`];
  if (result.alreadyGone > 0) parts.push(`${result.alreadyGone} bereits nicht mehr vorhanden`);
  if (result.failed > 0) parts.push(`${result.failed} konnten nicht gelöscht werden (werden erneut versucht)`);
  await interaction.editReply({ embeds: [createSuccessEmbed(parts.join(", ") + ".")] });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [createErrorEmbed("Dieser Befehl kann nur auf einem Server verwendet werden.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    await interaction.reply({
      embeds: [createErrorEmbed('Ich benötige die Berechtigung "Kanäle verwalten", um das zu tun.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "create") {
      await executeCreate(interaction);
    } else {
      await executeClear(interaction);
    }
  } catch (err) {
    logger.error(`/voice-channel fehlgeschlagen: ${errorMessage(err)}`);
    await interaction.editReply({ embeds: [createErrorEmbed(`Ein Fehler ist aufgetreten: ${errorMessage(err)}`)] });
  }
}
