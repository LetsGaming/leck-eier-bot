import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import logger, { errorMessage } from "../utils/logger.js";
import { sweepExpiredSessions } from "../db/sessionsRepository.js";
import { registerAuthRoutes, resolveRequestOrigin } from "./auth.js";
import { registerApiRoutes } from "./routes/index.js";
import type { BotClient, Config } from "../types.js";

// HTTP methods that never mutate server state — exempt from the
// same-origin Origin/Referer check below (a same-origin check on a GET
// would also break plain browser navigation/deep-linking, which sends no
// Origin header at all).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The `Origin` header, or — if absent — the origin portion of `Referer`.
 * Some browsers/configurations omit `Origin` on same-origin requests (e.g.
 * older Safari, or requests following a 302), so falling back to `Referer`
 * avoids false positives while still refusing requests that carry neither
 * (a same-origin browser fetch/XHR always sends at least one of the two).
 */
function requestOriginHeader(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (origin) return origin;

  const referer = request.headers.referer;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// web/dist sits at the project root, alongside data/ and whichever of
// src/dist is currently running — see src/db/index.ts for the same pattern.
const WEB_DIST_DIR = path.resolve(__dirname, "..", "..", "web", "dist");

/**
 * Starts the dashboard's HTTP server. A no-op (logged, not thrown) when
 * `web` isn't configured — the bot must be usable without the dashboard.
 * `config.web` is only ever set once `loadConfig()` has confirmed every
 * required WEB_ env var (and DISCORD_CLIENT_SECRET) is present — see
 * src/config/index.ts — so no further completeness checks are needed here.
 */
export async function startWebServer(client: BotClient, config: Config): Promise<void> {
  if (!config.web) {
    logger.info(
      "Web dashboard not starting (WEB_ENABLED=false, or required WEB_ env vars / DISCORD_CLIENT_SECRET missing).",
    );
    return;
  }

  sweepExpiredSessions();

  const app = Fastify({ logger: false, trustProxy: true }).withTypeProvider<ZodTypeProvider>();

  // Wires zod schemas (attached per-route via `schema: { body/params/querystring }`)
  // into Fastify's own validation/serialization pipeline, so routes get
  // request.body/params/query typed for free instead of hand-rolled
  // `zod.safeParse` calls and unchecked `as` casts. See setErrorHandler
  // below for how a validation failure is turned into a response.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Central error handler: the ONLY place that turns a thrown/validation
  // error into an HTTP response for the whole API. Route handlers that want
  // a specific status/body still just `return reply.code(...).send(...)`
  // directly (that never reaches here — this only fires for thrown errors
  // and schema-validation failures).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const message = error.validation
        .map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
        .join("; ");
      return reply.code(400).send({ error: message });
    }

    // Anything else is an unexpected failure — never forward its message
    // (may contain internals, stack details, DB errors, etc.) to the
    // client. Log it server-side and return a generic body instead.
    logger.error(`Unhandled error in ${request.method} ${request.url}: ${errorMessage(error)}`);
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: "Interner Serverfehler" });
  });

  // Chrome warns (harmlessly — it just falls back to site-keying) if some
  // responses on an origin request origin-keyed process isolation and
  // others don't. We don't rely on origin-keying for anything, but setting
  // it uniformly on every response is exactly Chrome's own suggested fix
  // and costs nothing.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Origin-Agent-Cluster", "?1");
  });

  await app.register(fastifyCookie, { secret: config.web.sessionSecret });
  await app.register(fastifyFormbody);

  // Sane defaults for a single-guild admin dashboard, not a public API: a
  // generous global cap (this is normal-usage-shaped traffic from a
  // handful of admins, not something under attack from legitimate volume)
  // with a much stricter override on the two unauthenticated OAuth routes
  // (registered below via each route's own `config.rateLimit`), since
  // those are what a credential-stuffing/brute-force attempt would hit.
  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // A real, same-origin-SPA-shaped CSP — not helmet's permissive default.
  // `useDefaults` (on by default) keeps helmet's other baseline directives
  // (object-src 'none', base-uri 'self', frame-ancestors 'self', etc.); the
  // directives below are the ones this specific app actually needs:
  //  - styleSrc needs 'unsafe-inline': the dashboard uses React inline
  //    `style={{...}}` attributes throughout (checked web/src) rather than
  //    a CSS-in-JS library with nonce support, so style-src 'self' alone
  //    would block every one of them.
  //  - imgSrc needs cdn.discordapp.com: avatar and custom-emoji images are
  //    loaded directly from Discord's CDN (see buildAvatarUrl usage and
  //    EmojiPicker.tsx), not proxied through this server.
  // Everything else (scripts, fonts, XHR/fetch targets) is same-origin
  // only — the built dashboard has no external font/CDN script dependency
  // (checked web/index.html, web/package.json, web/src/theme.css).
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  });

  // Defense-in-depth backing the `SameSite=Lax` session cookie (see
  // setSessionCookie in session.ts): SameSite=Lax already blocks the
  // cookie on cross-site POST/PUT/PATCH/DELETE, but this adds an explicit
  // server-side check so a mutation is rejected outright — with a clear
  // reason — rather than merely failing auth because the cookie didn't
  // arrive. Scoped to non-GET/HEAD/OPTIONS `/api/*` requests only: it must
  // never apply to `/auth/*` (the OAuth redirect flow legitimately arrives
  // via cross-site navigation from discord.com) or to static asset/SPA
  // routes.
  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith("/api/")) return;

    const origin = requestOriginHeader(request);
    if (!resolveRequestOrigin(origin, config.web!.publicUrls)) {
      logger.warn(
        `Rejected ${request.method} ${request.url}: Origin/Referer "${origin ?? "(none)"}" is not an allowed origin.`,
      );
      return reply.code(403).send({ error: "Ungültige Anfrageherkunft" });
    }
  });

  registerAuthRoutes(app, client, config);
  registerApiRoutes(app, client, config);

  if (existsSync(WEB_DIST_DIR)) {
    await app.register(fastifyStatic, { root: WEB_DIST_DIR, wildcard: false });
    // SPA fallback: any GET that isn't a static asset or an /api or /auth
    // route serves index.html so client-side routing (react-router) works
    // on a hard refresh/deep link.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
        return reply.code(404).send({ error: "Nicht gefunden" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    logger.warn(`Web dashboard: ${WEB_DIST_DIR} not found — run "npm run build" (which also builds web/).`);
  }

  const port = config.web.port;
  try {
    await app.listen({ port, host: "0.0.0.0" });
    logger.info(`Web dashboard listening on port ${port} (public URLs: ${config.web.publicUrls.join(", ")})`);
  } catch (err) {
    logger.error(`Failed to start web dashboard: ${errorMessage(err)}`);
  }
}
