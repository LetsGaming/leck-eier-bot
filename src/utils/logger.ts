import path from "path";
import fs from "fs";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LOG_MAX_FILE_SIZE, LOG_RETENTION_DAYS } from "../constants.js";
import { loadConfig } from "../config/index.js";

const { combine, printf, timestamp, colorize, errors, splat } = format;

// 1. Sourced from the validated config (see src/config/schema.ts's LOG_DIR/
// LOG_LEVEL) rather than reading process.env directly, matching every other
// module's config access. Safe to call at this module's top level even
// though most call sites import `logger` before ever importing
// `../config/index.js` directly: config/index.ts doesn't import this file
// (see the comment there), so there's no import cycle, and loadConfig()
// caches its result so this doesn't re-run env validation later.
const { logDir: LOG_DIR, logLevel: LOG_LEVEL } = loadConfig();

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 2. Human-readable line format, shared by files and console (colorized only
// for the console transport, via its own `colorize()` step).
const readableFormat = printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} | [${level}]: ${stack || message}`;
    if (Object.keys(metadata).length > 0 && !stack) {
      msg += ` | ${JSON.stringify(metadata)}`;
    }
    return msg;
  },
);

const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  splat(),
  readableFormat,
);

// 4. Initialize Logger with Daily Rotation. Every transport here rotates and
// expires on the same LOG_MAX_FILE_SIZE / LOG_RETENTION_DAYS schedule so the
// log directory can't accumulate unbounded files (e.g. an unrotated
// exceptions.log growing forever, or years of dated combined logs).
const logger = createLogger({
  level: LOG_LEVEL,
  format: fileFormat,
  transports: [
    // Always-on console output — Docker/`docker compose logs` captures this.
    new transports.Console({
      format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }),
        splat(),
        colorize({ all: true }),
        readableFormat,
      ),
    }),
    // Rotated error logs
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true, // Compress old logs
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
      level: "error",
    }),
    // Rotated combined logs
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
    }),
  ],
  // Handle uncaught exceptions and rejections so the app doesn't crash
  // silently — rotated the same way as the regular logs above.
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "exceptions-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "rejections-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
    }),
  ],
});

export default logger;

/**
 * Renders an unknown catch value as a log-friendly string. Passing an Error
 * as a second `logger.error()` argument gets swallowed by winston's splat
 * handling, so call sites should fold it into the message text instead:
 * `logger.error(\`Something failed: ${errorMessage(err)}\`)`.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
