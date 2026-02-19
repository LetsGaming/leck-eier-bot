import logger from "../utils/logger.js";
import {
  loadDataFile,
  saveToFile,
  getDataFilePath,
  ensureDataDirectoryExists,
} from "../utils/utils.js";

ensureDataDirectoryExists();

const SETTINGS_FILE = getDataFilePath("settings.json");
const BIRTHDAYS_FILE = getDataFilePath("birthdays.json");

export function loadBirthdaysFile() {
  try {
    return loadDataFile("birthdays.json");
  } catch {
    return {};
  }
}

export function saveBirthdaysFile(data) {
  saveToFile(BIRTHDAYS_FILE, data);
}

function loadSettingsFile() {
  try {
    return loadDataFile("settings.json");
  } catch {
    const defaultSettings = {
      birthdayTemplate:
        "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}",
    };
    saveToFile(SETTINGS_FILE, defaultSettings);
    return defaultSettings;
  }
}

function saveSettingsFile(obj) {
  saveToFile(SETTINGS_FILE, obj);
}

const blockRegex = /ღ:\s*(\d{2}\.\d{2})\s*:\s*([^\n⎯]+)/g;
const personRegex = /^\s*(<@!?\d+>|@[^,—–-]+?)(?:\s*[—–-]\s*(.+?))?\s*$/u;

export function parseBirthdayMessage(text) {
  const result = {};
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const date = m[1];
    const rest = m[2].trim();
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
              .replace(/^[^\w\u00C0-\u017F]+/, "")
              .trim() || null;
          result[date] = result[date] || [];
          result[date].push({
            mention,
            userId: extractIdFromMention(mention),
            name,
          });
        }
        continue;
      }
      const mention = pm[1].trim();
      let name = pm[2] ? pm[2].trim() : null;
      const userId = extractIdFromMention(mention);
      if (name === "") name = null;
      result[date] = result[date] || [];
      result[date].push({ mention, userId, name });
    }
  }
  return result;
}

function extractIdFromMention(mention) {
  const m = mention.match(/^<@!?(\d+)>$/);
  return m ? m[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveParsedBirthdaysWithDiscord(
  client,
  parsed,
  guildId,
) {
  const out = {};
  const allIds = new Set();
  for (const entries of Object.values(parsed)) {
    for (const e of entries) {
      if (e.userId) allIds.add(e.userId);
    }
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error(`Guild ${guildId} not found`);
  const fetchedMembers = new Map();

  for (const id of allIds) {
    let member = null;
    try {
      member = await guild.members.fetch(id);
    } catch {
      member = null;
    }
    fetchedMembers.set(id, member);
    await sleep(120);
  }

  for (const [date, entries] of Object.entries(parsed)) {
    out[date] = [];
    for (const entry of entries) {
      const member = fetchedMembers.get(entry.userId);
      let name = entry.name;
      if (member) {
        name =
          member.displayName || member.user.globalName || member.user.username;
      }
      out[date].push({ ...entry, name, discordMember: member });
    }
  }
  return out;
}

export async function updateBirthdayListFromMessage(
  client,
  channelId,
  messageId,
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  const anchorMessage = await channel.messages.fetch(messageId);
  const authorId = anchorMessage.author.id;
  const subsequentMessages = await channel.messages.fetch({
    after: messageId,
    limit: 50,
  });

  let fullContent = anchorMessage.content;
  const sortedMessages = [...subsequentMessages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp,
  );

  for (const msg of sortedMessages) {
    // Only continue the chain if the message contains the list identifier
    if (msg.author.id === authorId && msg.content.includes("ღ:")) {
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
  saveBirthdaysFile(resolved);
  return resolved;
}

export function getTodaysBirthdaysFromFileAsArray() {
  const birthdays = loadBirthdaysFile();
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const key = `${dd}.${mm}`;
  return (birthdays[key] || []).map((entry) => ({
    mention: entry.mention,
    userId: entry.userId,
    name: entry.name,
  }));
}

export function getNextBirthdayFromFile() {
  const birthdays = loadBirthdaysFile();
  const now = new Date();
  const currentYear = now.getFullYear();
  const allDates = Object.entries(birthdays).map(([key, entries]) => {
    const [dd, mm] = key.split(".").map((x) => parseInt(x, 10));
    let date = new Date(currentYear, mm - 1, dd);
    if (date < now) {
      date = new Date(currentYear + 1, mm - 1, dd);
    }
    return { date, entries };
  });
  allDates.sort((a, b) => a.date - b.date);
  return allDates.length > 0 ? allDates[0] : null;
}

export function buildBirthdayMessage(b, pingEveryone = true) {
  const userMention = b.mention || (b.userId ? `<@${b.userId}>` : null);
  const userNick = b.name || (b.userId ? `<@${b.userId}>` : "Friend");
  const everyoneMention = pingEveryone ? "@everyone" : "";
  const template = getCurrentTemplate();
  return template
    .replace(/{userMention}/g, userMention)
    .replace(/{everyoneMention}/g, everyoneMention)
    .replace(/{userNick}/g, userNick);
}

export async function sendBirthdayMessages(
  client,
  channelId,
  birthdaysArray,
  pingEveryone = true,
) {
  const channel = await client.channels.fetch(channelId);
  const settings = loadSettingsFile();
  let firstBirthdayMessageId = settings.firstBirthdayMessageId || null;

  for (const b of birthdaysArray) {
    const msgContent = buildBirthdayMessage(b, pingEveryone);
    const sentMsg = await channel.send(msgContent);
    if (!firstBirthdayMessageId) {
      firstBirthdayMessageId = sentMsg.id;
      settings.firstBirthdayMessageId = firstBirthdayMessageId;
      saveSettingsFile(settings);
    }
  }
}

export async function deleteBirthdayMessages(
  client,
  channelId,
  birthdayListMessageId,
) {
  const settings = loadSettingsFile();
  const firstId = settings.firstBirthdayMessageId;
  if (!firstId) return 0;

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) return 0;

  let deletedCount = 0;
  let reachedFirst = false;
  let lastMessageId = undefined;
  const seen = new Set();

  while (!reachedFirst) {
    const messages = await channel.messages.fetch({
      limit: 100,
      before: lastMessageId,
    });
    if (messages.size === 0) break;
    if (messages.first() && seen.has(messages.first().id)) break;

    for (const msg of messages.values()) {
      seen.add(msg.id);
      if (msg.id === firstId) {
        if (msg.id !== birthdayListMessageId) {
          try {
            await msg.delete();
            deletedCount++;
          } catch (err) {
            logger.warn(`Delete fail: ${msg.id}`, err);
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
        if (err.code !== 50034) logger.warn(`Delete fail: ${msg.id}`, err);
      }
      await sleep(250);
    }
    lastMessageId = messages.last().id;
  }
  if (reachedFirst) {
    delete settings.firstBirthdayMessageId;
    saveSettingsFile(settings);
  }
  return deletedCount;
}

export function getCurrentTemplate() {
  const s = loadSettingsFile();
  return (
    s.birthdayTemplate ||
    "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}"
  );
}

export function setCurrentTemplate(newTemplate) {
  const s = loadSettingsFile();
  s.birthdayTemplate = newTemplate;
  saveSettingsFile(s);
  return s;
}
