/**
 * Shared response-shape contracts between the bot's dashboard-server routes
 * (`src/web/routes/*.ts`) and the dashboard frontend (`web/src/`). Plain TS
 * types only — no runtime code, no dependency on either project's own
 * modules — so both `tsconfig.json` (bot, NodeNext) and `web/tsconfig.json`
 * (Vite, bundler resolution) can resolve them without pulling in the other
 * side's build graph. See `../docs/` or the Task 5 SDD brief for the
 * rationale.
 */

/**
 * Dashboard RBAC role. Strict hierarchy, highest first: 'bot-owner' (always
 * total access) > 'guild-owner' > 'admin'. Canonical source for both the bot
 * (`src/types.ts`, which re-exports it) and the dashboard frontend
 * (`web/src/types.ts`, which re-exports it).
 */
export type WebRole = "bot-owner" | "guild-owner" | "admin";
