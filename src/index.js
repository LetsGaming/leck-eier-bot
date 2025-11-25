import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags
} from "discord.js";
import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync } from "fs";
import cron from "node-cron";

import { loadBirthdaysFile, sendBirthdayMessages, updateBirthdayListFromMessage } from "./services/birthdays.js";
import { loadConfig } from "./utils/utils.js";

const config = loadConfig();

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();

// Recursively load command files
function getCommandFiles(dir) {
  let files = [];

  for (const file of readdirSync(dir)) {
    const full = path.join(dir, file);
    if (statSync(full).isDirectory()) {
      files = files.concat(getCommandFiles(full));
    } else if (file.endsWith(".js")) {
      files.push(full);
    }
  }

  return files;
}

async function loadCommands() {
  const commandFiles = getCommandFiles(path.join(__dirname, "commands"));

  for (const file of commandFiles) {
    const command = await import(path.resolve(file));

    const enabled = config.commands?.[command.data.name]?.enabled ?? true;

    if (enabled && command.data && command.execute) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`Skipping ${file}, missing data/execute or disabled`);
    }
  }
}

async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const commands = [...client.commands.map(cmd => cmd.data.toJSON())];

  console.log("Registering global slash commands...");

  await rest.put(
    Routes.applicationCommands(config.clientId), 
    { body: commands }
  );

  console.log("✔ Registered.");
}

// Midnight birthday cron
cron.schedule("0 0 * * *", async () => {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");

  const dateStr = `${dd}.${mm}`;
  const birthdays = loadBirthdaysFile();

  const birthdaysToday = birthdays[dateStr] || [];

  if (birthdaysToday && birthdaysToday.length > 0) {
    await sendBirthdayMessages(
      client,
      config.birthdayListChannelId,
      birthdaysToday
    );
  }
});

// Auto-update when message is edited
client.on("messageUpdate", async (oldMsg, newMsg) => {
  if (newMsg.id === config.birthdayListMessageId) {
    console.log("Birthday list updated (edit detected)");
    await updateBirthdayListFromMessage(client, newMsg.channelId, newMsg.id);
  }
});

// Slash command handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(err);

    const errorMsg = {
      content: "❌ Error executing this command.",
      flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
});

(async () => {
  await loadCommands();
  await registerGlobalCommands();

  client.once("clientReady", async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    await updateBirthdayListFromMessage(client, config.birthdayListChannelId, config.birthdayListMessageId);
  });

  await client.login(config.token);
})();
