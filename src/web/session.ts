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
 * use a given route, e.g. `requireRole("bot-owner")` on a route-level
 * `preHandler` to narrow past the blanket `/api/*` gate
 * (`createRequireDashboardUser` in `accessControl.ts`). Prefers an
 * already-attached `request.session` over re-deriving one from the cookie,
 * so when used as a route-level preHandler (which runs after that blanket
 * gate) it sees the same live-re-resolved role the blanket gate computed,
 * not a second, potentially different, read of the raw session row.
 */
export function requireRole(...allowed: WebRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = request.session ?? getSessionFromRequest(request);
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

export function logout(request: FastifyRequest, reply: FastifyReply): void {
  const session = getSessionFromRequest(request);
  if (session) deleteSession(session.id);
  clearSessionCookie(reply);
}
