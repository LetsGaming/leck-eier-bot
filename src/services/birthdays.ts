import type { Client, Collection, Message, TextBasedChannel } from "discord.js";
import logger, { errorMessage } from "../utils/logger.js";
import { deleteBirthdaysForUser, getAllBirthdaysByDate, getBirthdaysForDate } from "../db/birthdaysRepository.js";
import { getSettings, updateSettings } from "../db/settingsRepository.js";
import {
  getAnchorMessageChunks,
  setAnchorMessageChunks,
  type AnchorMessageChunk,
} from "../db/birthdayAnchorMessagesRepository.js";
import { applyFont } from "../utils/font.js";
import type { BirthdayEntry } from "../types.js";
import {
  BIRTHDAY_LIST_MARKER,
  DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE,
  DISCORD_FETCH_PAGE_SIZE,
  DISCORD_MESSAGE_MAX_LENGTH,
  MESSAGE_DELETE_DELAY_MS,
  SELF_BIRTHDAY_DATE_REGEX,
} from "../constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayDateKey(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

export function getTodaysBirthdays(): BirthdayEntry[] {
  return getBirthdaysForDate(todayDateKey());
}

export interface UpcomingBirthday {
  /** `DD.MM`, as stored — see the `birthdays` table's `date` column. */
  dateKey: string;
  /** This year's occurrence, or next year's if that's already passed (today itself still counts as upcoming). */
  date: Date;
  entries: BirthdayEntry[];
}

/** Every distinct birthday date, resolved to its next real occurrence and sorted soonest-first (wrapping the year). Powers both the dashboard's Birthdays page and {@link getNextBirthday}. */
export function getUpcomingBirthdays(): UpcomingBirthday[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();

  const upcoming = Object.entries(getAllBirthdaysByDate()).map(([dateKey, entries]) => {
    const [dd, mm] = dateKey.split(".").map((x) => parseInt(x, 10));
    const month = mm! - 1;
    const alreadyPassedThisYear = month < todayMonth || (month === todayMonth && dd! < todayDate);
    const year = alreadyPassedThisYear ? currentYear + 1 : currentYear;
    return { dateKey, date: new Date(year, month, dd), entries };
  });

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
  return upcoming;
}

/**
 * Whole days between now and `date` (both taken at server-local midnight,
 * so this is always an exact integer — 0 for today, 1 for tomorrow, ...).
 * Deliberately not done by shipping `date` itself to a client and
 * re-deriving this there: round-tripping a Date through JSON and
 * re-interpreting it in a *different* timezone (the browser's) than the
 * one that computed it (the server's) can land on the wrong calendar day
 * entirely — see the API route in src/web/routes/birthdays.ts.
 */
export function daysUntil(date: Date): number {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
}

/** The single soonest upcoming birthday — only meaningful when called after confirming there's none *today* (see `/checkbirthday`), since today's own date otherwise sorts first. */
export function getNextBirthday(): UpcomingBirthday | null {
  return getUpcomingBirthdays()[0] ?? null;
}

export function renderBirthdayTemplate(
  template: string,
  b: Pick<BirthdayEntry, "mention" | "userId" | "name">,
  pingEveryone = true,
): string {
  const userMention = b.mention || (b.userId ? `<@${b.userId}>` : "");
  const userNick = b.name || (b.userId ? `<@${b.userId}>` : "Friend");
  const everyoneMention = pingEveryone ? "@everyone" : "";
  return template
    .replace(/{userMention}/g, userMention)
    .replace(/{everyoneMention}/g, everyoneMention)
    .replace(/{userNick}/g, userNick);
}

export function buildBirthdayMessage(
  b: Pick<BirthdayEntry, "mention" | "userId" | "name">,
  pingEveryone = true,
): string {
  const settings = getSettings();
  const rendered = renderBirthdayTemplate(settings.birthdayTemplate, b, pingEveryone);
  return settings.birthdayAnnouncementUseFont ? applyFont(rendered, settings.fontMap) : rendered;
}

