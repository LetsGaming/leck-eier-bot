import type { FastifyReply, FastifyRequest } from "fastify";
import { getAccessOverride } from "../db/accessControlRepository.js";
import { getActiveTemporaryGrantForUser } from "../db/temporaryGrantsRepository.js";
import { TIER_RANK } from "../utils/commandPermissions.js";
import { getCachedMembers, isCacheReady } from "../services/memberCache.js";
import { resolveDashboardRole } from "./auth.js";
import { getSessionFromRequest } from "./session.js";
import type { BotClient, Config, PermissionGate, WebRole, WebSession } from "../types.js";

export interface FeatureDescriptor {
  key: string;
  /** German label shown on the "Zugriff" settings tab — matches the app's UI language elsewhere. */
  label: string;
  defaultGate: PermissionGate;
}

/**
 * Every dashboard write action that can be gated independently of the
 * blanket `/api/*` tier check (see `createRequireDashboardUser` below).
 * Each key's effective gate is its `dashboard_access_overrides` row (see
 * `accessControlRepository.ts`) if one is set, else `defaultGate` here —
 * which for every feature except `commands.write` reproduces the exact
 * behavior every mutating route already had before this system existed
 * (admin-tier-or-higher), so shipping this is a config surface, not a
 * behavior change, until a bot-owner/guild-owner actually edits an
 * override.
 */
export const FEATURES: FeatureDescriptor[] = [
  { key: "registrations.write", label: "Mitgliederprüfung – Registrierungen genehmigen/entfernen", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "eventAttendance.write", label: "Event-Anwesenheit – Anmeldungen zuordnen, Events löschen", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "events.write", label: "Events – Erstellen/Bearbeiten/Stornieren", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "eventTemplates.write", label: "Event-Vorlagen – Bearbeiten", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "reactionRoles.write", label: "Reaktionsrollen – Panels bearbeiten", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "birthdays.write", label: "Geburtstage – Einträge bearbeiten", defaultGate: { mode: "tier", tier: "admin" } },
  { key: "settings.write", label: "Einstellungen – Bearbeiten (Geburtstags- und allgemeine Einstellungen)", defaultGate: { mode: "tier", tier: "admin" } },
  // Narrower default than the rest — see the RBAC audit finding this closes:
  // an admin-tier session could otherwise loosen any slash command's own
  // permission gate (including down to "everyone").
  { key: "commands.write", label: "Befehle – Berechtigungen ändern", defaultGate: { mode: "tier", tier: "guild-owner" } },
];

/**
 * Elevates `role` to an active temporary grant's tier if that ranks higher —
 * never a restriction (a `null`/low `role` from a block-override or a
 * left-guild member is deliberately still elevate-able, since a bot-owner
 * explicitly chose to grant this specific person access — see
 * `docs/DASHBOARD.md`'s RBAC section). Called from both `resolveDashboardRole`
 * (login-time) and `resolveLiveRole` (every request) so a grant works
 * immediately either way; harmless to apply twice in the same request
 * (idempotent — the higher of two equal ranks is itself).
 */
export function applyTemporaryGrant(userId: string, role: WebRole | null): WebRole | null {
  const grant = getActiveTemporaryGrantForUser(userId);
  if (!grant) return role;
  const baseRank = role ? TIER_RANK[role] : -1;
  return TIER_RANK[grant.role] > baseRank ? grant.role : role;
}

export function resolveFeatureGate(featureKey: string): PermissionGate {
  return getAccessOverride(featureKey) ?? FEATURES.find((f) => f.key === featureKey)!.defaultGate;
}

/**
 * Evaluates whether `session` satisfies `gate`. `bot-owner` always passes,
 * regardless of `gate` — matching the documented hierarchy ("always total
 * access") and ensuring a misconfigured override can never lock the bot
 * owner out of their own dashboard.
 */
