import type { Client, Collection, GuildMember, Message } from "discord.js";
import logger, { errorMessage } from "../utils/logger.js";
import {
  getAllBirthdaysByDate,
  getBirthdaysForDate,
  replaceAllBirthdays,
} from "../db/birthdaysRepository.js";
import { getSettings, updateSettings } from "../db/settingsRepository.js";
import { getAnchorMessageIds, setAnchorMessageIds } from "../db/birthdayAnchorMessagesRepository.js";
import { applyFont } from "../utils/font.js";
import type { BirthdayEntry, BirthdaysByDate } from "../types.js";
import {
  BIRTHDAY_LIST_MARKER,
  BIRTHDAY_LIST_SCAN_LIMIT,
  DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE,
  DISCORD_FETCH_PAGE_SIZE,
  DISCORD_MESSAGE_MAX_LENGTH,
  MEMBER_FETCH_DELAY_MS,
  MESSAGE_DELETE_DELAY_MS,
  SELF_BIRTHDAY_DATE_REGEX,
} from "../constants.js";

const blockRegex = new RegExp(`${BIRTHDAY_LIST_MARKER}\\s*(\\d{2}\\.\\d{2})\\s*:\\s*([^\\n⎯]+)`, "g");
const personRegex = /^\s*(<@!?\d+>|@[^,—–-]+?)(?:\s*[—–-]\s*(.+?))?\s*$/u;

export function parseBirthdayMessage(text: string): BirthdaysByDate {
  const result: BirthdaysByDate = {};
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(text)) !== null) {
    const date = m[1]!;
    const rest = m[2]!.trim();
    const people = rest
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const p of people) {
      const pm = p.match(personRegex);
      if (!pm) {
        const fallback = p.match(/(<@!?\d+>)|(@\S+)/);
        if (fallback) {
          const mention = fallback[0];
          const name =
            p
              .replace(mention, "")
              .replace(/^[^\wÀ-ſ]+/, "")
              .trim() || null;
          result[date] = result[date] || [];
          result[date]!.push({
            mention,
            userId: extractIdFromMention(mention),
            name,
            source: "list",
          });
        }
        continue;
      }
      const mention = pm[1]!.trim();
      let name: string | null = pm[2] ? pm[2].trim() : null;
      const userId = extractIdFromMention(mention);
      if (name === "") name = null;
      result[date] = result[date] || [];
      result[date]!.push({ mention, userId, name, source: "list" });
    }
  }
  return result;
}

