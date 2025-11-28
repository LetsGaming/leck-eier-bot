import {
  loadDataFile,
  saveToFile,
  getDataFilePath,
  ensureDataDirectoryExists,
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
  guildId
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
          member.displayName || member.user.globalName || member.user.username;
      }

      out[date].push({
        ...entry,
        name,
        discordMember: member,
      });
    }
  }

  return out;
}

export async function updateBirthdayListFromMessage(
  client,
  channelId,
  messageId
) {
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

  return (birthdays[key] || []).map((entry) => ({
    mention: entry.mention,
    userId: entry.userId,
    name: entry.name,
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

export async function sendBirthdayMessages(
  client,
  channelId,
  birthdaysArray,
  pingEveryone = true
) {
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

/**
 * Deletes all birthday messages in a channel down to (and including)
 * the firstBirthdayMessageId stored in settings.json.
 * Ensures the birthday list message is NEVER deleted.
 *
 * @param {import("discord.js").Client} client
 * @param {string} channelId
 * @param {string} birthdayListMessageId
 * @returns {Promise<number>} deletedCount
 */
export async function deleteBirthdayMessages(client, channelId, birthdayListMessageId) {
  const settings = loadSettingsFile();
  const firstId = settings.firstBirthdayMessageId;

  if (!firstId) {
    console.warn("No firstBirthdayMessageId set. Nothing to delete.");
    return 0;
  }

  const channel = await client.channels.fetch(channelId);

  if (!channel || !channel.isTextBased()) {
    console.warn(`Channel ${channelId} not found or not text-based.`);
    return 0;
  }

  let deletedCount = 0;
  let reachedFirst = false;
  let lastMessageId = undefined;
  const seen = new Set(); // protect against infinite loops

  while (!reachedFirst) {
    const messages = await channel.messages.fetch({
      limit: 100,
      before: lastMessageId
    });

    if (messages.size === 0) {
      console.warn("Reached end of channel history without finding firstBirthdayMessageId.");
      break;
    }

    // Detect repeated fetches (Discord sometimes returns same messages twice)
    const firstMsgOfBatch = messages.first();
    if (firstMsgOfBatch && seen.has(firstMsgOfBatch.id)) {
      console.warn("Encountered repeated batch. Breaking to avoid infinite loop.");
      break;
    }
    for (const m of messages.values()) seen.add(m.id);

    for (const msg of messages.values()) {
      // If reached the target, delete it and stop further processing
      const isFirstMessage = msg.id === firstId;

      // Always delete the first message by design
      if (isFirstMessage) {
        if (msg.id !== birthdayListMessageId) {
          try {
            await msg.delete();
            deletedCount++;
          } catch (err) {
            console.warn(`Failed to delete first birthday message ${msg.id}:`, err);
          }
        } else {
          console.error("ERROR: firstBirthdayMessageId == birthdayListMessageId. This should NEVER happen.");
        }

        reachedFirst = true;
        break;
      }

      // Skip the list message for safety
      if (msg.id === birthdayListMessageId) {
        continue;
      }

      // Try deleting other messages
      try {
        await msg.delete();
        deletedCount++;
      } catch (err) {
        // Common error: older than 14 days → cannot be deleted
        if (err.code === 50034) {
          console.warn(`Message ${msg.id} too old to delete (older than 14 days). Skipping.`);
        } else {
          console.warn(`Failed to delete message ${msg.id}:`, err);
        }
      }

      // Rate-limit friendliness: 250ms is very safe for large batch deletes
      await sleep(250);
    }

    // Prepare for next batch
    lastMessageId = messages.last().id;
  }

  // Clear stored ID only if we found & processed it
  if (reachedFirst) {
    delete settings.firstBirthdayMessageId;
    saveSettingsFile(settings);
    console.log("Birthday messages deleted and settings cleared.");
  } else {
    console.warn("Did NOT delete firstBirthdayMessageId because the message was never found.");
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