export function checkFeatureGate(gate: PermissionGate, session: WebSession): boolean {
  if (session.role === "bot-owner") return true;
  switch (gate.mode) {
    case "everyone":
      // Every /api/* route already sits behind the authenticated-dashboard-
      // user check (createRequireDashboardUser) — "everyone" here means any
      // resolved tier, not literally unauthenticated.
      return true;
    case "tier":
      return TIER_RANK[session.role] >= TIER_RANK[gate.tier];
    case "role":
      // Live lookup (not a snapshot taken at login) — reflects a role grant/
      // revoke as soon as the member cache picks it up.
      return getCachedMembers().get(session.userId)?.roles.cache.has(gate.roleId) ?? false;
  }
}

/** Route-level preHandler — apply to a mutating route alongside its `schema` option. Needs no client/config: it reads the already-attached `request.session` (set by `createRequireDashboardUser` below) and the module-level member cache. */
export function requireFeature(featureKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!checkFeatureGate(resolveFeatureGate(featureKey), request.session!)) {
      reply.code(403).send({ error: "Du hast keine Berechtigung für diese Aktion." });
    }
  };
}

/**
 * Re-resolves `session`'s role from the LIVE member cache instead of
 * trusting the (up to 7-day-old) snapshot taken at login — so a role grant,
 * revoke, or guild departure takes effect on the very next request instead
 * of only at the next login. Returns `null` when the session's role can no
 * longer be substantiated (left the guild, lost the qualifying role) —
 * callers must treat that as "this session is no longer valid", not fall
 * back to the stale snapshot.
 */
export function resolveLiveRole(client: BotClient, config: Config, session: WebSession): WebRole | null {
  let resolved: WebRole | null;
  if (session.userId === config.botOwnerId) {
    resolved = "bot-owner"; // never depends on guild membership
  } else if (config.devMockDiscord) {
    // Dev-mode's synthetic dashboard session (see /auth/dev-login in
    // auth.ts) has no real gateway membership to re-verify against —
    // createMockClient's guild never contains a "mock-admin-id" member — so
    // there's nothing live to check here. Never reachable in production
    // (config/index.ts hard-fails boot if devMockDiscord is set alongside
    // NODE_ENV=production).
    resolved = session.role;
  } else if (!isCacheReady()) {
    resolved = session.role; // cache still warming (e.g. right after a restart) — can't verify yet, don't wrongly lock everyone out
  } else {
    const cached = getCachedMembers().get(session.userId);
    // cache is ready and has no record for them — left the guild/lost
    // membership. Deliberately NOT run through resolveDashboardRole() with
    // an empty roleIds list: some of its checks (guild-owner, @everyone-
    // Administrator) don't depend on roleIds at all and would wrongly still
    // match for someone who's actually gone. `null` here still passes
    // through applyTemporaryGrant() below, so an explicit temporary grant
    // can still override this — that's the one case allowed to.
    resolved = cached ? resolveDashboardRole(client, config, session.userId, [...cached.roles.cache.keys()]) : null;
  }
  return applyTemporaryGrant(session.userId, resolved);
}

/**
 * The blanket `/api/*` gate (replaces the old static `requireAdmin`):
 * resolves the session, live-re-resolves its role, and rejects outright
 * (401, same as "not authenticated") if that role can no longer be
 * substantiated — see `resolveLiveRole`. Every downstream preHandler
 * (`requireRole`, `requireFeature`) reads the live role this attaches to
 * `request.session`, never the raw session row.
 */
export function createRequireDashboardUser(client: BotClient, config: Config) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = getSessionFromRequest(request);
    if (!session) {
      reply.code(401).send({ error: "Nicht authentifiziert" });
      return;
    }
    const liveRole = resolveLiveRole(client, config, session);
    if (!liveRole) {
      reply.code(401).send({ error: "Nicht authentifiziert" });
      return;
    }
    request.session = { ...session, role: liveRole };
  };
}
