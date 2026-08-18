import type { Client, Collection, GuildMember, Message } from "discord.js";
import logger, { errorMessage } from "../utils/logger.js";
import {
  getAllBirthdaysByDate,
  getBirthdaysForDate,
  replaceAllBirthdays,
} from "../db/birthdaysRepository.js";
import { getSettings, updateSettings } from "../db/settingsRepository.js";
import type { BirthdayEntry, BirthdaysByDate } from "../types.js";
import {
  BIRTHDAY_LIST_MARKER,
  BIRTHDAY_LIST_SCAN_LIMIT,
  DISCORD_ERROR_CODE_TOO_OLD_TO_DELETE,
  DISCORD_FETCH_PAGE_SIZE,
  MEMBER_FETCH_DELAY_MS,
  MESSAGE_DELETE_DELAY_MS,
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
          });
        }
        continue;
      }
      const mention = pm[1]!.trim();
      let name: string | null = pm[2] ? pm[2].trim() : null;
      const userId = extractIdFromMention(mention);
      if (name === "") name = null;
      result[date] = result[date] || [];
      result[date]!.push({ mention, userId, name });
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

export function getNextBirthday(): { date: Date; entries: BirthdayEntry[] } | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const allDates = Object.entries(getAllBirthdaysByDate()).map(([key, entries]) => {
    const [dd, mm] = key.split(".").map((x) => parseInt(x, 10));
    let date = new Date(currentYear, mm! - 1, dd);
    if (date < now) {
      date = new Date(currentYear + 1, mm! - 1, dd);
    }
    return { date, entries };
  });
  allDates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return allDates.length > 0 ? allDates[0]! : null;
}

export function buildBirthdayMessage(
  b: BirthdayEntry,
  pingEveryone = true,
): string {
  const userMention = b.mention || (b.userId ? `<@${b.userId}>` : "");
  const userNick = b.name || (b.userId ? `<@${b.userId}>` : "Friend");
  const everyoneMention = pingEveryone ? "@everyone" : "";
  const template = getCurrentTemplate();
  return template
    .replace(/{userMention}/g, userMention)
    .replace(/{everyoneMention}/g, everyoneMention)
    .replace(/{userNick}/g, userNick);
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
