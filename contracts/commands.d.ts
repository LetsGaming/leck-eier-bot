/**
 * `CommandDef`'s `permission` tier, as exposed over the dashboard API
 * (`GET /api/commands`). Mirrors the string values of the bot's
 * `CommandPermission` enum (`src/constants.ts`) — kept here as a plain
 * string union rather than re-exporting the enum itself, since the enum
 * carries runtime values/behavior that belongs to the bot's own module
 * graph, while this contract is only the shape of the value as it crosses
 * the HTTP boundary.
 */
export type CommandPermission = "none" | "admin" | "owner";
