import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { listEventTemplates, getEventTemplateByName } from "../../db/eventTemplatesRepository.js";
import { getSettings } from "../../db/settingsRepository.js";
import { publishEvent, getTemplatePlaceholderTokens } from "../../services/events.js";
import { errorMessage } from "../../utils/logger.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.Admin;

export const data = new SlashCommandBuilder()
  .setName(CommandName.Event)
  .setDescription("Veröffentlicht ein Event aus einer Vorlage. Vorlagen werden über das Dashboard verwaltet.")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Erstellt und veröffentlicht ein Event aus einer Vorlage")
      .addStringOption((opt) => opt.setName("vorlage").setDescription("Name der Event-Vorlage").setRequired(true).setAutocomplete(true)),
  );

const MODAL_ID_PREFIX = "event:create-modal";
/** Discord caps a modal at 5 text inputs. Two are always start/end time, leaving at most 3 for a template's own `{token}` placeholders — a template needing more has to be published from the dashboard instead, which has no such limit. */
const MAX_MODAL_PLACEHOLDERS = 3;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const templateName = interaction.options.getString("vorlage", true);
  const template = getEventTemplateByName(templateName);
  if (!template) {
    await interaction.reply({ content: `Vorlage "${templateName}" nicht gefunden.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const placeholders = getTemplatePlaceholderTokens(template.titleTemplate, template.descriptionTemplate);
  if (placeholders.length > MAX_MODAL_PLACEHOLDERS) {
    await interaction.reply({
      content: `Diese Vorlage hat zu viele Platzhalter für ein Discord-Formular (${placeholders.length}, maximal ${MAX_MODAL_PLACEHOLDERS}) — bitte über das Dashboard veröffentlichen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder().setCustomId(`${MODAL_ID_PREFIX}:${template.id}`).setTitle(`Event: ${template.name}`.slice(0, 45));
  for (const token of placeholders) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(`ph:${token}`).setLabel(token.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
  }
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("startsAt")
        .setLabel("Start (ISO, z.B. 2026-09-20T19:00:00+02:00)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("endsAt").setLabel("Ende (ISO)").setStyle(TextInputStyle.Short).setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = listEventTemplates()
    .filter((t) => t.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((t) => ({ name: t.name, value: t.name }));
  await interaction.respond(choices);
}

/** Handles the modal shown by `execute()` above — parses the placeholder/time fields, renders and publishes the event. Registered from `eventWatcher.ts`'s `interactionCreate` listener alongside the RSVP button handler, not the central command dispatcher (this is a modal submission, not a chat-input command). */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const templateId = Number(interaction.customId.slice(MODAL_ID_PREFIX.length + 1));
  const templates = listEventTemplates();
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    await interaction.reply({ content: "Diese Vorlage existiert nicht mehr.", flags: MessageFlags.Ephemeral });
    return;
  }

  const startsAtRaw = interaction.fields.getTextInputValue("startsAt");
  const endsAtRaw = interaction.fields.getTextInputValue("endsAt");
  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    await interaction.reply({ content: "Start/Ende konnten nicht als Datum gelesen werden — bitte ISO-Format verwenden.", flags: MessageFlags.Ephemeral });
    return;
  }

  const placeholders: Record<string, string> = {};
  for (const token of getTemplatePlaceholderTokens(template.titleTemplate, template.descriptionTemplate)) {
    placeholders[token] = interaction.fields.getTextInputValue(`ph:${token}`);
  }

  const channelId = template.defaultChannelId ?? getSettings().defaultEventChannelId;
  if (!channelId) {
    await interaction.reply({ content: "Kein Kanal konfiguriert (weder auf der Vorlage noch als Standard in den Einstellungen).", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await publishEvent(interaction.client, {
      titleTemplate: template.titleTemplate,
      descriptionTemplate: template.descriptionTemplate,
      placeholders,
      channelId,
      mentionRoleId: template.defaultMentionRoleId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    await interaction.editReply({ content: "Event veröffentlicht!" });
  } catch (err) {
    await interaction.editReply({ content: `Event konnte nicht veröffentlicht werden: ${errorMessage(err)}` });
  }
}
