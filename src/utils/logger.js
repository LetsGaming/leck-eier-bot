import path from "path";
import fs from "fs";
import { createLogger, format, transports } from "winston";
const { combine, printf, timestamp, colorize, errors, splat, json } = format;

// Ensure logs directory exists relative to the project root
const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Custom format for Console: readable, colorized, and handles metadata/objects
 */
const consoleFormat = printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} | [${level}]: ${stack || message}`;

    if (Object.keys(metadata).length > 0 && !stack) {
      msg += ` | ${JSON.stringify(metadata)}`;
    }

    return msg;
  },
);

const logger = createLogger({
  level: "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    splat(),
    json(),
  ),
  transports: [
    new transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
    new transports.File({
      filename: path.join(logDir, "combined.log"),
    }),
  ],
});

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
