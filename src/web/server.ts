import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import logger, { errorMessage } from "../utils/logger.js";
import { sweepExpiredSessions } from "../db/sessionsRepository.js";
import { registerAuthRoutes } from "./auth.js";
import { registerApiRoutes } from "./routes/index.js";
import type { BotClient, Config } from "../types.js";

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

  const app = Fastify({ logger: false, trustProxy: true });

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
