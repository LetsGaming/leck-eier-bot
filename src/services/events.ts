import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type Guild,
} from "discord.js";
import {
  createEvent as createEventRow,
  updateEventFields,
  getEventById,
  getEventByMessageId,
  upsertSignupByUser,
  listSignups,
  setEventCancelled,
} from "../db/eventAttendanceRepository.js";
import { renderTemplate } from "../shared/messageTemplate.js";
import { createEmbed } from "../utils/embedUtils.js";
import { EVENT_RSVP_CHOICES, EmbedColor } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { Event, RsvpChoice } from "../types.js";

const COMPONENT_ID_PREFIX = "event";

function rsvpCustomId(eventId: number, choice: RsvpChoice): string {
  return `${COMPONENT_ID_PREFIX}:rsvp:${eventId}:${choice}`;
}

/** Discord's `<t:epoch:F>` mention-style timestamp token — renders in each viewer's own timezone/locale, unlike a fixed-format string. */
function discordTimestamp(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>`;
}

const PLACEHOLDER_TOKEN_REGEX = /\{([^{}]+)\}/g;
const CORE_TIME_TOKENS = new Set(["start_time", "end_time"]);

/** Every distinct `{token}` in a template's title/description, excluding the always-available `{start_time}`/`{end_time}` — the set of placeholder values a caller (the dashboard form, or `/event`'s modal) needs to collect before publishing. */
export function getTemplatePlaceholderTokens(...templates: string[]): string[] {
  const found = new Set<string>();
  for (const template of templates) {
    PLACEHOLDER_TOKEN_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_TOKEN_REGEX.exec(template))) {
      if (!CORE_TIME_TOKENS.has(match[1]!)) found.add(match[1]!);
    }
  }
  return [...found];
}

export interface RenderEventTextInput {
  titleTemplate: string;
  descriptionTemplate: string;
  /** Arbitrary `{token}` fill-ins the caller collected for this specific event (from a template's placeholders, or typed directly for a from-scratch event). */
  placeholders: Record<string, string>;
  startsAt: string;
  endsAt: string;
}

/**
 * Renders a template's title/description through the shared token engine
 * (`renderTemplate()`, `src/shared/messageTemplate.ts` — the same engine
 * birthdays/reaction-roles/registration use). `{start_time}`/`{end_time}`
 * are always available as raw context, resolving to Discord timestamp
 * tokens; every other placeholder comes from the caller. No font styling —
 * events don't have a per-feature font toggle (unlike the other three
 * template consumers), so `useFont` is always off here.
 */
export function renderEventText(input: RenderEventTextInput): { title: string; description: string } {
  const raw = { ...input.placeholders, start_time: discordTimestamp(input.startsAt), end_time: discordTimestamp(input.endsAt) };
  return {
    title: renderTemplate(input.titleTemplate, { raw }, {}, { useFont: false, fontMap: null }),
    description: renderTemplate(input.descriptionTemplate, { raw }, {}, { useFont: false, fontMap: null }),
  };
}

function buildRsvpButtons(eventId: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const { choice, emoji, label } of EVENT_RSVP_CHOICES) {
    row.addComponents(new ButtonBuilder().setCustomId(rsvpCustomId(eventId, choice)).setStyle(ButtonStyle.Secondary).setEmoji(emoji).setLabel(label));
  }
  return row;
}

function nameList(signups: ReturnType<typeof listSignups>, choice: RsvpChoice): string {
  const matching = signups.filter((s) => s.choice === choice);
  if (matching.length === 0) return "—";
  return matching.map((s) => (s.userId ? `<@${s.userId}>` : s.rawName)).join("\n");
}

/** Rebuilds the event embed from scratch (title/description + a live per-choice name list) — called both right after publishing and after every RSVP click. */
function buildEventEmbed(event: Event) {
  const signups = listSignups(event.id);
  const accepted = signups.filter((s) => s.choice === "accepted").length;
  const tentative = signups.filter((s) => s.choice === "tentative").length;
  const declined = signups.filter((s) => s.choice === "declined").length;
  return createEmbed({
    title: event.title,
    description: event.description || undefined,
    color: event.status === "cancelled" ? EmbedColor.Error : EmbedColor.Info,
    fields: [
      { name: `✅ Zusagen (${accepted})`, value: nameList(signups, "accepted"), inline: true },
      { name: `❓ Vielleicht (${tentative})`, value: nameList(signups, "tentative"), inline: true },
      { name: `❌ Absagen (${declined})`, value: nameList(signups, "declined"), inline: true },
    ],
  });
}

export interface PublishEventInput {
  titleTemplate: string;
  descriptionTemplate: string;
  placeholders: Record<string, string>;
  channelId: string;
  mentionRoleId: string | null;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Renders a template (or from-scratch fields), posts the event message with its three RSVP buttons, and creates the `events` row — the single entry point both the dashboard and `/event` go through. */
export async function publishEvent(client: Client, input: PublishEventInput): Promise<Event> {
  const { title, description } = renderEventText(input);
  const channel = await client.channels.fetch(input.channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Kanal ${input.channelId} ist kein Textkanal oder wurde nicht gefunden.`);
  }

  // A placeholder id (0) is fine for the first render — the message doesn't
  // exist yet, so no signups can reference it; the real id is stamped onto
  // the buttons via a follow-up edit right after the DB row is created.
  const placeholderEmbed = createEmbed({ title, description: description || undefined, color: EmbedColor.Info });
  const content = input.mentionRoleId ? `<@&${input.mentionRoleId}>` : undefined;
  const message = await channel.send({ content, embeds: [placeholderEmbed], components: [buildRsvpButtons(0)] });

  const event = createEventRow({
    messageId: message.id,
    channelId: input.channelId,
    title,
    description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });

  await message.edit({ embeds: [buildEventEmbed(event)], components: [buildRsvpButtons(event.id)] });
  return event;
}

