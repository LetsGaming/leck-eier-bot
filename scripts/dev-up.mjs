#!/usr/bin/env node
/**
 * Run this BEFORE doing any manual/dashboard work in this repo — see
 * CLAUDE.md for the full convention. Starts an isolated backend + dashboard
 * pair (own SQLite file, own log dir, own free ports) under
 * DEV_MOCK_DISCORD=true, migrates and seeds that database with realistic
 * mock data, and prints the URLs to use.
 *
 * `--id <name>` (default: "default") namespaces everything — data/agent-<id>/,
 * logs/agent-<id>/ — so multiple agents/sessions working in this same
 * checkout at once never collide on the same database file or port. Always
 * pair with `scripts/dev-down.mjs --id <name>` when done.
 *
 * Usage: node scripts/dev-up.mjs [--id <name>]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { id: "default" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id" && argv[i + 1] !== undefined) args.id = argv[++i];
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(args.id)) {
    throw new Error(`--id must be alphanumeric/dash/underscore only, got: ${args.id}`);
  }
  return args;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/** Detached + unref'd so the child outlives this script's own process, with its output going straight to a log file instead of a pipe this process would otherwise need to stay alive to drain. */
function spawnBackground(command, args, { cwd, env, logFile }) {
  const fd = fs.openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  return child;
}

async function main() {
  const { id } = parseArgs(process.argv.slice(2));
  const log = (msg) => console.log(`[dev-up:${id}] ${msg}`);

  const dataDir = path.join(repoRoot, "data", `agent-${id}`);
  const logDir = path.join(repoRoot, "logs", `agent-${id}`);
  const sessionFile = path.join(dataDir, "dev-session.json");

  // Defensive: a previous run under this id may have crashed before
  // dev-down.mjs ran. Start from an actually-clean slate either way.
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const backendPort = await getFreePort();
  const vitePort = await getFreePort();

  const env = {
    ...process.env,
    DEV_MOCK_DISCORD: "true",
    DATA_DIR: dataDir,
    LOG_DIR: logDir,
    WEB_PORT: String(backendPort),
    WEB_PUBLIC_URLS: `http://localhost:${backendPort},http://localhost:${vitePort}`,
  };

  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

  log(`starting backend on :${backendPort} (data: ${dataDir})`);
  const backendLog = path.join(logDir, "backend.out.log");
  const backend = spawnBackground(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: repoRoot,
    env,
    logFile: backendLog,
  });

  const backendReady = await waitForHttp(`http://localhost:${backendPort}/api/status`, 20000);
  if (!backendReady) {
    log(`backend did not respond within 20s — check ${backendLog}`);
    process.exit(1);
  }
  log("backend ready");

  // The mock member cache (src/index.ts's devMockDiscord branch) populates
  // asynchronously right after the HTTP server starts listening — give it
  // a beat so seed-mock-data.ts's recordRulesAccepted/savePendingRegistration
  // calls (UPDATEs against rows that init creates) don't race an empty table.
  await new Promise((resolve) => setTimeout(resolve, 500));

  log("seeding mock data...");
  await new Promise((resolve, reject) => {
    const seed = spawn(process.execPath, [tsxCli, "scripts/seed-mock-data.ts"], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    seed.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed-mock-data.ts exited with code ${code}`))));
  });

  const viteCli = path.join(repoRoot, "web", "node_modules", "vite", "bin", "vite.js");
  log(`starting dashboard on :${vitePort}`);
  const viteLog = path.join(logDir, "vite.out.log");
  const vite = spawnBackground(process.execPath, [viteCli, "--port", String(vitePort), "--strictPort"], {
    cwd: path.join(repoRoot, "web"),
    env: { ...env, BACKEND_PORT: String(backendPort) },
    logFile: viteLog,
  });

  const viteReady = await waitForHttp(`http://localhost:${vitePort}/`, 20000);
  if (!viteReady) {
    log(`dashboard did not respond within 20s — check ${viteLog}`);
  }

  fs.writeFileSync(
    sessionFile,
    JSON.stringify(
      {
        id,
        backendPort,
        vitePort,
        backendPid: backend.pid,
        vitePid: vite.pid,
        dataDir,
        logDir,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log("");
  log("ready.");
  console.log(`  Dashboard:  http://localhost:${vitePort}`);
  console.log(`  Dev login:  http://localhost:${vitePort}/auth/dev-login`);
  console.log(`  Backend:    http://localhost:${backendPort}`);
  console.log(`  Logs:       ${logDir}`);
  console.log(`  When done:  node scripts/dev-down.mjs --id ${id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
