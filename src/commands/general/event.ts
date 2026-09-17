import {
  SlashCommandBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { listEventTemplates, getEventTemplateByName } from "../../db/eventTemplatesRepository.js";
import { createScheduledPublish } from "../../db/scheduledEventPublishesRepository.js";
import { getSettings } from "../../db/settingsRepository.js";
import { publishEvent, buildPreviewEmbed, type PublishEventInput } from "../../services/events.js";
import { nextWeekdayOccurrenceUtc, parseLocalDateTime, formatLocalDateTime } from "../../utils/timezone.js";
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
  const tz = loadConfig().timezone;

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
        .setLabel("Start (TT.MM.JJJJ HH:MM)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("startsAt")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("20.09.2026 19:00")
            .setRequired(true)
            .setValue(occurrence ? formatLocalDateTime(occurrence.startsAt, tz) : ""),
        ),
      new LabelBuilder()
        .setLabel("Ende (TT.MM.JJJJ HH:MM)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("endsAt")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("20.09.2026 21:00")
            .setRequired(true)
            .setValue(occurrence ? formatLocalDateTime(occurrence.endsAt, tz) : ""),
        ),
      new LabelBuilder()
        .setLabel("Veröffentlichen am (TT.MM.JJJJ HH:MM, leer = sofort)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("publishAt")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("20.09.2026 09:00")
            .setRequired(false),
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

  const tz = loadConfig().timezone;
  const startsAtRaw = interaction.fields.getTextInputValue("startsAt");
  const endsAtRaw = interaction.fields.getTextInputValue("endsAt");
  const startsAt = parseLocalDateTime(startsAtRaw, tz);
  const endsAt = parseLocalDateTime(endsAtRaw, tz);
  if (!startsAt || !endsAt) {
    await interaction.reply({
      content: "Start/Ende konnten nicht gelesen werden — bitte im Format TT.MM.JJJJ HH:MM angeben (z.B. 20.09.2026 19:00).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const publishAtRaw = interaction.fields.getTextInputValue("publishAt").trim();
  const publishAt = publishAtRaw ? parseLocalDateTime(publishAtRaw, tz) : null;
  if (publishAtRaw && !publishAt) {
    await interaction.reply({
      content: "Veröffentlichungszeitpunkt konnte nicht gelesen werden — bitte im Format TT.MM.JJJJ HH:MM angeben.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (publishAt && publishAt.getTime() >= startsAt.getTime()) {
    await interaction.reply({ content: "Die Veröffentlichung muss vor dem Start liegen.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channelId = template.defaultChannelId ?? getSettings().defaultEventChannelId;
  if (!channelId) {
    await interaction.reply({ content: "Kein Kanal konfiguriert (weder auf der Vorlage noch als Standard in den Einstellungen).", flags: MessageFlags.Ephemeral });
    return;
  }

  const input: PublishEventInput = {
    title: interaction.fields.getTextInputValue("title"),
    description: interaction.fields.getTextInputValue("description"),
    channelId,
    mentionRoleId: template.defaultMentionRoleId,
    voiceChannelId: template.defaultVoiceChannelId,
    useFont: template.useFont,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.editReply({ content: `Kanal ${channelId} ist kein Textkanal oder wurde nicht gefunden.` });
    return;
  }

  let thread;
  try {
    thread = await (channel as TextChannel).threads.create({
      name: `Event-Vorschau: ${input.title}`.slice(0, 100),
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60,
      reason: "Event-Erstellung Vorschau",
    });
  } catch (err) {
    await interaction.editReply({ content: `Vorschau-Thread konnte nicht erstellt werden: ${errorMessage(err)}` });
    return;
  }

  try {
    const previewMessage = await thread.send({
      content: publishAt
        ? `${interaction.user}, so sieht das Event aus. Für <t:${Math.floor(publishAt.getTime() / 1000)}:F> einplanen?`
        : `${interaction.user}, so sieht das Event aus. Veröffentlichen?`,
      embeds: [buildPreviewEmbed(input)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel(publishAt ? "Einplanen" : "Veröffentlichen").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel").setLabel("Abbrechen").setStyle(ButtonStyle.Danger),
        ),
      ],
    });

    await interaction.editReply({ content: `Vorschau erstellt: ${thread}` });

    try {
      const buttonInteraction = await previewMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000,
        filter: (i) => i.user.id === interaction.user.id,
      });
      await buttonInteraction.deferUpdate();

      if (buttonInteraction.customId === "confirm") {
        if (publishAt) {
          createScheduledPublish({ publishAt: publishAt.toISOString(), payload: input });
          await interaction.editReply({ content: "Veröffentlichung eingeplant!" });
        } else {
          await publishEvent(interaction.client, input);
          await interaction.editReply({ content: "Event veröffentlicht!" });
        }
      } else {
        await interaction.editReply({ content: "Abgebrochen." });
      }
    } catch {
      await interaction.editReply({ content: "Zeit abgelaufen — Event wurde nicht veröffentlicht." }).catch(() => undefined);
    }
  } catch (err) {
    await interaction.editReply({ content: `Event konnte nicht veröffentlicht/eingeplant werden: ${errorMessage(err)}` }).catch(() => undefined);
  } finally {
    await thread.delete().catch(() => undefined);
  }
}
