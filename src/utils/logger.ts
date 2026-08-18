import path from "path";
import fs from "fs";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LOG_MAX_FILE_SIZE, LOG_RETENTION_DAYS } from "../constants.js";

const { combine, printf, timestamp, colorize, errors, splat, json } = format;

// 1. Use environment variables for flexibility
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "..", "logs");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 2. Reusable formatting for files (JSON with stack traces)
const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  splat(),
  json(),
);

// 3. Human-readable console format
const consoleFormat = printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} | [${level}]: ${stack || message}`;
    if (Object.keys(metadata).length > 0 && !stack) {
      msg += ` | ${JSON.stringify(metadata)}`;
    }
    return msg;
  },
);

// 4. Initialize Logger with Daily Rotation
const logger = createLogger({
  level: LOG_LEVEL,
  format: fileFormat,
  transports: [
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
  // Handle uncaught exceptions and rejections so the app doesn't crash silently
  exceptionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, "exceptions.log") }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, "rejections.log") }),
  ],
});

// 5. Development-only Console Logging
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: "HH:mm:ss" }),
        consoleFormat,
      ),
    }),
  );
}

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
