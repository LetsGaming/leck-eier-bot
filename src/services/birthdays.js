import fs from "fs";
import { loadConfig } from "../utils/utils.js";

const config =loadConfig();

const BIRTHDAY_FILE = "../birthdays.json";

export function loadBirthdays() {
  if (!fs.existsSync(BIRTHDAY_FILE)) return {};
  return JSON.parse(fs.readFileSync(BIRTHDAY_FILE, "utf8"));
}

export function saveBirthdays(data) {
  fs.writeFileSync(BIRTHDAY_FILE, JSON.stringify(data, null, 2));
}

// Parse the formatted birthday list message
export function parseBirthdayMessage(text) {
  const result = {};
  const entryRegex = /ღ:\s*(\d{2}\.\d{2})\s*:\s*([^⎯\n]+)/g;

  let match;
  while ((match = entryRegex.exec(text)) !== null) {
    const date = match[1];
    const rest = match[2].trim();
    const people = rest.split(",").map(p => p.trim());

    for (const person of people) {
      const m = person.match(/(<@!?[\d]+>|@\S+)(?:\s*—\s*(.*))?/);
      if (!m) continue;

      const mention = m[1];
      const name = m[2] || null;

      if (!result[date]) result[date] = [];
      result[date].push({ mention, name });
    }
  }

  return result;
}

export async function updateBirthdayList(client) {
  const channel = await client.channels.fetch(config.birthdayListChannelId);
  const message = await channel.messages.fetch(config.birthdayListMessageId);

  const parsed = parseBirthdayMessage(message.content);
  saveBirthdays(parsed);

  return parsed;
}

export async function sendBirthdayGreeting(client, mention, date) {
  const channel = await client.channels.fetch(config.birthdayListChannelId);
  await channel.send(`Happy birthday ${mention}! (${date})`);
}
