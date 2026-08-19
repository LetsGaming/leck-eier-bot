# ---- Build: compile TypeScript to dist/ ----
FROM node:lts-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: tsc only needs type declarations, not better-sqlite3's
# compiled native addon, so skip building it in this throwaway stage.
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- Build: dashboard SPA (separate package.json, own deps/lockfile) ----
FROM node:lts-slim AS build-web
WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web ./
RUN npm run build

# ---- Runtime: production deps + compiled output only ----
FROM node:lts-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build-web /app/web/dist ./web/dist

# .env, data/, and logs/ are provided at deploy time (see docker-compose.yml).
VOLUME ["/app/data", "/app/logs"]

# Only meaningful when the dashboard is enabled (WEB_ENABLED != "false") —
# see docs/DASHBOARD.md.
EXPOSE 3000

CMD ["node", "dist/index.js"]
