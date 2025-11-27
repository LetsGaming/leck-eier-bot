// src/services/birthdays.js

import {
  loadDataFile,
  saveToFile,
  getDataFilePath,
  ensureDataDirectoryExists
} from "../utils/utils.js";

// Make sure data/ folder exists
ensureDataDirectoryExists();

// File paths
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

// Settings Helpers
function loadSettingsFile() {
  try {
    return loadDataFile("settings.json");
  } catch {
    const defaultSettings = {
      birthdayTemplate:
        "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}"
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
    const people = rest.split(",").map(s => s.trim()).filter(Boolean);

    for (const p of people) {
      const pm = p.match(personRegex);
      if (!pm) {
        const fallback = p.match(/(<@!?\d+>)|(@\S+)/);
        if (fallback) {
          const mention = fallback[0];
          const name = p.replace(mention, "").replace(/^[^\w\u00C0-\u017F]+/, "").trim() || null;
          result[date] = result[date] || [];
          result[date].push({ mention, userId: extractIdFromMention(mention), name });
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function resolveParsedBirthdaysWithDiscord(client, parsed, guildId) {
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
      member = null; // left / kicked / invalid ID
    }

    fetchedMembers.set(id, member);

    await sleep(120); // rate-limit protection
  }

  for (const [date, entries] of Object.entries(parsed)) {
    out[date] = [];

    for (const entry of entries) {
      const member = fetchedMembers.get(entry.userId);
      let name = entry.name;

      if (member) {
        name =
          member.displayName ||
          member.user.globalName ||
          member.user.username;
      }

      out[date].push({
        ...entry,
        name,
        discordMember: member
      });
    }
  }

  return out;
}

export async function updateBirthdayListFromMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId);
  const message = await channel.messages.fetch(messageId);

  const parsed = parseBirthdayMessage(message.content);
  const resolved = await resolveParsedBirthdaysWithDiscord(
    client,
    parsed,
    channel.guild.id
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

  return (birthdays[key] || []).map(entry => ({
    mention: entry.mention,
    userId: entry.userId,
    name: entry.name
  }));
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

export async function sendBirthdayMessages(client, channelId, birthdaysArray, pingEveryone = true) {
  const channel = await client.channels.fetch(channelId);

  let firstMessageId = null;

  for (const b of birthdaysArray) {
    const msgContent = buildBirthdayMessage(b, pingEveryone);
    const sentMsg = await channel.send(msgContent);

    if (!firstMessageId) {
      firstMessageId = sentMsg.id;

      // Save into settings.json
      const settings = loadSettingsFile();
      settings.lastBirthdayMessageId = sentMsg.id;
      saveSettingsFile(settings);
    }
  }
}

import { loadSettings, saveSettings } from "./utils.js";

/**
 * Deletes all messages in a channel up to (and including) the first birthday message.
 * After deletion, clears firstBirthdayMessageId from settings.json.
 */
export async function deleteBirthdayMessages(client, channelId) {
  const settings = loadSettings();
  const firstId = settings.firstBirthdayMessageId;

  if (!firstId) {
    return;
  }

  const channel = await client.channels.fetch(channelId);

  let reachedFirst = false;
  let lastMessageId = undefined;

  while (!reachedFirst) {
    // Fetch messages in batches of 100 (Discord limit)
    const messages = await channel.messages.fetch({ limit: 100, before: lastMessageId });

    if (messages.size === 0) {
      console.log("Reached end of channel history without finding the message.");
      break;
    }

    for (const msg of messages.values()) {
      // Check if this is the first birthday message
      if (msg.id === firstId) {
        reachedFirst = true;
      }

      // Delete the message
      try {
        await msg.delete();
      } catch (err) {
        console.warn(`Failed to delete message ${msg.id}:`, err);
      }
    }

    // Prepare for next batch
    lastMessageId = messages.last().id;
  }

  // Clear ID from settings
  delete settings.firstBirthdayMessageId;
  saveSettings(settings);

  console.log("All birthday messages deleted and settings cleared.");
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
