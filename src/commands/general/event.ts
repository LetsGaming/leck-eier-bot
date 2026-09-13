import {
  SlashCommandBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { listEventTemplates, getEventTemplateByName } from "../../db/eventTemplatesRepository.js";
import { getSettings } from "../../db/settingsRepository.js";
import { publishEvent } from "../../services/events.js";
import { nextWeekdayOccurrenceUtc } from "../../utils/timezone.js";
import { loadConfig } from "../../config/index.js";
import { errorMessage } from "../../utils/logger.js";
import { CommandName, CommandPermission } from "../../constants.js";
import type { EventTemplate } from "../../types.js";

/** `template`'s recurring-time default (if set), as ISO strings in the server's configured timezone — prefilled into the modal's start/end fields, still editable. Null if the template has no default. */
function defaultOccurrence(template: EventTemplate): { startsAt: string; endsAt: string } | null {
  if (template.defaultWeekday === null || template.defaultStartTime === null || template.defaultEndTime === null) return null;
  const { startsAt, endsAt } = nextWeekdayOccurrenceUtc(
    template.defaultWeekday,
    template.defaultStartTime,
    template.defaultEndTime,
    loadConfig().timezone,
  );
  return { startsAt, endsAt };
}

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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const templateName = interaction.options.getString("vorlage", true);
  const template = getEventTemplateByName(templateName);
  if (!template) {
    await interaction.reply({ content: `Vorlage "${templateName}" nicht gefunden.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const occurrence = defaultOccurrence(template);

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_ID_PREFIX}:${template.id}`)
    .setTitle(`Event: ${template.name}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Titel")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("title").setStyle(TextInputStyle.Short).setValue(template.defaultTitle).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Beschreibung")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("description")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(template.baseDescription)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("Start (ISO, z.B. 2026-09-20T19:00:00+02:00)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("startsAt")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(occurrence?.startsAt ?? ""),
        ),
      new LabelBuilder()
        .setLabel("Ende (ISO)")
        .setTextInputComponent(
          new TextInputBuilder().setCustomId("endsAt").setStyle(TextInputStyle.Short).setRequired(true).setValue(occurrence?.endsAt ?? ""),
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

/** Handles the modal shown by `execute()` above — parses title/description/time and publishes the event. Registered from `eventWatcher.ts`'s `interactionCreate` listener alongside the RSVP button handler, not the central command dispatcher (this is a modal submission, not a chat-input command). */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const templateId = Number(interaction.customId.slice(MODAL_ID_PREFIX.length + 1));
  const template = listEventTemplates().find((t) => t.id === templateId);
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

  const channelId = template.defaultChannelId ?? getSettings().defaultEventChannelId;
  if (!channelId) {
    await interaction.reply({ content: "Kein Kanal konfiguriert (weder auf der Vorlage noch als Standard in den Einstellungen).", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await publishEvent(interaction.client, {
      title: interaction.fields.getTextInputValue("title"),
      description: interaction.fields.getTextInputValue("description"),
      channelId,
      mentionRoleId: template.defaultMentionRoleId,
      voiceChannelId: template.defaultVoiceChannelId,
      useFont: template.useFont,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    await interaction.editReply({ content: "Event veröffentlicht!" });
  } catch (err) {
    await interaction.editReply({ content: `Event konnte nicht veröffentlicht werden: ${errorMessage(err)}` });
  }
}
