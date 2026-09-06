import { randomBytes, randomUUID } from "crypto";
import { PermissionsBitField } from "discord.js";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { createSession } from "../db/sessionsRepository.js";
import logger, { errorMessage } from "../utils/logger.js";
import { getSessionFromRequest, logout, setSessionCookie } from "./session.js";
import type { ZodFastifyInstance } from "./utils.js";
import {
  DISCORD_API_BASE_URL,
  DISCORD_OAUTH_AUTHORIZE_URL,
  DISCORD_OAUTH_TOKEN_URL,
  WEB_OAUTH_STATE_COOKIE_NAME,
  WEB_OAUTH_STATE_TTL_SECONDS,
  WEB_SESSION_TTL_MS,
} from "../constants.js";
import type { BotClient, Config, WebRole } from "../types.js";

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

interface DiscordGuildMember {
  roles: string[];
}

const CallbackQuerystringSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/**
 * A misrouted URL (wrong path, a proxy in front of discord.com, etc.) can
 * still come back with a 2xx status but an HTML body — a plain `.json()`
 * call on that throws an opaque "Unexpected token '<'" deep inside V8's
 * JSON parser. Checking content-type first turns that into a message that
 * actually says what went wrong.
 */
async function parseJsonResponse<T>(res: Response, label: string): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`${label} returned a non-JSON response (content-type "${contentType}"): ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * Case-insensitive match of `origin` against the configured
 * `web.publicUrls` allow-list, or null if it isn't one of them. Shared by
 * two call sites with different ideas of "the origin":
 *  - the OAuth login/callback routes below, which resolve it from the
 *    *request's own* Host (`${request.protocol}://${request.host}`) so
 *    `redirect_uri` always matches an origin the app is genuinely
 *    reachable at — Discord requires the exact same `redirect_uri` at both
 *    the `/authorize` step and the token exchange, and rejects anything
 *    not registered on the application, so this can't be spoofed into an
 *    open redirect: an unlisted Host is simply refused, never guessed at.
 *  - the same-origin `Origin`/`Referer` check in web/server.ts, which
 *    resolves it from the request's *`Origin`/`Referer` header* instead, as
 *    defense-in-depth (backing the `SameSite=Lax` session cookie) against
 *    cross-site `/api/*` mutations.
 * Exported so both call sites reuse this one matcher instead of each
 * re-implementing the allow-list comparison.
 */
export function resolveRequestOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  return allowedOrigins.find((allowed) => allowed.toLowerCase() === origin.toLowerCase()) ?? null;
}

/**
 * `${request.protocol}://${request.host}` — the origin the *request itself*
 * arrived on. `request.protocol`/`request.host` already honor
 * `X-Forwarded-*` (the app is started with `trustProxy: true` — see
 * web/server.ts). Deliberately `request.host`, not `request.hostname` —
 * the latter silently strips the port, which would never match a
 * WEB_PUBLIC_URLS entry on a non-default port (e.g. `http://localhost:3000`).
 */
function requestHostOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

/**
 * Resolves the dashboard RBAC role (see WebRole in types.ts) a logging-in
 * user gets, or null if none of the three ways in apply — strictly
 * hierarchical, checked highest first: the bot owner gets 'bot-owner'; the
 * configured guild's owner (if not also the bot owner) gets 'guild-owner';
 * anyone else who holds Administrator in that guild (directly or via
 * @everyone) gets 'admin'.
 *
 * Exported so `utils/commandPermissions.ts` can reuse it for tier-mode
 * command-permission enforcement instead of duplicating the owner/admin
 * hierarchy — see the design spec's rationale for why command-permission
 * "tier" mode needs real guild-owner detection, not just isOwner()/isAdmin().
 */
export function resolveDashboardRole(client: BotClient, config: Config, userId: string, roleIds: string[]): WebRole | null {
  if (userId === config.botOwnerId) return "bot-owner";

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return null;
  if (guild.ownerId === userId) return "guild-owner";

  if (guild.roles.everyone.permissions.has(PermissionsBitField.Flags.Administrator)) return "admin";
  const hasAdminRole = roleIds.some((roleId) =>
    guild.roles.cache.get(roleId)?.permissions.has(PermissionsBitField.Flags.Administrator),
  );
  return hasAdminRole ? "admin" : null;
}

