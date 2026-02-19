import path from "path";
import { readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadCommands(client, config) {
  const commandsPath = path.join(__dirname, "../commands");
  const commandFiles = getCommandFiles(commandsPath);

  for (const file of commandFiles) {
    const command = await import(path.resolve(file));
    const enabled = config.commands?.[command.data.name]?.enabled ?? true;

    if (enabled && command.data && command.execute) {
      client.commands.set(command.data.name, command);
    } else {
      logger.warn(`Skipping ${file}, missing data/execute or disabled`);
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
