import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from "discord.js";
import cron from "node-cron";
import logger from "./utils/logger.js";
import { loadConfig, isConfigGuild } from "./utils/utils.js";

// Loaders & Handlers
import { loadCommands } from "./loaders/commandLoader.js";
import registerMemberEvents from "./events/memberEvents.js";
import registerBirthdayWatcher from "./events/birthdayWatcher.js";
import { initMemberCache } from "./services/memberCache.js";
import {
  deleteBirthdayMessages,
  loadBirthdaysFile,
  sendBirthdayMessages,
  updateBirthdayListFromMessage,
} from "./services/birthdays.js";

const config = loadConfig();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// 1. Cron Jobs
cron.schedule("0 0 * * *", async () => {
  await deleteBirthdayMessages(
    client,
    config.birthdayListChannelId,
    config.birthdayListMessageId,
  );
  const birthdays = loadBirthdaysFile();
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}`;

  if (birthdays[dateStr]?.length > 0) {
    await sendBirthdayMessages(
      client,
      config.birthdayListChannelId,
      birthdays[dateStr],
    );
  }
});

// 2. Interaction Handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    if (!isConfigGuild(interaction)) {
      return await interaction.reply({
        embeds: [createErrorEmbed("Only for configured guild.")],
        flags: MessageFlags.Ephemeral,
      });
    }
    await cmd.execute(interaction);
  } catch (err) {
    logger.error(err);
    const msg = {
      embeds: [createErrorEmbed("Command error.")],
      flags: MessageFlags.Ephemeral,
    };
    interaction.replied || interaction.deferred
      ? await interaction.followUp(msg)
      : await interaction.reply(msg);
  }
});

// 3. Initialization Logic
(async () => {
  await loadCommands(client, config);

  // Slash Registration
  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(config.clientId), {
    body: [...client.commands.map((c) => c.data.toJSON())],
  });

  // Event Modules
  registerMemberEvents(client);
  registerBirthdayWatcher(client, config);

  client.once("clientReady", async () => {
    logger.info(`Bot logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.get(config.guildId);
    if (guild) await initMemberCache(guild);

    await updateBirthdayListFromMessage(
      client,
      config.birthdayListChannelId,
      config.birthdayListMessageId,
    );
  });

  await client.login(config.token);
})();