function extractIdFromMention(mention: string): string | null {
  const m = mention.match(/^<@!?(\d+)>$/);
  return m ? m[1]! : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveParsedBirthdaysWithDiscord(
  client: Client,
  parsed: BirthdaysByDate,
  guildId: string,
): Promise<BirthdaysByDate> {
  const out: BirthdaysByDate = {};
  const allIds = new Set<string>();
  for (const entries of Object.values(parsed)) {
    for (const e of entries) {
      if (e.userId) allIds.add(e.userId);
    }
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error(`Guild ${guildId} not found`);
  const fetchedMembers = new Map<string, GuildMember | null>();

  for (const id of allIds) {
    let member: GuildMember | null = null;
    try {
      member = await guild.members.fetch(id);
    } catch {
      member = null;
    }
    fetchedMembers.set(id, member);
    await sleep(MEMBER_FETCH_DELAY_MS);
  }

  for (const [date, entries] of Object.entries(parsed)) {
    out[date] = [];
    for (const entry of entries) {
      const member = entry.userId ? fetchedMembers.get(entry.userId) ?? null : null;
      const name = member
        ? member.displayName || member.user.globalName || member.user.username
        : entry.name;
      out[date]!.push({ ...entry, name });
    }
  }
  return out;
}

export async function updateBirthdayListFromMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<BirthdaysByDate | undefined> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return;

  const anchorMessage = await channel.messages.fetch(messageId);
  const authorId = anchorMessage.author.id;
  const subsequentMessages = await channel.messages.fetch({
    after: messageId,
    limit: BIRTHDAY_LIST_SCAN_LIMIT,
  });

  let fullContent = anchorMessage.content;
  const sortedMessages = [...subsequentMessages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp,
  );

  for (const msg of sortedMessages) {
    // Only continue the chain if the message contains the list identifier
    if (msg.author.id === authorId && msg.content.includes(BIRTHDAY_LIST_MARKER)) {
      fullContent += "\n" + msg.content;
    } else if (msg.author.id === authorId) {
      // Stop as soon as the list author sends a message that isn't part of the list
      break;
    }
  }

  const parsed = parseBirthdayMessage(fullContent);
  const resolved = await resolveParsedBirthdaysWithDiscord(
    client,
    parsed,
    channel.guild.id,
  );
  replaceAllBirthdays(resolved);
  return resolved;
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
 * entirely — see the API route in src/web/routes/birthdaysReadonly.ts.
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

export async function deleteBirthdayMessages(
  client: Client,
  channelId: string,
  birthdayListMessageId: string,
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
        if (msg.id !== birthdayListMessageId) {
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
      if (msg.id === birthdayListMessageId) continue;
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

export function getCurrentTemplate(): string {
  return getSettings().birthdayTemplate;
}

export function setCurrentTemplate(newTemplate: string): void {
  updateSettings({ birthdayTemplate: newTemplate });
}

/**
 * Channel/message id of the manually-maintained birthday announcement list,
 * configured via the dashboard. Returns null on a fresh install until an
 * admin sets it, so every call site must handle the unconfigured case
 * explicitly rather than assuming it's always present.
 */
export function getBirthdayListLocation(): { channelId: string; messageId: string } | null {
  const { birthdayListChannelId, birthdayListMessageId } = getSettings();
  if (!birthdayListChannelId || !birthdayListMessageId) return null;
  return { channelId: birthdayListChannelId, messageId: birthdayListMessageId };
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
 * just a member typing their birthday, not the structured
 * `BIRTHDAY_LIST_MARKER` format the admin-maintained list uses.
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
    const viaText = via === "command" ? "via `/setmybirthday`" : "by posting in the birthday channel";
    await channel.send(
      `🎂 ${entry.mention} (${entry.name ?? "unknown"}) registered their birthday for **${entry.dateKey}** ${viaText}.`,
    );
  } catch (err) {
    logger.warn(`Failed to post birthday registration notice: ${errorMessage(err)}`);
  }
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Builds the bot-managed anchor message's content as an ordered list of
 * independent parts — the intro (if any) followed by one block per calendar
 * month that has entries — instead of one joined string, so
 * `paginateAnchorParts()` below can pack them across multiple Discord
 * messages without ever splitting in the middle of a month. Each month is
 * rendered through `template`'s `{month}`/`{entries}` placeholders;
 * `{month}` is passed through `applyFont()` first, `{entries}` deliberately
 * never is, so mentions and dates always render literally no matter what
 * font is configured. `intro` is also always plain text, never styled.
 * Pure function of its arguments — never touches Discord itself; see
 * `syncAnchorMessage()` for that part.
 */
export function buildAnchorParts(
  entries: BirthdaysByDate,
  template: string,
  fontMap: string | null,
  intro: string | null,
): string[] {
  const byMonth = new Map<number, Array<{ dateKey: string; day: number; list: BirthdayEntry[] }>>();
  for (const [dateKey, list] of Object.entries(entries)) {
    const [dd, mm] = dateKey.split(".").map((x) => parseInt(x, 10));
    const bucket = byMonth.get(mm!) ?? [];
    bucket.push({ dateKey, day: dd!, list });
    byMonth.set(mm!, bucket);
  }

  const blocks: string[] = [];
  for (let month = 1; month <= 12; month++) {
    const days = byMonth.get(month);
    if (!days || days.length === 0) continue;
    days.sort((a, b) => a.day - b.day);

    const entryLines = days
      .map((d) => `${BIRTHDAY_LIST_MARKER} ${d.dateKey}: ${d.list.map((e) => e.mention).join(", ")}`)
      .join("\n");
    const monthHeading = applyFont(MONTH_NAMES[month - 1]!, fontMap);

    blocks.push(
      template.includes("{entries}")
        ? template.replace(/{month}/g, monthHeading).replace("{entries}", entryLines)
        : `${template.replace(/{month}/g, monthHeading)}\n${entryLines}`,
    );
  }

  if (blocks.length === 0) blocks.push("_No birthdays registered yet._");
  return intro ? [intro, ...blocks] : blocks;
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

/**
 * Greedily packs `parts` (see `buildAnchorParts()`) into as few
 * `maxLen`-character chunks as possible, joining consecutive parts with a
 * blank line — so the intro rides along with as many month blocks as fit on
 * the first message, and a month never gets split across two messages
 * unless it's too large to fit in one on its own. Pure function; always
 * returns at least one chunk.
 */
export function paginateAnchorParts(parts: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const rawPart of parts) {
    const pieces = rawPart.length > maxLen ? splitOversizedPart(rawPart, maxLen) : [rawPart];
    for (const part of pieces) {
      const candidate = current ? `${current}\n\n${part}` : part;
      if (candidate.length > maxLen && current) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

/**
 * Posts the bot-managed anchor message for the first time, or edits it in
 * place on every call after — called after every self-registration and
 * once at startup, so the message always reflects the current birthday
 * list. A no-op unless `birthdayBotManagesAnchor` is on, so call sites don't
 * need to duplicate that check.
 *
 * The list can outgrow a single Discord message (2000-char cap), so it's
 * paginated across a *chain* of messages tracked in
 * `birthday_anchor_messages` (see birthdayAnchorMessagesRepository.ts):
 * each existing message in the chain is edited in place; new messages are
 * appended if the list grew; trailing messages are deleted if it shrank.
 */
export async function syncAnchorMessage(client: Client): Promise<void> {
  const settings = getSettings();
  if (!settings.birthdayBotManagesAnchor) return;
  if (!settings.birthdayListChannelId) {
    logger.warn("Bot-managed birthday anchor is enabled but no channel is configured yet — skipping.");
    return;
  }

  const parts = buildAnchorParts(
    getAllBirthdaysByDate(),
    settings.birthdayAnchorTemplate,
    settings.birthdayAnchorUseFont ? settings.fontMap : null,
    settings.birthdayAnchorIntro,
  );
  const chunks = paginateAnchorParts(parts, DISCORD_MESSAGE_MAX_LENGTH);

  try {
    const channel = await client.channels.fetch(settings.birthdayListChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      logger.warn(
        `Bot-managed birthday anchor: channel ${settings.birthdayListChannelId} isn't a postable text channel.`,
      );
      return;
    }

    const existingIds = getAnchorMessageIds();
    const finalIds: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const existingId = existingIds[i];
      if (existingId) {
        try {
          const message = await channel.messages.fetch(existingId);
          await message.edit(chunks[i]!);
          finalIds.push(existingId);
          continue;
        } catch (err) {
          logger.warn(
            `Bot-managed birthday anchor: couldn't edit chunk ${i} (${errorMessage(err)}) — posting a new one.`,
          );
        }
      }
      const posted = await channel.send(chunks[i]!);
      finalIds.push(posted.id);
    }

    for (let i = chunks.length; i < existingIds.length; i++) {
      try {
        const message = await channel.messages.fetch(existingIds[i]!);
        await message.delete();
      } catch (err) {
        logger.warn(`Bot-managed birthday anchor: couldn't delete leftover chunk ${i} (${errorMessage(err)}).`);
      }
    }

    setAnchorMessageIds(finalIds);
    // Kept in sync purely for the dashboard's "Regenerate" button gating and
    // any legacy reader — the chain in birthday_anchor_messages is the real
    // source of truth for editing/deleting.
    updateSettings({ birthdayListMessageId: finalIds[0] ?? null });
  } catch (err) {
    logger.error(`Failed to sync the bot-managed birthday anchor message: ${errorMessage(err)}`);
  }
}