/** Re-renders and edits a still-`scheduled` event's Discord message after a dashboard edit. */
export async function editEvent(
  client: Client,
  eventId: number,
  fields: { title: string; description: string; startsAt: string; endsAt: string },
): Promise<Event> {
  const existing = getEventById(eventId);
  if (!existing) throw new Error(`Event #${eventId} nicht gefunden.`);
  const event = updateEventFields(eventId, fields);
  const channel = await client.channels.fetch(event.channelId).catch(() => null);
  if (channel && channel.isTextBased() && "messages" in channel) {
    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    await message?.edit({ embeds: [buildEventEmbed(event)], components: [buildRsvpButtons(event.id)] }).catch(() => undefined);
  }
  return event;
}

/** Cancels an event and edits its message to show the cancelled state (buttons removed — no more RSVPs accepted). Mirrors the `messageDelete` cancellation path in `eventWatcher.ts`, but as a deliberate dashboard action. */
export async function cancelEvent(client: Client, eventId: number): Promise<void> {
  setEventCancelled(eventId);
  const event = getEventById(eventId);
  if (!event) return;
  const channel = await client.channels.fetch(event.channelId).catch(() => null);
  if (channel && channel.isTextBased() && "messages" in channel) {
    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    await message?.edit({ embeds: [buildEventEmbed(event)], components: [] }).catch(() => undefined);
  }
}

// --- RSVP button interaction handling ----------------------------------------
// Same per-(message,user) serialization pattern as reactionRoles.ts's
// runSerialized — prevents rapid double-clicks on the same event from
// interleaving two concurrent upsert+edit cycles for one user.

const userTaskQueues = new Map<string, Promise<void>>();

async function runSerialized<T>(eventId: number, userId: string, task: () => Promise<T>): Promise<T | undefined> {
  const key = `${eventId}:${userId}`;
  const previous = userTaskQueues.get(key) ?? Promise.resolve();
  let result: T | undefined;
  const next = previous
    .then(async () => {
      result = await task();
    })
    .catch((err) => {
      logger.error(`Event-RSVP-Verarbeitung fehlgeschlagen: ${errorMessage(err)}`);
    });
  userTaskQueues.set(key, next);
  await next;
  if (userTaskQueues.get(key) === next) userTaskQueues.delete(key);
  return result;
}

function displayNameFor(interaction: ButtonInteraction, guild: Guild | null): string {
  const member = guild?.members.cache.get(interaction.user.id);
  return member?.displayName ?? interaction.user.username;
}

/** Handles an `event:rsvp:<eventId>:<choice>` button click: upserts the signup, then rebuilds and edits the event message so the live name list reflects it. */
export async function handleEventRsvpButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== COMPONENT_ID_PREFIX || parts[1] !== "rsvp") return;
  const eventId = Number(parts[2]);
  const choice = parts[3] as RsvpChoice;

  const event = getEventById(eventId);
  if (!event || event.status !== "scheduled") {
    await interaction.reply({ content: "Diese Veranstaltung ist nicht mehr offen für Anmeldungen.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await runSerialized(eventId, interaction.user.id, async () => {
    const displayName = displayNameFor(interaction, interaction.guild);
    upsertSignupByUser(eventId, interaction.user.id, displayName, choice);
    const refreshed = getEventById(eventId)!;
    await interaction.message.edit({ embeds: [buildEventEmbed(refreshed)], components: [buildRsvpButtons(eventId)] }).catch(() => undefined);
    const label = EVENT_RSVP_CHOICES.find((c) => c.choice === choice)?.label ?? choice;
    await interaction.editReply({ content: `Du bist jetzt eingetragen als: ${label}` }).catch(() => undefined);
  });
}

/** Cancellation triggered by the event message itself being deleted (e.g. by a moderator, outside the dashboard's own cancel flow) — see `eventWatcher.ts`. */
export function cancelEventByMessageId(messageId: string): void {
  const event = getEventByMessageId(messageId);
  if (event && event.status === "scheduled") {
    setEventCancelled(event.id);
    logger.info(`Event "${event.title}" (#${event.id}) storniert: Nachricht wurde gelöscht.`);
  }
}
