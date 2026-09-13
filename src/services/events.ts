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
import { createEmbed } from "../utils/embedUtils.js";
import { applyFont } from "../utils/font.js";
import { getSettings } from "../db/settingsRepository.js";
import { EVENT_RSVP_CHOICES, EmbedColor } from "../constants.js";
import logger, { errorMessage } from "../utils/logger.js";
import type { Event, RsvpChoice } from "../types.js";

const COMPONENT_ID_PREFIX = "event";

/** Sentinel `mentionRoleId` value standing in for @everyone, which isn't a real role — see `/discord/roles`' deliberate `r.id !== guild.id` filter (correct for reaction-roles/gate-role pickers, wrong for this one), and `mentionContent()` below. */
export const EVERYONE_MENTION_SENTINEL = "everyone";

function rsvpCustomId(eventId: number, choice: RsvpChoice): string {
  return `${COMPONENT_ID_PREFIX}:rsvp:${eventId}:${choice}`;
}

/** Discord's `<t:epoch:STYLE>` mention-style timestamp token — renders in each viewer's own timezone/locale, unlike a fixed-format string. */
function discordTimestamp(iso: string, style: "F" | "t" | "R" = "F"): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

/** Apollo-style "Zeitpunkt" field: full start date/time, short end time, and a relative "in 3 Tagen" line — mirrors apollo-event-embed-example.png. */
function timeFieldValue(startsAt: string, endsAt: string): string {
  return `${discordTimestamp(startsAt, "F")} – ${discordTimestamp(endsAt, "t")}\n🕐 ${discordTimestamp(startsAt, "R")}`;
}

/** `@everyone` (plain text — Discord doesn't use `<@&id>` mention syntax for it) or a real role mention, or nothing. */
function mentionContent(mentionRoleId: string | null): string | undefined {
  if (!mentionRoleId) return undefined;
  return mentionRoleId === EVERYONE_MENTION_SENTINEL ? "@everyone" : `<@&${mentionRoleId}>`;
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

/**
 * Rebuilds the event embed from scratch (title/description, a "🕐
 * Zeitpunkt" field, and a live per-choice name list) — called both right
 * after publishing and after every RSVP click/edit. `title`/`description`
 * are stored raw (unstyled); `event.useFont` applies the *current* global
 * font (`settings.fontMap`) fresh on every render, same convention as
 * reaction-role panels' `styled()` — a later font change is reflected the
 * next time the embed is rebuilt, not frozen at publish time.
 */
function renderEventEmbed(params: {
  title: string;
  description: string;
  useFont: boolean;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  signups: ReturnType<typeof listSignups>;
}) {
  const { title, description, useFont, startsAt, endsAt, cancelled, signups } = params;
  const accepted = signups.filter((s) => s.choice === "accepted").length;
  const tentative = signups.filter((s) => s.choice === "tentative").length;
  const declined = signups.filter((s) => s.choice === "declined").length;
  const fontMap = useFont ? getSettings().fontMap : null;
  const styled = (text: string) => (fontMap ? applyFont(text, fontMap) : text);
  return createEmbed({
    title: styled(title),
    description: description ? styled(description) : undefined,
    color: cancelled ? EmbedColor.Error : EmbedColor.Info,
    fields: [
      { name: "Zeitpunkt", value: timeFieldValue(startsAt, endsAt) },
      { name: `✅ Zusagen (${accepted})`, value: nameList(signups, "accepted"), inline: true },
      { name: `❌ Absagen (${declined})`, value: nameList(signups, "declined"), inline: true },
      { name: `❓ Vielleicht (${tentative})`, value: nameList(signups, "tentative"), inline: true },
    ],
  });
}

function buildEventEmbed(event: Event) {
  return renderEventEmbed({
    title: event.title,
    description: event.description,
    useFont: event.useFont,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    cancelled: event.status === "cancelled",
    signups: listSignups(event.id),
  });
}

/** Exact embed a freshly-published event will show (zero signups yet) — used to preview the event in a confirmation thread before it's actually posted. */
export function buildPreviewEmbed(input: PublishEventInput) {
  return renderEventEmbed({
    title: input.title,
    description: input.description,
    useFont: input.useFont,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    cancelled: false,
    signups: [],
  });
}

export interface PublishEventInput {
  title: string;
  description: string;
  channelId: string;
  /** A real role id, `EVERYONE_MENTION_SENTINEL`, or null for no mention. */
  mentionRoleId: string | null;
  /** Null = fall back to `settings.eventVoiceChannelId` at activation. */
  voiceChannelId: string | null;
  useFont: boolean;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Posts the event message with its three RSVP buttons and creates the `events` row — the single entry point both the dashboard and `/event` go through. */
export async function publishEvent(client: Client, input: PublishEventInput): Promise<Event> {
  const channel = await client.channels.fetch(input.channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Kanal ${input.channelId} ist kein Textkanal oder wurde nicht gefunden.`);
  }

  // A placeholder id (0) is fine for the first render — the message doesn't
  // exist yet, so no signups can reference it; the real id is stamped onto
  // the buttons via a follow-up edit right after the DB row is created.
  const content = mentionContent(input.mentionRoleId);
  const message = await channel.send({ content, embeds: [buildPreviewEmbed(input)], components: [buildRsvpButtons(0)] });

  const event = createEventRow({
    messageId: message.id,
    channelId: input.channelId,
    title: input.title,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    configuredVoiceChannelId: input.voiceChannelId,
    useFont: input.useFont,
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
