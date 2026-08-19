import { randomBytes, randomUUID } from "crypto";
import { PermissionsBitField } from "discord.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createSession } from "../db/sessionsRepository.js";
import logger, { errorMessage } from "../utils/logger.js";
import { getSessionFromRequest, logout, setSessionCookie } from "./session.js";
import {
  DISCORD_API_BASE_URL,
  DISCORD_OAUTH_AUTHORIZE_URL,
  DISCORD_OAUTH_TOKEN_URL,
  WEB_OAUTH_STATE_COOKIE_NAME,
  WEB_SESSION_TTL_MS,
} from "../constants.js";
import type { BotClient, Config } from "../types.js";

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

/**
 * Which of `web.publicUrls` (if any) the request actually came in on, so
 * `redirect_uri` always matches an origin the app is genuinely reachable
 * at — Discord requires the exact same `redirect_uri` at both the
 * `/authorize` step and the token exchange, and rejects anything not
 * registered on the application, so this can't be spoofed into an open
 * redirect: an unlisted Host is simply refused, never guessed at.
 * `request.protocol`/`request.host` already honor `X-Forwarded-*` (the app
 * is started with `trustProxy: true` — see web/server.ts). Deliberately
 * `request.host`, not `request.hostname` — the latter silently strips the
 * port, which would never match a WEB_PUBLIC_URLS entry on a non-default
 * port (e.g. `http://localhost:3000`).
 */
function resolveRequestOrigin(request: FastifyRequest, allowedOrigins: string[]): string | null {
  const origin = `${request.protocol}://${request.host}`;
  return allowedOrigins.find((allowed) => allowed.toLowerCase() === origin.toLowerCase()) ?? null;
}

/** Owner of the bot, owner of the guild, or holds a role with Administrator — the only three ways in. */
function isAuthorized(client: BotClient, config: Config, userId: string, roleIds: string[]): boolean {
  if (userId === config.botOwnerId) return true;

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return false;
  if (guild.ownerId === userId) return true;

  if (guild.roles.everyone.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return roleIds.some((roleId) =>
    guild.roles.cache.get(roleId)?.permissions.has(PermissionsBitField.Flags.Administrator),
  );
}

export function registerAuthRoutes(app: FastifyInstance, client: BotClient, config: Config): void {
  const web = config.web!; // callers only invoke this once config.web is confirmed present

  app.get("/auth/login", async (request, reply) => {
    const origin = resolveRequestOrigin(request, web.publicUrls);
    if (!origin) {
      return reply
        .code(400)
        .send(
          `This dashboard isn't reachable at ${request.protocol}://${request.host} — add it to WEB_PUBLIC_URLS and restart the bot.`,
        );
    }

    const state = randomBytes(16).toString("hex");
    reply.setCookie(WEB_OAUTH_STATE_COOKIE_NAME, state, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: request.protocol === "https",
      path: "/",
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${origin}/auth/callback`,
      response_type: "code",
      scope: "identify guilds.members.read",
      state,
    });

    return reply.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`);
  });

  app.get("/auth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    const stateCookieRaw = request.cookies[WEB_OAUTH_STATE_COOKIE_NAME];
    reply.clearCookie(WEB_OAUTH_STATE_COOKIE_NAME, { path: "/" });

    if (query.error) {
      return reply.code(400).send(`Discord declined the login request: ${query.error}`);
    }

    // Must resolve to the same origin /auth/login used — Discord redirects
    // back to the exact redirect_uri it was given, so the Host here always
    // matches the one the login attempt started from (unless it's been
    // removed from WEB_PUBLIC_URLS since, which invalidates the login).
    const origin = resolveRequestOrigin(request, web.publicUrls);
    if (!origin) {
      return reply
        .code(400)
        .send(`This dashboard isn't reachable at ${request.protocol}://${request.host}.`);
    }

    const unsignedState = stateCookieRaw ? request.unsignCookie(stateCookieRaw) : null;
    if (!query.code || !query.state || !unsignedState?.valid || unsignedState.value !== query.state) {
      return reply.code(400).send("Invalid or expired login attempt. Please try again.");
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
      accessToken = ((await tokenRes.json()) as DiscordTokenResponse).access_token;
    } catch (err) {
      logger.error(`OAuth token exchange failed: ${errorMessage(err)}`);
      return reply.code(502).send("Failed to complete Discord login. Please try again.");
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
        return reply.code(403).send("You are not a member of the configured server.");
      }
      if (!userRes.ok) throw new Error(`Failed to fetch Discord profile: ${userRes.status}`);
      if (!memberRes.ok) throw new Error(`Failed to fetch guild membership: ${memberRes.status}`);

      discordUser = (await userRes.json()) as DiscordUser;
      roleIds = ((await memberRes.json()) as DiscordGuildMember).roles;
    } catch (err) {
      logger.error(`OAuth profile fetch failed: ${errorMessage(err)}`);
      return reply.code(502).send("Failed to fetch your Discord profile. Please try again.");
    }

    if (!isAuthorized(client, config, discordUser.id, roleIds)) {
      return reply
        .code(403)
        .send("You need Administrator permission in the server (or be the bot owner) to use the dashboard.");
    }

    const sessionId = randomUUID();
    createSession({
      id: sessionId,
      userId: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      isOwner: discordUser.id === config.botOwnerId,
      expiresAt: Date.now() + WEB_SESSION_TTL_MS,
    });
    setSessionCookie(reply, sessionId, request.protocol === "https");

    return reply.redirect("/");
  });

  app.post("/auth/logout", async (request, reply) => {
    logout(request, reply);
    return reply.code(204).send();
  });

  app.get("/api/me", async (request, reply) => {
    const session = getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ error: "Not authenticated" });
    return {
      userId: session.userId,
      username: session.username,
      avatar: session.avatar,
      isOwner: session.isOwner,
    };
  });
}
