import {
  Client,
  Collection,
  GatewayIntentBits,
  Options,
  Partials,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import cron, { type ScheduledTask } from "node-cron";
import logger, { errorMessage } from "./utils/logger.js";
import { loadConfig } from "./config/index.js";
import { isConfigGuild } from "./utils/utils.js";
import { createNoAdminEmbed } from "./utils/embedUtils.js";
import { checkCommandPermission, resolveCommandGate } from "./utils/commandPermissions.js";

// Loaders & Handlers
import { loadCommands, pushCommandDefinitions, reloadCommands } from "./loaders/commandLoader.js";
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
import type { BotClient, Command, Config } from "./types.js";

/**
 * Verifies the interacting user is allowed to run `cmd`, replying with a
 * rejection message if not. Centralized here so individual command handlers
 * don't each re-implement the same permission check. Thin wrapper over
 * `resolveCommandGate()`/`checkCommandPermission()` (utils/commandPermissions.ts)
 * — the actual gate resolution (dashboard override, falling back to the
 * command's code-declared `CommandPermission`) and evaluation live there;
 * this only owns the ephemeral denial reply, preserving the exact
 * owner-vs-admin message split the old isOwner()/isAdmin()-based version had:
 * `createNoAdminEmbed()` for an admin-or-guild-owner-tier gate (old
 * `CommandPermission.Admin`), a bare rejection line for everything else — a
 * bot-owner-tier gate (old `CommandPermission.Owner`) or a role-mode gate
 * (new; has no admin-flavored wording to reuse).
 */
async function hasCommandPermission(
  interaction: ChatInputCommandInteraction,
  client: BotClient,
  config: Config,
  cmd: Pick<Command, "permission" | "permissionGate">,
): Promise<boolean> {
  const gate = resolveCommandGate({ permission: cmd.permission, permissionGate: cmd.permissionGate ?? null });
  if (await checkCommandPermission(interaction, client, config, gate)) return true;

  // Only an "admin"/"guild-owner" tier gate gets the old Admin-permission
  // wording (both are, from the member's point of view, "you need at least
  // admin-level access") — a bot-owner-tier gate or a role-mode gate get the
  // old Owner-permission plain rejection instead, since "Du benötigst
  // Administratorrechte" would be actively misleading for either (bot-owner
  // status isn't an admin permission at all, and a role-mode gate may not be
  // an admin-flavored role in the first place).
  if (gate.mode === "tier" && (gate.tier === "admin" || gate.tier === "guild-owner")) {
    await interaction.reply({
      embeds: [createNoAdminEmbed()],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: "❌ Du hast keine Berechtigung, diesen Befehl zu verwenden.",
      flags: MessageFlags.Ephemeral,
    });
  }
  return false;
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
  // Mirrors startRealBot()'s clientReady handler below: without this, every
  // live-member-cache-driven dashboard page (Member Audit's "in guild" list,
  // Registrierungen, Event-Anwesenheit's name resolution) stays permanently
  // empty in mock mode — isCacheReady() would never become true, since
  // nothing else calls initMemberCache() when the real Discord gateway login
  // (and its clientReady event) never happens.
  const mockGuild = mockClient.guilds.cache.get(config.guildId);
  if (mockGuild) {
    initMemberCache(mockGuild)
      .then(() => seedMemberRecordsFromCache(getCachedMembers()))
      .catch((err) => logger.error(`❌ Mock member cache init failed: ${errorMessage(err)}`));
  }
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
    // Privileged intent. Required to observe member join/leave/update events and
    // to keep the guild's member cache populated for audit tracking — see
    // events/memberEvents.ts and services/memberRecords.ts.
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // Privileged intent. Required for the bot to read message content for
    // birthday/registration/event parsing — see events/birthdayWatcher.ts,
    // events/registerWatcher.ts, and events/apolloEventWatcher.ts.
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
  // discord.js v14 already bounds MessageManager to 200 per channel by
  // default (Options.DefaultMakeCacheSettings === { MessageManager: 200 }).
  // This bot's own message-history consumers (birthdayWatcher.ts,
  // registerWatcher.ts) only ever act on the live messageCreate/messageUpdate
  // event they're handed, and messageCleanup.ts's /clear and /cleardm always
  // page through channel.messages.fetch() directly rather than reading from
  // the cache — so nothing here needs more than that default. This line
  // exists to make that limit explicit/intentional rather than relying on an
  // implicit library default. Options.cacheWithLimits() does NOT merge its
  // argument with the library defaults — passing a bare object opts every
  // *other* manager out of its own default limit — so we spread
  // DefaultMakeCacheSettings in first to keep every other manager's real
  // default bound intact.
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 200 }),
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

// Keeps in-process command state (and, only if the definition set actually
// changed, the Discord REST registration) in sync with `command_settings`
// regardless of what wrote it — mirrors the birthday-cron listener above.
// This is the ONLY caller of reloadCommands() for a dashboard command-toggle
// save (src/web/routes/commands.ts deliberately does not also call it).
// That alone isn't sufficient, though: settingsBus.emit() invokes listeners
// synchronously but doesn't await them, so two SettingsEvent.Commands
// emissions in quick succession (e.g. two rapid toggle saves) would each
// kick off this listener, and both resulting reloadCommands() calls could
// run concurrently — interleaving inside loadCommands()'s
// client.commands.clear() + await discoverCommands() (a transient window
// where an in-flight interaction could see "command not found"), and both
// reaching pushCommandDefinitions()'s hash check before either had written
// the new hash (a double Discord REST push). `pending` below chains every
// call onto the previous one's settled promise, so at most one
// reloadCommands() ever runs at a time and a second call made while one is
// in-flight simply waits for it to finish — closing both windows, not just
// narrowing them.
let pending: Promise<void> = Promise.resolve();
settingsBus.on(SettingsEvent.Commands, () => {
  pending = pending.then(() => reloadCommands(client, config)).catch((err) => {
    logger.error(`Befehle konnten nach einer Einstellungsänderung nicht neu geladen werden: ${errorMessage(err)}`);
  });
});

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

    if (!(await hasCommandPermission(interaction, client, config, cmd))) return;

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

    // Slash Registration — only actually pushed to Discord's rate-limited
    // REST endpoint when the definition set changed since the last push.
    await pushCommandDefinitions(client, config);

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
