// src/services/birthdays.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// storage files
const SETTINGS_DIR = path.resolve(__dirname, "../data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const BIRTHDAY_FILE = path.resolve(SETTINGS_DIR, "birthdays.json");

// ensure data folder exists
if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });

// file helpers
export function loadBirthdaysFile() {
  if (!fs.existsSync(BIRTHDAY_FILE)) return {};
  return JSON.parse(fs.readFileSync(BIRTHDAY_FILE, "utf8"));
}

export function saveBirthdaysFile(data) {
  fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(data, null, 2), "utf8");
}

// settings helpers
function loadSettingsFile() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaultSettings = {
      birthdayTemplate: "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}"
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), "utf8");
    return defaultSettings;
  }
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
}

function saveSettingsFile(obj) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), "utf8");
}

// parsing logic
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
      // Fetch the member — includes user info
      member = await guild.members.fetch(id);
    } catch {
      // Member not found in this guild (left, kicked, or invalid)
      member = null;
    }

    fetchedMembers.set(id, member);

    await sleep(120); // protect from rate-limits
  }

  for (const [date, entries] of Object.entries(parsed)) {
    out[date] = [];

    for (const entry of entries) {
      const member = fetchedMembers.get(entry.userId);
      let name = entry.name;

      if (member) {
        name = member.displayName
          || member.user.globalName
          || member.user.username;
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

// update birthdays from message
export async function updateBirthdayListFromMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId);
  const message = await channel.messages.fetch(messageId);

  const parsed = parseBirthdayMessage(message.content);
  const resolved = await resolveParsedBirthdaysWithDiscord(client, parsed, channel.guild.id);

  saveBirthdaysFile(resolved);
  return resolved;
}

// get todays birthdays
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

// 1) Build the finished birthday message (no sending)
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

// 2) Sends the built messages for all birthdays
export async function sendBirthdayMessages(client, channelId, birthdaysArray, pingEveryone = true) {
  const channel = await client.channels.fetch(channelId);

  for (const b of birthdaysArray) {
    const message = buildBirthdayMessage(b, pingEveryone);
    await channel.send(message);
  }
}

// template helpers
export function getCurrentTemplate() {
  const s = loadSettingsFile();
  return s.birthdayTemplate || "Today we celebrate {userMention}! {everyoneMention} say gratulate {userNick}";
}

export function setCurrentTemplate(newTemplate) {
  const s = loadSettingsFile();
  s.birthdayTemplate = newTemplate;
  saveSettingsFile(s);
  return s;
}
