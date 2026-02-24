import path from "path";
import { readdirSync, statSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url"; // Added pathToFileURL for safer imports
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadCommands(client, config) {
  const commandsPath = path.join(__dirname, "../commands");
  const commandFiles = getCommandFiles(commandsPath);

  for (const file of commandFiles) {
    // Use pathToFileURL to ensure Windows/Linux compatibility with ESM imports
    const fileUrl = pathToFileURL(path.resolve(file)).href;
    const commandModule = await import(fileUrl);

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
      const commandObject = {
        data: commandModule.data,
        execute: commandModule.execute,
        // Pull guildOnly from config, default to true if not specified
        guildOnly: cmdConfig?.guildOnly ?? true,
      };

      client.commands.set(commandName, commandObject);
    } else {
      logger.warn(`Skipping ${file}: Disabled or missing execute function.`);
    }
  }
}

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