export async function sendBirthdayMessages(
  client: Client,
  channelId: string,
  birthdaysArray: BirthdayEntry[],
  pingEveryone = true,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Channel ${channelId} not found or not text-based`);
  }
  let settings = getSettings();

  for (const b of birthdaysArray) {
    const msgContent = buildBirthdayMessage(b, pingEveryone);
    const sentMsg = await channel.send(msgContent);
    if (!settings.firstBirthdayMessageId) {
      settings = updateSettings({ firstBirthdayMessageId: sentMsg.id });
    }
  }
}

/**
 * Sweeps `channelId` back to (and including) `settings.firstBirthdayMessageId`,
 * deleting everything except messages in `protectedIds` — used by the nightly
 * cleanup and `/clearbirthdaychannel` before/instead of posting that day's
 * announcements. `protectedIds` must include every message in the current
 * bot-managed anchor chain (see `getAnchorProtectedMessageIds()`) — the
 * announcement channel and the anchor channel are typically the same
 * channel, so without this every anchor chunk past the first would get
 * swept up and deleted right along with yesterday's announcements.
 */
export async function deleteBirthdayMessages(
  client: Client,
  channelId: string,
  protectedIds: Set<string>,
): Promise<number> {
  const settings = getSettings();
  const firstId = settings.firstBirthdayMessageId;
  if (!firstId) return 0;

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) return 0;

  let deletedCount = 0;
  let reachedFirst = false;
  let lastMessageId: string | undefined = undefined;
  const seen = new Set<string>();

  while (!reachedFirst) {
    const messages: Collection<string, Message> = await channel.messages.fetch({
      limit: DISCORD_FETCH_PAGE_SIZE,
      before: lastMessageId,
    });
    if (messages.size === 0) break;
    const first = messages.first();
    if (first && seen.has(first.id)) break;

    for (const msg of messages.values()) {
      seen.add(msg.id);
      if (msg.id === firstId) {
        if (!protectedIds.has(msg.id)) {
          try {
            await msg.delete();
            deletedCount++;
          } catch (err) {
            logger.warn(`Delete fail: ${msg.id}: ${errorMessage(err)}`);
          }
        }
        reachedFirst = true;
        break;
      }
      if (protectedIds.has(msg.id)) continue;
      try {
        await msg.delete();
        deletedCount++;
      } catch (err) {
        if ((err as { code?: number }).code !== DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE) {
          logger.warn(`Delete fail: ${msg.id}`, err);
        }
      }
      await sleep(MESSAGE_DELETE_DELAY_MS);
    }
    lastMessageId = messages.last()?.id;
  }
  if (reachedFirst) {
    updateSettings({ firstBirthdayMessageId: null });
  }
  return deletedCount;
}

/**
 * Removes a departed member's birthday entry (whether admin-added or
 * self-registered — a leave doesn't care which) from the DB and, if
 * anything was actually removed, re-renders the anchor message so they
 * disappear from it too. Called from `guildMemberRemove` regardless of
 * whether the member left voluntarily, was kicked, or was banned.
 */
export async function removeBirthdayOnMemberLeave(client: Client, userId: string): Promise<void> {
  const removed = deleteBirthdaysForUser(userId);
  if (removed === 0) return;
  logger.info(`Removed departed member ${userId}'s birthday entry.`);
  await syncAnchorMessage(client);
}

/** Every message id currently in the bot-managed anchor chain — pass to `deleteBirthdayMessages()` as `protectedIds` so the daily cleanup never sweeps up an anchor chunk. */
export function getAnchorProtectedMessageIds(): Set<string> {
  return new Set(getAnchorMessageChunks().map((c) => c.messageId));
}

export function getCurrentTemplate(): string {
  return getSettings().birthdayTemplate;
}

export function setCurrentTemplate(newTemplate: string): void {
  updateSettings({ birthdayTemplate: newTemplate });
}

/** Also used by `/setmybirthday` to validate its day/month options before storing them. */
export function isValidCalendarDate(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1]!;
}

/** `DD.MM`, zero-padded, as stored in the `birthdays` table — used by both `/setmybirthday` and the free-text channel parser below. */
export function toDateKey(day: number, month: number): string {
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
}

