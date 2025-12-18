import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { PermissionsBitField } from "discord.js";

/**
 * Absolute path to the project root.
 * This assumes the bot is started from the root directory
 * (e.g. `node src/index.js`)
 */
const PROJECT_ROOT = process.cwd();

/**
 * Loads config.json from the project root
 */
export function loadConfig() {
  const configPath = path.resolve(PROJECT_ROOT, "src", "config.json");

  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to load config.json at:", configPath);
    throw err;
  }
}

/**
 * Returns an absolute path to a file inside /data (project root)
 */
export function getDataFilePath(filename) {
  return path.resolve(PROJECT_ROOT, "data", filename);
}

/**
 * Ensures /data exists in the project root
 */
export function ensureDataDirectoryExists() {
  const dataDir = path.resolve(PROJECT_ROOT, "data");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Loads and parses a JSON file from /data
 */
export function loadDataFile(filename) {
  const filePath = getDataFilePath(filename);
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * Saves data as pretty-printed JSON to an absolute filepath
 */
export function saveToFile(filepath, data) {
  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Checks if user is either the bot owner or has administrator permissions
 */
export function isAdmin(interaction) {
  const config = loadConfig();
  const botOwnerId = config.botOwnerId;

  const isOwner = interaction.user.id === botOwnerId;
  const hasAdminPerms =
    interaction.memberPermissions.has(
      PermissionsBitField.Flags.Administrator
    );

  return isOwner || hasAdminPerms;
}

/**
 * Checks if the interaction happened in the configured guild
 */
export function isConfigGuild(interaction) {
  const config = loadConfig();
  return interaction.guildId === config.guildId;
}