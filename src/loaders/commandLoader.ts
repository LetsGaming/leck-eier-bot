import path from "path";
import { createHash } from "crypto";
import { readdirSync, statSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url"; // Added pathToFileURL for safer imports
import { REST, Routes } from "discord.js";
import logger from "../utils/logger.js";
import {
  getCommandDefinitionsHash,
  getCommandOverride,
  setCommandDefinitionsHash,
  type CommandOverride,
} from "../db/settingsRepository.js";
import { DISCORD_API_VERSION } from "../constants.js";
import type { BotClient, Command, Config } from "../types.js";
import type { CommandPermission } from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When running via tsx, this file executes as .ts; once compiled to dist/, it's .js.
// Match whichever extension the running loader itself has, so command discovery
// works in both dev (src/**/*.ts) and prod (dist/**/*.js) without extra config.
const COMMAND_FILE_EXTENSION = __filename.endsWith(".ts") ? ".ts" : ".js";

interface CommandModule {
  data?: { name?: string; description?: string };
  execute?: Command["execute"];
  permission?: CommandPermission;
}

interface DiscoveredCommand {
  name: string;
  description: string;
  permission?: CommandPermission;
  module: CommandModule;
}

/** Walks the commands directory and imports every module, regardless of its enabled/disabled override. */
async function discoverCommands(): Promise<DiscoveredCommand[]> {
  const commandsPath = path.join(__dirname, "../commands");
  const commandFiles = getCommandFiles(commandsPath);
  const discovered: DiscoveredCommand[] = [];

  for (const file of commandFiles) {
    // Use pathToFileURL to ensure Windows/Linux compatibility with ESM imports.
    // Cache-bust so a later reloadCommands()/listCommandDefinitions() call
    // re-reads overrides even though dynamic import() otherwise caches modules.
    const fileUrl = `${pathToFileURL(path.resolve(file)).href}?t=${Date.now()}`;
    const commandModule = (await import(fileUrl)) as CommandModule;

    const name = commandModule.data?.name;
    if (!name) {
      logger.warn(`Skipping ${file}: No command name found in SlashCommandBuilder data.`);
      continue;
    }

    discovered.push({
      name,
      description: commandModule.data?.description ?? "",
      permission: commandModule.permission,
      module: commandModule,
    });
  }

  return discovered;
}

export async function loadCommands(client: BotClient): Promise<void> {
  client.commands.clear();

  for (const discovered of await discoverCommands()) {
    const override = getCommandOverride(discovered.name);

    if (override.enabled && discovered.module.execute) {
      // Create a NEW object so it's extensible
      const commandObject: Command = {
        data: discovered.module.data as Command["data"],
        execute: discovered.module.execute,
        guildOnly: override.guildOnly,
        permission: discovered.permission,
      };

      client.commands.set(discovered.name, commandObject);
    } else {
      logger.warn(`Skipping ${discovered.name}: Disabled or missing execute function.`);
    }
  }
}

/**
 * Deterministic hash of the command definition set that would be sent to
 * Discord, so repeated pushes of an unchanged set can be detected and
 * skipped. Sorted by name first: `client.commands` iteration order follows
 * `discoverCommands()`'s filesystem walk, which isn't guaranteed stable
 * across platforms/filesystems, and an order-only difference must still hash
 * identically or every boot would look like a "changed" definition set.
 */
function hashCommandDefinitions(definitions: unknown[]): string {
  const sorted = [...definitions].sort((a, b) => {
    const nameA = (a as { name?: string }).name ?? "";
    const nameB = (b as { name?: string }).name ?? "";
    return nameA.localeCompare(nameB);
  });
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Pushes the current in-process `client.commands` definition set to Discord
 * via the rate-limited `rest.put(Routes.applicationCommands(...))` endpoint
 * — but only when that set has actually changed since the last successful
 * push (tracked via `command_registration_state.definitions_hash`). Callers
 * must call `loadCommands()` first; this only pushes what's already in
 * `client.commands`, it doesn't (re)populate it.
 */
export async function pushCommandDefinitions(client: BotClient, config: Config): Promise<void> {
  const definitions = [...client.commands.map((c) => c.data.toJSON())];
  const hash = hashCommandDefinitions(definitions);

  if (hash === getCommandDefinitionsHash()) {
    logger.info("Command definitions unchanged since last push; skipping Discord registration.");
    return;
  }

  const rest = new REST({ version: DISCORD_API_VERSION }).setToken(config.token);
  await rest.put(Routes.applicationCommands(config.clientId), { body: definitions });
  setCommandDefinitionsHash(hash);
}

/**
 * Re-walks the commands directory, re-populates `client.commands`, and
 * (only if the resulting definition set changed) re-registers with Discord.
 * Used by the dashboard's Commands page so toggling `enabled`/`guildOnly`
 * takes effect without a restart. Slash command *definitions*
 * (name/description/options) are only picked up from disk, so this does not
 * support hot-reloading a command's code — only its enabled/guildOnly
 * override.
 */
export async function reloadCommands(client: BotClient, config: Config): Promise<void> {
  await loadCommands(client);
  await pushCommandDefinitions(client, config);
}

export interface CommandDefinition extends CommandOverride {
  name: string;
  description: string;
  permission?: CommandPermission;
}

/** For the dashboard's Commands page — every command that exists on disk, including currently-disabled ones. */
export async function listCommandDefinitions(): Promise<CommandDefinition[]> {
  const discovered = await discoverCommands();
  return discovered.map((d) => ({
    name: d.name,
    description: d.description,
    permission: d.permission,
    ...getCommandOverride(d.name),
  }));
}

function getCommandFiles(dir: string): string[] {
  let files: string[] = [];
  for (const file of readdirSync(dir)) {
    const full = path.join(dir, file);
    if (statSync(full).isDirectory()) {
      files = files.concat(getCommandFiles(full));
    } else if (file.endsWith(COMMAND_FILE_EXTENSION)) {
      files.push(full);
    }
  }
  return files;
}