/**
 * Pulls a `DD.MM`-shaped date out of free text, for the birthday-channel
 * auto-detector (see `events/birthdayWatcher.ts`) — a real registration is
 * just a member typing their birthday.
 */
export function parseSelfRegistrationDate(text: string): string | null {
  const match = text.match(SELF_BIRTHDAY_DATE_REGEX);
  if (!match) return null;
  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  if (!isValidCalendarDate(day, month)) return null;
  return toDateKey(day, month);
}

/**
 * Posts a heads-up to the configured `birthdayModChannelId` whenever a
 * member registers their own birthday, so mods keep visibility even though
 * no admin action was involved. A no-op if that channel isn't configured.
 */
export async function notifyBirthdayRegistration(
  client: Client,
  entry: { mention: string; name: string | null; dateKey: string },
  via: "command" | "message",
): Promise<void> {
  const { birthdayModChannelId } = getSettings();
  if (!birthdayModChannelId) return;

  try {
    const channel = await client.channels.fetch(birthdayModChannelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    const viaText = via === "command" ? "über `/setmybirthday`" : "durch eine Nachricht im Geburtstagskanal";
    await channel.send(
      `🎂 ${entry.mention} (${entry.name ?? "unbekannt"}) hat seinen Geburtstag für den **${entry.dateKey}** ${viaText} eingetragen.`,
    );
  } catch (err) {
    logger.warn(`Failed to post birthday registration notice: ${errorMessage(err)}`);
  }
}

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** One independent piece of the bot-managed anchor message's content — either the intro, the "nothing registered yet" placeholder, or a single calendar month's block. `key` is stable across syncs (`"intro"`, `"empty"`, or the month number as a string) so `paginateAnchorParts()` can keep it pinned to the same chunk/message from one sync to the next. */
export interface AnchorPart {
  key: string;
  text: string;
}

/**
 * Builds the bot-managed anchor message's content as an ordered list of
 * independent, individually-keyed parts — the intro (if any) followed by
 * one block per calendar month that has entries — instead of one joined
 * string, so `paginateAnchorParts()` below can pack them across multiple
 * Discord messages without ever splitting in the middle of a month, and can
 * keep each month pinned to the same message across syncs. Each month is
 * rendered through `template`'s `{month}`/`{entries}` placeholders;
 * `{month}` is passed through `applyFont()` first, `{entries}` deliberately
 * never is, so mentions and dates always render literally no matter what
 * font is configured. `intro` is also always plain text, never styled.
 * Pure function of its arguments — never touches Discord itself; see
 * `syncAnchorMessage()` for that part.
 */
export function buildAnchorParts(
  entries: ReturnType<typeof getAllBirthdaysByDate>,
  template: string,
  fontMap: string | null,
  intro: string | null,
): AnchorPart[] {
  const byMonth = new Map<number, Array<{ dateKey: string; day: number; list: BirthdayEntry[] }>>();
  for (const [dateKey, list] of Object.entries(entries)) {
    const [dd, mm] = dateKey.split(".").map((x) => parseInt(x, 10));
    const bucket = byMonth.get(mm!) ?? [];
    bucket.push({ dateKey, day: dd!, list });
    byMonth.set(mm!, bucket);
  }

  const monthParts: AnchorPart[] = [];
  for (let month = 1; month <= 12; month++) {
    const days = byMonth.get(month);
    if (!days || days.length === 0) continue;
    days.sort((a, b) => a.day - b.day);

    const entryLines = days
      .map((d) => `${BIRTHDAY_LIST_MARKER} ${d.dateKey}: ${d.list.map((e) => e.mention).join(", ")}`)
      .join("\n");
    const monthHeading = applyFont(MONTH_NAMES[month - 1]!, fontMap);

    monthParts.push({
      key: String(month),
      text: template.includes("{entries}")
        ? template.replace(/{month}/g, monthHeading).replace("{entries}", entryLines)
        : `${template.replace(/{month}/g, monthHeading)}\n${entryLines}`,
    });
  }

  const parts: AnchorPart[] = [];
  if (intro) parts.push({ key: "intro", text: intro });
  parts.push(...(monthParts.length > 0 ? monthParts : [{ key: "empty", text: "_Noch keine Geburtstage eingetragen._" }]));
  return parts;
}

/** Splits `part` into `maxLen`-sized pieces at line boundaries — the fallback for a single part too big to fit in one Discord message on its own. Only reached in extreme cases (e.g. one date shared by an enormous number of members). */
function splitOversizedPart(part: string, maxLen: number): string[] {
  const lines = part.split("\n");
  const pieces: string[] = [];
  let current = "";
  for (const line of lines) {
    // A single line longer than maxLen on its own is a last resort — hard-cut it
    // rather than let it break pagination entirely.
    const piece = line.length > maxLen ? line.slice(0, maxLen) : line;
    const candidate = current ? `${current}\n${piece}` : piece;
    if (candidate.length > maxLen && current) {
      pieces.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** One packed Discord-message-worth of anchor content, plus which content keys (see `AnchorPart`) it carries — persisted as `AnchorMessageChunk.months` so the next sync's stability bias can read it back. */
export interface AnchorChunk {
  keys: string[];
  text: string;
}

/**
 * Greedily packs `parts` (see `buildAnchorParts()`) into as few
 * `maxLen`-character chunks as possible, joining consecutive parts with a
 * blank line, so a month never gets split across two messages unless it's
 * too large to fit in one on its own.
 *
 * `previousChunkOf` (key -> chunk index from the *previous* sync, see
 * `syncAnchorMessage()`) biases the packing toward stability: a part is only
 * merged into the chunk currently being built if that chunk is still
 * "unclaimed" (empty, or its first part's previous chunk matches this
 * part's) — so a month that already fits in its existing message stays
 * there, and only the months that actually stop fitting spill forward into
 * later messages. Without this, one added entry in an early month can
 * reshuffle every later month into a different message on every sync, even
 * though nothing about those months changed. Pure function; always returns
 * at least one chunk (possibly empty, on a fresh install with no data).
 */
export function paginateAnchorParts(
  parts: AnchorPart[],
  maxLen: number,
  previousChunkOf: Map<string, number> = new Map(),
): AnchorChunk[] {
  const chunks: AnchorChunk[] = [];
  let currentParts: AnchorPart[] = [];
  let currentGroup: number | undefined;

  const flush = () => {
    if (currentParts.length === 0) return;
    chunks.push({ keys: currentParts.map((p) => p.key), text: currentParts.map((p) => p.text).join("\n\n") });
    currentParts = [];
    currentGroup = undefined;
  };

  for (const rawPart of parts) {
    const pieces =
      rawPart.text.length > maxLen
        ? splitOversizedPart(rawPart.text, maxLen).map((text) => ({ key: rawPart.key, text }))
        : [rawPart];

    for (const part of pieces) {
      const group = previousChunkOf.get(part.key);
      const candidateText = currentParts.length
        ? `${currentParts.map((p) => p.text).join("\n\n")}\n\n${part.text}`
        : part.text;
      const fits = candidateText.length <= maxLen;
      const sameGroup = currentGroup === undefined || group === undefined || group === currentGroup;

      if (currentParts.length > 0 && fits && sameGroup) {
        currentParts.push(part);
      } else {
        flush();
        currentParts.push(part);
        currentGroup = group;
      }
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [{ keys: [], text: "" }];
}

/**
 * Keeps the anchor chain visually contiguous: deletes anything in `channel`
 * that landed between the first and last message of the chain and isn't
 * itself one of `chunkIds` — e.g. a daily announcement that got posted
 * after the last sync, between two already-existing anchor chunks. Only
 * called from `syncAnchorMessage()` once the chain has more than one
 * message. Best-effort — a message it can't delete (e.g. too old) is
 * logged and skipped rather than aborting the rest.
 */
async function closeAnchorChainGaps(channel: TextBasedChannel, chunkIds: string[]): Promise<void> {
  const chunkIdSet = new Set(chunkIds);
  const lastId = chunkIds[chunkIds.length - 1]!;

  let afterId = chunkIds[0]!;
  while (true) {
    const messages = await channel.messages.fetch({ after: afterId, limit: DISCORD_FETCH_PAGE_SIZE });
    if (messages.size === 0) break;

    const sorted = [...messages.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    let reachedLast = false;
    for (const msg of sorted) {
      if (msg.id === lastId || BigInt(msg.id) >= BigInt(lastId)) {
        reachedLast = true;
        break;
      }
      if (!chunkIdSet.has(msg.id)) {
        try {
          await msg.delete();
        } catch (err) {
          logger.warn(`Bot-managed birthday anchor: couldn't delete a message between chunks (${errorMessage(err)}).`);
        }
        await sleep(MESSAGE_DELETE_DELAY_MS);
      }
    }
    afterId = sorted[sorted.length - 1]!.id;
    if (reachedLast) break;
  }
}

/**
 * Posts the bot-managed anchor message for the first time, or edits it in
 * place on every call after — called after every self-registration/dashboard
 * edit and once at startup, so the message always reflects the current
 * birthday list.
 *
 * The list can outgrow a single Discord message (2000-char cap), so it's
 * paginated across a *chain* of messages tracked in
 * `birthday_anchor_messages` (see birthdayAnchorMessagesRepository.ts): each
 * existing message in the chain is edited in place; new messages are
 * appended if the list grew; trailing messages are deleted if it shrank.
 * `paginateAnchorParts()`'s stability bias keeps each month pinned to the
 * chunk it was already in wherever possible, so an edit elsewhere in the
 * list doesn't needlessly reshuffle which message shows which month. Once
 * synced, `closeAnchorChainGaps()` removes anything that landed between
 * chunks since the last sync, so the chain always reads as one unbroken
 * block.
 */
export async function syncAnchorMessage(client: Client): Promise<void> {
  const settings = getSettings();
  if (!settings.birthdayListChannelId) {
    logger.warn("Bot-managed birthday anchor is enabled but no channel is configured yet — skipping.");
    return;
  }

  const existingChunks = getAnchorMessageChunks();
  const previousChunkOf = new Map<string, number>();
  existingChunks.forEach((chunk, idx) => chunk.months.forEach((key) => previousChunkOf.set(key, idx)));

  const parts = buildAnchorParts(
    getAllBirthdaysByDate(),
    settings.birthdayAnchorTemplate,
    settings.birthdayAnchorUseFont ? settings.fontMap : null,
    settings.birthdayAnchorIntro,
  );
  const chunks = paginateAnchorParts(parts, DISCORD_MESSAGE_MAX_LENGTH, previousChunkOf);

  try {
    const channel = await client.channels.fetch(settings.birthdayListChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      logger.warn(
        `Bot-managed birthday anchor: channel ${settings.birthdayListChannelId} isn't a postable text channel.`,
      );
      return;
    }

    const finalChunks: AnchorMessageChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const existing = existingChunks[i];
      if (existing) {
        try {
          const message = await channel.messages.fetch(existing.messageId);
          await message.edit(chunks[i]!.text);
          finalChunks.push({ messageId: existing.messageId, months: chunks[i]!.keys });
          continue;
        } catch (err) {
          logger.warn(
            `Bot-managed birthday anchor: couldn't edit chunk ${i} (${errorMessage(err)}) — posting a new one.`,
          );
        }
      }
      const posted = await channel.send(chunks[i]!.text);
      finalChunks.push({ messageId: posted.id, months: chunks[i]!.keys });
    }

    for (let i = chunks.length; i < existingChunks.length; i++) {
      try {
        const message = await channel.messages.fetch(existingChunks[i]!.messageId);
        await message.delete();
      } catch (err) {
        logger.warn(`Bot-managed birthday anchor: couldn't delete leftover chunk ${i} (${errorMessage(err)}).`);
      }
    }

    setAnchorMessageChunks(finalChunks);

    if (finalChunks.length > 1) {
      await closeAnchorChainGaps(channel, finalChunks.map((c) => c.messageId));
    }
  } catch (err) {
    logger.error(`Failed to sync the bot-managed birthday anchor message: ${errorMessage(err)}`);
  }
}
