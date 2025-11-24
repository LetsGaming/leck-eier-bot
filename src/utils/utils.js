import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

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