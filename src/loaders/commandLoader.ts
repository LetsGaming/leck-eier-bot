import path from "path";
import { readdirSync, statSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url"; // Added pathToFileURL for safer imports
import logger from "../utils/logger.js";
import type { BotClient, Command, Config } from "../types.js";
import type { CommandPermission } from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When running via tsx, this file executes as .ts; once compiled to dist/, it's .js.
// Match whichever extension the running loader itself has, so command discovery
// works in both dev (src/**/*.ts) and prod (dist/**/*.js) without extra config.
const COMMAND_FILE_EXTENSION = __filename.endsWith(".ts") ? ".ts" : ".js";

interface CommandModule {
  data?: { name?: string };
  execute?: Command["execute"];
  permission?: CommandPermission;
}

export async function loadCommands(client: BotClient, config: Config): Promise<void> {
  const commandsPath = path.join(__dirname, "../commands");
  const commandFiles = getCommandFiles(commandsPath);

  for (const file of commandFiles) {
    // Use pathToFileURL to ensure Windows/Linux compatibility with ESM imports
    const fileUrl = pathToFileURL(path.resolve(file)).href;
    const commandModule = (await import(fileUrl)) as CommandModule;

    // The name is inside commandModule.data.name
    const commandName = commandModule.data?.name;

    if (!commandName) {
      logger.warn(
        `Skipping ${file}: No command name found in SlashCommandBuilder data.`,
      );
      continue;
    }

    const cmdConfig = config.commands?.[commandName];
    const enabled = cmdConfig?.enabled ?? true;

    if (enabled && commandModule.execute) {
      // Create a NEW object so it's extensible
      const commandObject: Command = {
        data: commandModule.data as Command["data"],
        execute: commandModule.execute,
        // Pull guildOnly from config, default to true if not specified
        guildOnly: cmdConfig?.guildOnly ?? true,
        permission: commandModule.permission,
      };

      client.commands.set(commandName, commandObject);
    } else {
      logger.warn(`Skipping ${file}: Disabled or missing execute function.`);
    }
  }
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
