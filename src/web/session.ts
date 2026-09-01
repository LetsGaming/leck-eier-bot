import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession, deleteSession } from "../db/sessionsRepository.js";
import { WEB_SESSION_COOKIE_NAME, WEB_SESSION_TTL_MS } from "../constants.js";
import type { WebRole, WebSession } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: WebSession;
  }
}

export function getSessionFromRequest(request: FastifyRequest): WebSession | null {
  const raw = request.cookies[WEB_SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return getSession(unsigned.value);
}

/** `secure` is decided per-request (`request.protocol === "https"`) rather than from static config, since a multi-domain dashboard can be reached over http on one origin and https on another. */
export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  reply.setCookie(WEB_SESSION_COOKIE_NAME, sessionId, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: WEB_SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(WEB_SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * RBAC gate factory — pass the roles (see WebRole in types.ts) allowed to
 * use a given route. `requireAdmin` (below) is the blanket "any logged-in
 * dashboard user" gate every route uses today; narrowing an individual
 * route to e.g. `requireRole("bot-owner")` later needs no schema change,
 * since the role is already resolved and stored on the session at login.
 */
export function requireRole(...allowed: WebRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = getSessionFromRequest(request);
    if (!session) {
      reply.code(401).send({ error: "Nicht authentifiziert" });
      return;
    }
    if (!allowed.includes(session.role)) {
      reply.code(403).send({ error: "Du hast keine Berechtigung, dies zu tun." });
      return;
    }
    request.session = session;
  };
}

/** Gate for every `/api/*` route except `/api/me` — any authenticated dashboard user, regardless of tier. */
export const requireAdmin = requireRole("bot-owner", "guild-owner", "admin");

export function logout(request: FastifyRequest, reply: FastifyReply): void {
  const session = getSessionFromRequest(request);
  if (session) deleteSession(session.id);
  clearSessionCookie(reply);
}
