// src/services/birthdays.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// storage files (relative to src/)
const BIRTHDAY_FILE = path.resolve(__dirname, "../birthdays.json");
const SETTINGS_DIR = path.resolve(__dirname, "../data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

// ensure data folder exists
if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });

// --- file helpers ---
export function loadBirthdaysFile() {
  if (!fs.existsSync(BIRTHDAY_FILE)) return {};
  return JSON.parse(fs.readFileSync(BIRTHDAY_FILE, "utf8"));
}

export function saveBirthdaysFile(data) {
  fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(data, null, 2), "utf8");
}

// settings (template) helpers
function loadSettingsFile() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaultSettings = {
      // default template: {userMention} will be replaced with <@id>, {everyoneMention} with @everyone or empty, {userNick} with stored name
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

// --- parsing logic ---
// This regex finds each "ღ: DD.MM: ..." block (non-greedy until endline or separator)
const blockRegex = /ღ:\s*(\d{2}\.\d{2})\s*:\s*([^\n⎯]+)/g;

// For splitting multiple people on same block: comma separated
// For extracting single person: supports <@123456>, <@!123456>, or plain @Name (unicode allowed)
const personRegex = /^\s*(<@!?\d+>|@[^,—–-]+?)(?:\s*[—–-]\s*(.+?))?\s*$/u;

/**
 * Parses the whole birthday message text and returns an object:
 * { "DD.MM": [ { mention: "<@123>", userId: "123" | null, name: "human name" | null }, ... ] }
 */
export function parseBirthdayMessage(text) {
  const result = {};
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const date = m[1]; // DD.MM
    const rest = m[2].trim();

    // split by comma but keep commas inside names (unlikely) - simple split
    const people = rest.split(",").map(s => s.trim()).filter(Boolean);

    for (const p of people) {
      const pm = p.match(personRegex);
      if (!pm) {
        // fallback: try to capture any mention-like token and trailing text
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

      // if plain @Name mention (not a real discord mention), keep as-is for display,
      // but userId only if real <@...>
      const userId = extractIdFromMention(mention);

      // Normalize empty names to null
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

// --- helpers used by commands ---
export async function updateBirthdayListFromMessage(client, channelId, messageId) {
  const channel = await client.channels.fetch(channelId);
  const message = await channel.messages.fetch(messageId);
  const parsed = parseBirthdayMessage(message.content);
  saveBirthdaysFile(parsed);
  return parsed;
}

export function getTodaysBirthdaysFromFileAsArray() {
  const birthdays = loadBirthdaysFile();
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const key = `${dd}.${mm}`;

  const arr = (birthdays[key] || []).map(entry => ({
    mention: entry.mention,
    userId: entry.userId,
    name: entry.name
  }));

  return arr;
}

// send greetings according to template
export async function sendBirthdayMessages(client, channelId, birthdaysArray, pingEveryone = true) {
  const channel = await client.channels.fetch(channelId);

  for (const b of birthdaysArray) {
    // template placeholders:
    // {userMention}  -> use actual mention (if plain-text @Name is used, keep as-is)
    // {everyoneMention} -> "@everyone" if pingEveryone true, otherwise ""
    // {userNick} -> prefer stored name, otherwise try to fetch member nickname
    let userMention = b.mention || (b.userId ? `<@${b.userId}>` : null);
    if (!userMention && b.userId) userMention = `<@${b.userId}>`;

    // determine userNick:
    let userNick = b.name || "";
    if ((!userNick || userNick.trim() === "") && b.userId) {
      try {
        const guilds = client.guilds.cache;
        // try to find member across guilds the bot shares - prefer first match
        for (const [, g] of guilds) {
          try {
            const member = await g.members.fetch(b.userId).catch(() => null);
            if (member) {
              userNick = member.displayName || member.user.username;
              break;
            }
          } catch (err) {
            // ignore and continue
          }
        }
      } catch (err) {
        // ignore
      }
    }

    if (!userNick) userNick = b.userId ? `<@${b.userId}>` : (userMention || "Friend");

    const everyoneMention = pingEveryone ? "@everyone" : "";

    const template = getCurrentTemplate();
    const message = template
      .replace(/{userMention}/g, userMention)
      .replace(/{everyoneMention}/g, everyoneMention)
      .replace(/{userNick}/g, userNick);

    await channel.send(message);
  }
}

// settings helpers exposed
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