export function registerAuthRoutes(app: ZodFastifyInstance, client: BotClient, config: Config): void {
  const web = config.web!; // callers only invoke this once config.web is confirmed present

  if (config.devMockDiscord) {
    // Dev-only: skips the Discord OAuth round-trip entirely and logs in as
    // a synthetic bot-owner, matching the guild built by createMockClient.
    // Gated on the same flag `src/index.ts` uses to skip the real gateway
    // login — see docs/CONFIGURATION.md. Never reachable when that flag is
    // unset, so this never exists in a real deployment.
    app.get("/auth/dev-login", async (request, reply) => {
      const sessionId = randomUUID();
      createSession({
        id: sessionId,
        userId: "mock-admin-id",
        username: "Dev Admin",
        avatar: null,
        role: "bot-owner",
        expiresAt: Date.now() + WEB_SESSION_TTL_MS,
      });
      setSessionCookie(reply, sessionId, request.protocol === "https");
      return reply.redirect("/");
    });
  }

  app.get(
    "/auth/login",
    // Stricter than the app-wide rate limit (registered in server.ts) —
    // this is the route an unauthenticated brute-force/credential-stuffing
    // attempt against the OAuth flow would hit.
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const origin = resolveRequestOrigin(requestHostOrigin(request), web.publicUrls);
      if (!origin) {
        return reply
          .code(400)
          .send(
            `Dieses Dashboard ist unter ${request.protocol}://${request.host} nicht erreichbar — füge es zu WEB_PUBLIC_URLS hinzu und starte den Bot neu.`,
          );
      }

      const state = randomBytes(16).toString("hex");
      reply.setCookie(WEB_OAUTH_STATE_COOKIE_NAME, state, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        secure: request.protocol === "https",
        path: "/",
        maxAge: WEB_OAUTH_STATE_TTL_SECONDS,
      });

      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: `${origin}/auth/callback`,
        response_type: "code",
        scope: "identify guilds.members.read",
        state,
      });

      return reply.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`);
    },
  );

  app.get(
    "/auth/callback",
    {
      schema: { querystring: CallbackQuerystringSchema },
      // Same stricter limit as /auth/login — this is the other half of the
      // OAuth round-trip an unauthenticated attacker would hammer.
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
    const query = request.query;

    const stateCookieRaw = request.cookies[WEB_OAUTH_STATE_COOKIE_NAME];
    reply.clearCookie(WEB_OAUTH_STATE_COOKIE_NAME, { path: "/" });

    if (query.error) {
      return reply.code(400).send(`Discord hat die Anmeldeanfrage abgelehnt: ${query.error}`);
    }

    // Must resolve to the same origin /auth/login used — Discord redirects
    // back to the exact redirect_uri it was given, so the Host here always
    // matches the one the login attempt started from (unless it's been
    // removed from WEB_PUBLIC_URLS since, which invalidates the login).
    const origin = resolveRequestOrigin(requestHostOrigin(request), web.publicUrls);
    if (!origin) {
      return reply
        .code(400)
        .send(`Dieses Dashboard ist unter ${request.protocol}://${request.host} nicht erreichbar.`);
    }

    const unsignedState = stateCookieRaw ? request.unsignCookie(stateCookieRaw) : null;
    if (!query.code || !query.state || !unsignedState?.valid || unsignedState.value !== query.state) {
      // Same user-facing message either way, but the specific branch below
      // is what actually distinguishes "cookie never arrived" (proxy/browser
      // dropped it) from "signature invalid" (stale/rotated session secret)
      // from "genuine replay/expiry" — worth knowing when this is reported.
      let reason: string;
      if (!query.code || !query.state) reason = "callback is missing code or state query parameter";
      else if (!stateCookieRaw) reason = "no oauth state cookie was present on the request";
      else if (!unsignedState?.valid) reason = "oauth state cookie failed signature verification";
      else reason = "oauth state cookie value did not match the state query parameter";
      logger.warn(`OAuth callback rejected: ${reason}.`);
      return reply.code(400).send("Ungültiger oder abgelaufener Anmeldeversuch. Bitte versuche es erneut.");
    }

    let accessToken: string;
    try {
      const tokenRes = await fetch(DISCORD_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: web.clientSecret,
          grant_type: "authorization_code",
          code: query.code,
          redirect_uri: `${origin}/auth/callback`,
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`Discord token exchange returned ${tokenRes.status}: ${await tokenRes.text()}`);
      }
      accessToken = (await parseJsonResponse<DiscordTokenResponse>(tokenRes, "Discord token exchange")).access_token;
    } catch (err) {
      logger.error(`OAuth token exchange failed: ${errorMessage(err)}`);
      return reply.code(502).send("Die Discord-Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.");
    }

    let discordUser: DiscordUser;
    let roleIds: string[];
    try {
      const authHeader = { Authorization: `Bearer ${accessToken}` };
      const [userRes, memberRes] = await Promise.all([
        fetch(`${DISCORD_API_BASE_URL}/users/@me`, { headers: authHeader }),
        fetch(`${DISCORD_API_BASE_URL}/users/@me/guilds/${config.guildId}/member`, { headers: authHeader }),
      ]);

      if (memberRes.status === 404) {
        return reply.code(403).send("Du bist kein Mitglied des konfigurierten Servers.");
      }
      if (!userRes.ok) throw new Error(`Failed to fetch Discord profile: ${userRes.status}`);
      if (!memberRes.ok) throw new Error(`Failed to fetch guild membership: ${memberRes.status}`);

      discordUser = await parseJsonResponse<DiscordUser>(userRes, "Discord user fetch");
      roleIds = (await parseJsonResponse<DiscordGuildMember>(memberRes, "Discord guild member fetch")).roles;
    } catch (err) {
      logger.error(`OAuth profile fetch failed: ${errorMessage(err)}`);
      return reply.code(502).send("Dein Discord-Profil konnte nicht abgerufen werden. Bitte versuche es erneut.");
    }

    const role = resolveDashboardRole(client, config, discordUser.id, roleIds);
    if (!role) {
      return reply
        .code(403)
        .send("Du benötigst Administratorrechte auf dem Server (oder musst Bot-/Server-Besitzer sein), um das Dashboard zu nutzen.");
    }

    const sessionId = randomUUID();
    createSession({
      id: sessionId,
      userId: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      role,
      expiresAt: Date.now() + WEB_SESSION_TTL_MS,
    });
    setSessionCookie(reply, sessionId, request.protocol === "https");

    return reply.redirect("/");
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    logout(request, reply);
    return reply.code(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ error: "Nicht authentifiziert" });
    return {
      userId: session.userId,
      username: session.username,
      avatar: session.avatar,
      role: session.role,
      timezone: config.timezone,
    };
  });
}
