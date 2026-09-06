import type { WebRole } from "./webRole.js";

/**
 * Who may run a command, as configured from the dashboard — either an
 * arbitrary Discord role, a minimum {@link WebRole} tier (checked via the
 * same hierarchy `resolveDashboardRole()` uses for dashboard login,
 * `bot-owner` > `guild-owner` > `admin`), or unrestricted. Shared between the
 * bot (`src/types.ts`, which re-exports it) and the dashboard frontend
 * (`web/src/types.ts`) — same rationale as `webRole.d.ts`. See
 * `docs/superpowers/specs/2026-09-05-command-permissions-design.md`.
 */
export type PermissionGate =
  | { mode: "everyone" }
  | { mode: "tier"; tier: WebRole }
  | { mode: "role"; roleId: string };
