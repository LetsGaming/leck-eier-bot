import { SlashCommandBuilder, MessageFlags, PermissionsBitField, type ChatInputCommandInteraction } from "discord.js";
import {
  createTemporaryVoiceChannels,
  clearTemporaryVoiceChannels,
  moveMembersBackToMainChannel,
  scheduleMoveMembersBackToMainChannel,
} from "../../services/temporaryVoiceChannels.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import {
  CommandName,
  CommandPermission,
  TEMP_VOICE_HARD_MAX_AMOUNT,
  TEMP_VOICE_GROUP_SIZE_MAX,
  TEMP_VOICE_MOVE_MAX_DELAY_MINUTES,
} from "../../constants.js";
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
  .addSubcommand((sub) => sub.setName("clear").setDescription("Löscht alle aktuell verwalteten temporären Sprachkanäle"))
  .addSubcommand((sub) =>
    sub
      .setName("move")
      .setDescription("Holt alle Mitglieder aus den temporären Sprachkanälen in den Haupt-Sprachkanal des Events zurück")
      .addIntegerOption((opt) =>
        opt
          .setName("time_m")
          .setDescription("Verzögerung in Minuten, bevor automatisch zurückgeholt wird (weglassen für sofort)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(TEMP_VOICE_MOVE_MAX_DELAY_MINUTES),
      ),
  );

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

async function executeMove(interaction: ChatInputCommandInteraction): Promise<void> {
  const timeM = interaction.options.getInteger("time_m", false);

  if (timeM === null) {
    const result = await moveMembersBackToMainChannel(interaction.guild!);
    if (!result.ok) {
      await interaction.editReply({ embeds: [createErrorEmbed(result.message)] });
      return;
    }
    const parts = [`**${result.moved}** Mitglied/-er verschoben`];
    if (result.alreadyThere > 0) parts.push(`${result.alreadyThere} bereits im Zielkanal`);
    if (result.failed > 0) parts.push(`${result.failed} konnten nicht verschoben werden`);
    await interaction.editReply({ embeds: [createSuccessEmbed(parts.join(", ") + ".")] });
    return;
  }

  const result = scheduleMoveMembersBackToMainChannel(interaction.guild!.id, timeM, interaction.user.id);
  if (!result.ok) {
    await interaction.editReply({ embeds: [createErrorEmbed(result.message)] });
    return;
  }
  await interaction.editReply({
    embeds: [createSuccessEmbed(`Mitglieder werden in **${timeM}** Minute${timeM === 1 ? "" : "n"} automatisch zurückgeholt (<t:${Math.floor(new Date(result.dueAt).getTime() / 1000)}:R>).`)],
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [createErrorEmbed("Dieser Befehl kann nur auf einem Server verwendet werden.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const me = interaction.guild.members.me;
  const requiredPermission = subcommand === "move" ? PermissionsBitField.Flags.MoveMembers : PermissionsBitField.Flags.ManageChannels;
  const requiredPermissionLabel = subcommand === "move" ? "Mitglieder verschieben" : "Kanäle verwalten";
  if (!me?.permissions.has(requiredPermission)) {
    await interaction.reply({
      embeds: [createErrorEmbed(`Ich benötige die Berechtigung "${requiredPermissionLabel}", um das zu tun.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (subcommand === "create") {
      await executeCreate(interaction);
    } else if (subcommand === "move") {
      await executeMove(interaction);
    } else {
      await executeClear(interaction);
    }
  } catch (err) {
    logger.error(`/voice-channel fehlgeschlagen: ${errorMessage(err)}`);
    await interaction.editReply({ embeds: [createErrorEmbed(`Ein Fehler ist aufgetreten: ${errorMessage(err)}`)] });
  }
}
