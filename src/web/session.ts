import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession, deleteSession } from "../db/sessionsRepository.js";
import { WEB_SESSION_COOKIE_NAME, WEB_SESSION_TTL_MS } from "../constants.js";
import type { WebSession } from "../types.js";

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
 * Gate for every `/api/*` route except `/api/me`. Named for what it
 * enforces conceptually — in practice a valid session *is* an admin
 * session, since `/auth/callback` only ever creates one after confirming
 * the user is the bot owner or has Administrator in the guild.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }
  request.session = session;
}

export function logout(request: FastifyRequest, reply: FastifyReply): void {
  const session = getSessionFromRequest(request);
  if (session) deleteSession(session.id);
  clearSessionCookie(reply);
}
