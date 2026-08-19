import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-server-only proxy so `npm run dev` (Vite on its own port) can talk to
// the bot's Fastify server without CORS setup — in production the bot
// serves web/dist directly, so no proxy is involved there.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
