import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-server-only proxy so `npm run dev` (Vite on its own port) can talk to
// the bot's Fastify server without CORS setup — in production the bot
// serves web/dist directly, so no proxy is involved there. BACKEND_PORT
// lets scripts/dev-up.mjs point an isolated Vite instance at its own
// isolated backend instead of the default :3000.
const backendPort = process.env.BACKEND_PORT ?? "3000";
const backendTarget = `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backendTarget,
      "/auth": backendTarget,
    },
  },
  build: {
    outDir: "dist",
  },
});
