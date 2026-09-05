import "dotenv/config";
import path from "path";
import fs from "fs";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LOG_MAX_FILE_SIZE, LOG_RETENTION_DAYS } from "../constants.js";

const { combine, printf, timestamp, colorize, errors, splat } = format;

// 1. LOG_DIR/LOG_LEVEL are also declared on EnvSchema (see
// src/config/schema.ts) so they're documented/typed/`.env.example`d like
// every other config value, but this module deliberately does NOT call
// loadConfig() to get them: loadConfig() also runs the fail-fast checks for
// required Discord credentials/TIMEZONE, and config/index.ts's bootstrap
// error/warn messages for those checks are logged through this file's
// `logger` export. If logger.ts depended on loadConfig() at module init,
// that would form an import cycle (loadConfig() failing would try to log
// through a `logger` that can't finish initializing until loadConfig()
// returns) and — worse — would mean logger.ts (and everything that imports
// it, which is most of the app) couldn't even be *loaded* until config
// validation succeeds, so a bad TIMEZONE/missing Discord token would never
// reach the persisted, rotated error/combined log files at all, only
// whatever raw console fallback replaced it. So: read these two values
// directly with the same default expressions the schema documents, kept in
// sync manually (two primitives, not worth a shared helper). The
// `import "dotenv/config"` above merges `.env` into `process.env` right here
// (dotenv never overwrites a variable that's already set, so a real env var
// injected by Docker/systemd still wins) — without it, this module reads
// process.env before config/index.ts's own `loadDotenv()` call ever runs,
// since src/index.ts imports this file first, so a LOG_DIR/LOG_LEVEL set
// only in `.env` would be silently ignored. This does NOT import
// config/index.ts (or anything that does), so no import cycle is
// introduced — see config/index.ts's comment for the other half of this.
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "..", "logs");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

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
