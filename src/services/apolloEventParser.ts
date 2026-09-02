import type { Embed } from "discord.js";
import {
  APOLLO_EVENT_DEFAULT_DURATION_MS,
  APOLLO_EVENT_URL_REGEX,
  APOLLO_RSVP_FIELD_LABELS,
  DISCORD_TIMESTAMP_TOKEN_REGEX,
  GOOGLE_CALENDAR_DATES_REGEX,
} from "../constants.js";
import type { ApolloRsvpChoice } from "../types.js";

/**
 * Minimal shape this parser needs from a discord.js `Message`/`PartialMessage`
 * — kept narrow so it's trivial to hand it a synthetic object in a test
 * script instead of a real Message instance (see docs/EVENT_ATTENDANCE.md's
 * verification section).
 */
export interface ApolloMessageLike {
  embeds: Embed[];
  /** Message components (buttons etc.) — only their `url`s (link buttons) are ever read, as a fallback source for the Apollo event id/calendar dates. */
  components: unknown[];
}

export interface ParsedApolloSignup {
  /** Exactly as it appeared on Apollo's list, one line. */
  rawName: string;
  choice: ApolloRsvpChoice;
  /** Set only if the line was a `<@id>` mention rather than plain text — short-circuits name matching straight to this user. */
  mentionUserId: string | null;
}

export interface ParsedApolloEvent {
  /** Numeric id from an `apollo.fyi/events/<id>` link, if found anywhere in the embed or its components. Null if not found — the caller falls back to the message id as identity. */
  apolloEventId: string | null;
  title: string;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
  signups: ParsedApolloSignup[];
}

/** Strips custom-emoji tokens, unicode emoji, a trailing `(N)`/`[N]` count, and remaining punctuation, so an embed field name can be matched against `APOLLO_RSVP_FIELD_LABELS`/a "time"-ish label regardless of exactly how Apollo decorates it. */
function normalizeFieldLabel(name: string): string {
  return name
    .replace(/[([]\s*\d+\s*[)\]]\s*$/, "")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Splits an RSVP field's raw value into one cleaned name per line — see docs/EVENT_ATTENDANCE.md for the exact rules and why they're a best-effort approximation pending a real Apollo sample. */
function splitRsvpLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
        .replace(/\s*\(\+\d+\)\s*$/, "")
        .replace(/^[*_~`]+|[*_~`]+$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !/^[-—_\s]*$/.test(line));
}

/** First two *distinct* epoch-seconds Discord timestamp tokens found, scanning `texts` in order (so a "Time"-labeled field can be searched first). */
function extractTimestampEpochs(texts: string[]): number[] {
  const found: number[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(DISCORD_TIMESTAMP_TOKEN_REGEX)) {
      const epoch = Number(match[1]);
      if (!found.includes(epoch)) found.push(epoch);
      if (found.length >= 2) return found;
    }
  }
  return found;
}

/** `YYYYMMDDTHHMMSSZ` (Google Calendar's `dates=` param format) -> ISO UTC. */
function parseGoogleCalendarTimestamp(raw: string): string {
  const y = raw.slice(0, 4);
  const mo = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const h = raw.slice(9, 11);
  const mi = raw.slice(11, 13);
  const s = raw.slice(13, 15);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

/** Recursively collects every `url` string off a message's (JSON-serialized) components — link buttons are the only place a URL can hide there. */
function extractComponentUrls(components: unknown[]): string[] {
  const urls: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.url === "string") urls.push(obj.url);
    if (Array.isArray(obj.components)) obj.components.forEach(walk);
  };
  for (const component of components) {
    const json = typeof (component as { toJSON?: () => unknown }).toJSON === "function"
      ? (component as { toJSON: () => unknown }).toJSON()
      : component;
    walk(json);
  }
  return urls;
}

/**
 * Parses an Apollo (apollo.fyi) event-RSVP embed into structured data, or
 * returns `null` if `message` doesn't look like one. Detection is by embed
 * *shape* (at least one field matching `APOLLO_RSVP_FIELD_LABELS`), not a
 * hardcoded bot id — see `apolloEventWatcher.ts` for the channel-gating that
 * happens before this is even called.
 *
 * Pure and side-effect-free: takes no `client`, does no name resolution, and
 * always returns the same result for the same input — safe to unit-test with
 * a synthetic `ApolloMessageLike`.
 */
export function parseApolloEventEmbed(message: ApolloMessageLike): ParsedApolloEvent | null {
  const embed = message.embeds[0];
  if (!embed) return null;

  const rsvpFields = embed.fields
    .map((field) => ({ field, choice: APOLLO_RSVP_FIELD_LABELS[normalizeFieldLabel(field.name)] }))
    .filter((entry): entry is { field: (typeof embed.fields)[number]; choice: ApolloRsvpChoice } =>
      entry.choice !== undefined,
    );
  if (rsvpFields.length === 0) return null;

  let title = embed.title ?? "(ohne Titel)";
  const linkMatch = title.match(/^\[(.+)\]\(.+\)$/);
  if (linkMatch) title = linkMatch[1]!;

  const timeField = embed.fields.find((field) => /^(time|zeit|when|wann)/.test(normalizeFieldLabel(field.name)));
  const otherFieldValues = embed.fields.filter((field) => field !== timeField).map((field) => field.value);
  const timestampSearchOrder = [timeField?.value ?? "", ...otherFieldValues, embed.description ?? ""];
  const epochs = extractTimestampEpochs(timestampSearchOrder);

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  if (epochs.length >= 2) {
    startsAt = new Date(epochs[0]! * 1000).toISOString();
    endsAt = new Date(epochs[1]! * 1000).toISOString();
  } else if (epochs.length === 1) {
    startsAt = new Date(epochs[0]! * 1000).toISOString();
    endsAt = new Date(epochs[0]! * 1000 + APOLLO_EVENT_DEFAULT_DURATION_MS).toISOString();
  } else {
    const calendarSources = [
      embed.description ?? "",
      ...embed.fields.map((field) => field.value),
      ...extractComponentUrls(message.components),
    ];
    for (const source of calendarSources) {
      const match = source.match(GOOGLE_CALENDAR_DATES_REGEX);
      if (match) {
        startsAt = parseGoogleCalendarTimestamp(match[1]!);
        endsAt = parseGoogleCalendarTimestamp(match[2]!);
        break;
      }
    }
  }
  if (!startsAt || !endsAt) return null;

  const idSources = [
    embed.url ?? "",
    embed.title ?? "",
    embed.description ?? "",
    embed.footer?.text ?? "",
    ...embed.fields.map((field) => field.value),
    ...extractComponentUrls(message.components),
  ];
  let apolloEventId: string | null = null;
  for (const source of idSources) {
    const match = source.match(APOLLO_EVENT_URL_REGEX);
    if (match) {
      apolloEventId = match[1]!;
      break;
    }
  }

  const signups: ParsedApolloSignup[] = [];
  for (const { field, choice } of rsvpFields) {
    for (const line of splitRsvpLines(field.value)) {
      const mentionMatch = line.match(/^<@!?(\d+)>$/);
      signups.push({ rawName: line, choice, mentionUserId: mentionMatch ? mentionMatch[1]! : null });
    }
  }

  return { apolloEventId, title, startsAt, endsAt, signups };
}
