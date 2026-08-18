import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import logger from "../utils/logger.js";
import { ConfigSchema, type Config } from "./schema.js";

/**
 * Resolve __dirname in ESM
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Root of the directory currently executing (src in dev, dist in prod) —
 * config.json lives alongside whichever one is actually running.
 */
const RUN_ROOT = path.resolve(__dirname, "..");

let cachedConfig: Config | null = null;

/**
 * Loads and validates config.json against {@link ConfigSchema}.
 */
export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = path.resolve(RUN_ROOT, "config.json");

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    const message = `❌ Failed to read config.json at: ${configPath}`;
    logger.error(message);
    throw new Error(message, { cause: err });
  }

  const parsed = ConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = z.prettifyError(parsed.error);
    const message = `❌ config.json at ${configPath} is invalid:\n${issues}`;
    logger.error(message);
    throw new Error(message);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export type { Config, CommandConfig } from "./schema.js";
