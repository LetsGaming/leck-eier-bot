#!/usr/bin/env node
/**
 * Run this AFTER finishing manual/dashboard work started with
 * scripts/dev-up.mjs — see CLAUDE.md for the full convention. Stops exactly
 * the backend + dashboard processes that dev-up.mjs started for this `--id`
 * (never a broad process-name kill — only the recorded PIDs), then deletes
 * that id's database and logs so the next session starts from a clean
 * state.
 *
 * Usage: node scripts/dev-down.mjs [--id <name>]
 */
import { execFileSync } from "node:child_process";
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

/** Kills exactly this one PID (and, on Windows, its child processes) — never a pattern/name-based kill, so it can't touch an unrelated process that happens to share a port or process name. */
function killPid(pid, label, log) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    log(`stopped ${label} (pid ${pid})`);
  } catch {
    log(`${label} (pid ${pid}) was already stopped`);
  }
}

function main() {
  const { id } = parseArgs(process.argv.slice(2));
  const log = (msg) => console.log(`[dev-down:${id}] ${msg}`);

  const dataDir = path.join(repoRoot, "data", `agent-${id}`);
  const logDir = path.join(repoRoot, "logs", `agent-${id}`);
  const sessionFile = path.join(dataDir, "dev-session.json");

  if (fs.existsSync(sessionFile)) {
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    killPid(session.backendPid, "backend", log);
    killPid(session.vitePid, "dashboard", log);
  } else {
    log("no dev-session.json found — nothing to stop (already clean, or dev-up.mjs was never run with this id).");
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
  log(`removed ${dataDir}`);
  log(`removed ${logDir}`);
  log("clean state.");
}

main();
