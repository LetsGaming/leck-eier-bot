import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { PermissionsBitField } from "discord.js";

export function loadConfig() {
  // Path to THIS file: src/utils/loadConfig.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Resolve path to config.json relative to src/
  const configPath = path.resolve(__dirname, "../config.json");

  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to load config.json at:", configPath);
    throw err;
  }
}

export function getDataFilePath(filename) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../data", filename);
}

export function ensureDataDirectoryExists() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dataDir = path.resolve(__dirname, "../data");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

export function loadDataFile(filename) {
  const filePath = getDataFilePath(filename);

  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

export function saveToFile(filepath, data) {
  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
}

// Checks if user is either the bot owner (as per config) or has administrator permissions
export function isAdmin(interaction) {
  const config = loadConfig();
  const botOwnerId = config.botOwnerId;

  const isOwner = interaction.user.id === botOwnerId;
  const hasAdminPerms = interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);

  return isOwner || hasAdminPerms;
}