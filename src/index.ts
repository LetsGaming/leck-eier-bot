import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import cron, { type ScheduledTask } from "node-cron";
import logger, { errorMessage } from "./utils/logger.js";
import { loadConfig } from "./config/index.js";
import { isAdmin, isConfigGuild, isOwner } from "./utils/utils.js";
import { createNoAdminEmbed } from "./utils/embedUtils.js";
import { CommandPermission, DISCORD_API_VERSION } from "./constants.js";

// Loaders & Handlers
import { loadCommands } from "./loaders/commandLoader.js";
import registerMemberEvents from "./events/memberEvents.js";
import registerBirthdayWatcher from "./events/birthdayWatcher.js";
import registerReactionRoleEvents from "./events/reactionRoleEvents.js";
import registerRegisterWatcher from "./events/registerWatcher.js";
import registerApolloEventWatcher from "./events/apolloEventWatcher.js";
import { getCachedMembers, initMemberCache } from "./services/memberCache.js";
import { seedMemberRecordsFromCache } from "./services/memberRecords.js";
import {
  deleteBirthdayMessages,
  getAnchorProtectedMessageIds,
  getTodaysBirthdays,
  sendBirthdayMessages,
  syncAnchorMessage,
} from "./services/birthdays.js";
import { syncAllPanels } from "./services/reactionRoles.js";
import { getSettings } from "./db/settingsRepository.js";
import { settingsBus, SettingsEvent } from "./services/settingsBus.js";
import { startWebServer } from "./web/server.js";
import { createMockClient } from "./web/mockDiscordClient.js";
import type { BotClient } from "./types.js";

/**
 * Verifies the interacting user is allowed to run the command, replying
 * with a rejection message if not. Centralized here so individual command
 * handlers don't each re-implement the same admin/owner check.
 */
async function hasCommandPermission(
  interaction: ChatInputCommandInteraction,
  permission: CommandPermission | undefined,
): Promise<boolean> {
  switch (permission) {
    case CommandPermission.Owner:
      if (!isOwner(interaction)) {
        await interaction.reply({
          content: "❌ Du hast keine Berechtigung, diesen Befehl zu verwenden.",
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }
      return true;
    case CommandPermission.Admin:
      if (!isAdmin(interaction)) {
        await interaction.reply({
          embeds: [createNoAdminEmbed()],
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }
      return true;
    default:
      return true;
  }
}

const config = loadConfig();
// Makes every local-time-dependent Date computation in this process (Date#
// getHours/getDate/toLocaleString, the "today" boundary birthday matching
// runs against, etc.) reflect the configured community timezone instead of
// the container's OS default (commonly UTC) — see docs/CONFIGURATION.md.
process.env.TZ = config.timezone;

// Dev-only escape hatch (see docs/CONFIGURATION.md): skips the real Discord
// gateway login, slash-command registration, and every event
// module/watcher entirely, so the dashboard can be built and inspected
// with zero real Discord application. Nothing below this block runs in
// mock mode.
if (config.devMockDiscord) {
  const mockClient = createMockClient(config);
  startWebServer(mockClient, config).catch((err) => {
    logger.error(`❌ Mock dashboard failed to start: ${errorMessage(err)}`);
    process.exit(1);
  });
} else {
  startRealBot();
}

function startRealBot(): void {
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    // Non-privileged — no Developer Portal toggle needed. Required for
    // `voiceStateUpdate` events and for a voice channel's `.members` to be
    // populated at all — see events/apolloEventWatcher.ts.
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Required so reactions on messages the bot hasn't cached (e.g. added
  // before this process started) still fire messageReactionAdd/Remove
  // instead of being silently dropped — see docs/REACTION_ROLES.md.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
}) as BotClient;

client.commands = new Collection();

// 1. Cron Jobs
// The schedule itself is a DB-backed setting (dashboard-editable), so it's
// held in a variable and re-created whenever it changes instead of being
// fixed at startup.
let birthdayCronTask: ScheduledTask | undefined;
let lastScheduledCron: string | undefined;

async function runDailyBirthdayJob(): Promise<void> {
  const { birthdayListChannelId } = getSettings();
  if (!birthdayListChannelId) {
    logger.warn("Skipping daily birthday job: birthday channel not configured yet.");
    return;
  }
  // Never delete an anchor chunk while clearing out yesterday's announcements.
  await deleteBirthdayMessages(client, birthdayListChannelId, getAnchorProtectedMessageIds());
  const birthdays = getTodaysBirthdays();
  if (birthdays.length) {
    await sendBirthdayMessages(client, birthdayListChannelId, birthdays);
  }
}

function scheduleBirthdayCron(cronExpression: string): void {
  if (cronExpression === lastScheduledCron) return;
  birthdayCronTask?.stop();
  birthdayCronTask = cron.schedule(cronExpression, () => {
    runDailyBirthdayJob().catch((err) =>
      logger.error(`Daily birthday job failed: ${errorMessage(err)}`),
    );
  });
  lastScheduledCron = cronExpression;
  logger.info(`Birthday cron scheduled: ${cronExpression}`);
}

scheduleBirthdayCron(getSettings().birthdayCron);
settingsBus.on(SettingsEvent.Settings, () => scheduleBirthdayCron(getSettings().birthdayCron));

// 2. Interaction Handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);

  if (!cmd)
    return await interaction.reply({
      content: "❌ Befehl nicht gefunden oder deaktiviert.",
      flags: MessageFlags.Ephemeral,
    });

  try {
    // Check if the command is restricted to the configured guild
    // If guildOnly is false, it skips the guild check entirely
    if (cmd.guildOnly && !isConfigGuild(interaction)) {
      return await interaction.reply({
        content: "❌ Dieser Befehl kann nur auf dem Hauptserver verwendet werden.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await hasCommandPermission(interaction, cmd.permission))) return;

    await cmd.execute(interaction);
  } catch (err) {
    logger.error(err);
    const msg = {
      content: "⚠️ Beim Befehl ist ein Fehler aufgetreten.",
      flags: MessageFlags.Ephemeral,
    } as const;
    interaction.replied || interaction.deferred
      ? await interaction.followUp(msg)
      : await interaction.reply(msg);
  }
});

// 3. Initialization Logic
(async () => {
  try {
    await loadCommands(client);

    // Slash Registration
    const rest = new REST({ version: DISCORD_API_VERSION }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: [...client.commands.map((c) => c.data.toJSON())],
    });

    // Event Modules
    registerMemberEvents(client);
    registerBirthdayWatcher(client);
    registerReactionRoleEvents(client);
    registerRegisterWatcher(client);
    registerApolloEventWatcher(client);

    client.once("clientReady", async () => {
      logger.info(`Bot logged in as ${client.user?.tag}`);

      const guild = client.guilds.cache.get(config.guildId);
      if (guild) {
        await initMemberCache(guild);
        seedMemberRecordsFromCache(getCachedMembers());
      }

      // Owns the anchor message chain end to end — creates it on first run,
      // otherwise re-renders it from the current DB state (syncAnchorMessage
      // warns itself if the channel isn't configured yet).
      await syncAnchorMessage(client);

      // Re-post/edit every reaction-role panel so seed reactions survive a
      // restart even if someone manually removed one while the bot was down.
      await syncAllPanels(client);

      // Started only once the guild is cached — dashboard auth and the
      // /api/discord/* routes both read from client.guilds.cache.
      await startWebServer(client, config);
    });

    await client.login(config.token);
  } catch (err) {
    logger.error(`❌ Bot failed to start: ${errorMessage(err)}`);
    process.exit(1);
  }
})();
}
