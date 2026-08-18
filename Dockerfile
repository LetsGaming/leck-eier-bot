# ---- Build: compile TypeScript to dist/ ----
FROM node:lts-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: tsc only needs type declarations, not better-sqlite3's
# compiled native addon, so skip building it in this throwaway stage.
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime: production deps + compiled output only ----
FROM node:lts-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# config.json, data/, and logs/ are provided at deploy time (see docker-compose.yml).
VOLUME ["/app/data", "/app/logs"]

CMD ["node", "dist/index.js"]
