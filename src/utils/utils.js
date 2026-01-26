import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PermissionsBitField } from "discord.js";
import logger from "./logger.js";

/**
 * Resolve __dirname in ESM
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Root of the `src` directory
 */
const SRC_ROOT = path.resolve(__dirname, "..");

/**
 * Cache config after first load
 */
let cachedConfig = null;

/**
 * Loads config.json from src
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = path.resolve(SRC_ROOT, "config.json");

  try {
    const raw = readFileSync(configPath, "utf8");
    cachedConfig = JSON.parse(raw);
    return cachedConfig;
  } catch (err) {
    logger.error("❌ Failed to load config.json at:", configPath);
    throw err;
  }
}

/**
 * Returns an absolute path to a file inside /data (project root)
 */
export function getDataFilePath(filename) {
  return path.resolve(SRC_ROOT, "..", "data", filename);
}

/**
 * Ensures /data exists in the project root
 */
export function ensureDataDirectoryExists() {
  const dataDir = path.resolve(SRC_ROOT, "..", "data");

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
    interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);

  return isOwner || hasAdminPerms;
}

/**
 * Checks if the interaction happened in the configured guild
 */
export function isConfigGuild(interaction) {
  const config = loadConfig();
  return interaction.guildId === config.guildId;
}
