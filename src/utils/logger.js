const path = require("path");
const fs = require("fs");
const { createLogger, format, transports } = require("winston");
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

    // If there is extra metadata (objects passed to the logger), stringify them
    if (Object.keys(metadata).length > 0 && !stack) {
      msg += ` | ${JSON.stringify(metadata)}`;
    }

    return msg;
  },
);

const logger = createLogger({
  // Base level: log everything 'info' and above (warn, error)
  level: "info",
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }), // Capture stack traces for Error objects
    splat(), // Allow string interpolation
    json(), // Default to JSON for file transports (better for log parsers)
  ),
  transports: [
    // 1. Errors only - saved to error.log
    new transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
    // 2. Everything - saved to combined.log (renamed from info.log for clarity)
    new transports.File({
      filename: path.join(logDir, "combined.log"),
    }),
  ],
});

/**
 * Add Pretty Console Logging if not in Production
 */
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new transports.Console({
      format: combine(
        colorize({ all: true }), // Colorize level and message
        timestamp({ format: "HH:mm:ss" }), // Shorter timestamp for console
        consoleFormat,
      ),
    }),
  );
}

module.exports = logger;
