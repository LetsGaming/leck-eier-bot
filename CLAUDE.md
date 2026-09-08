# Agent instructions for this repo

## Before doing any dev/manual-testing work

Run:

```bash
node scripts/dev-up.mjs --id <your-session-id>
```

Pick `<your-session-id>` yourself — something short and specific to this task/session (e.g. `settings-clarify`, `birthday-bugfix`). This starts an isolated backend + dashboard pair under `DEV_MOCK_DISCORD=true` (no real Discord app needed), each on its own automatically-picked free port, backed by its own disposable SQLite database, seeded with realistic mock data (birthdays, members, a pending registration, a reaction-role panel, an event with signups) so the dashboard shows real content instead of empty states. It prints the dashboard URL, dev-login URL, and log paths to use.

**Never run bare `npm run dev` / `npm run dev:web` directly, and never reuse another session's server or port.** Each agent/session gets its own `--id` and therefore its own isolated server, dashboard, and database — this is what stops concurrent agents from clobbering each other's data or fighting over a port, and it holds across separate sessions too, not just within one conversation.

**Never run a new dev-up before running dev-down on the old id.** Always make sure that a old dev session gets terminated and stray matter deleted, before calling up a new one. That way we don't end up with several stranded dev-sessions eating up system ressources. If for whatever reason it was not possible to terminate the old session via dev-down, note that down, the reason why you needed a new dev-session, the ID of the old session and if possible the reason why terminating the old did not work.

## After finishing that work

Run:

```bash
node scripts/dev-down.mjs --id <the-same-session-id>
```

This stops exactly the two processes `dev-up.mjs` started for that id (never a broad process-name kill — only the recorded PIDs), then deletes that id's database and logs. Always pair a `dev-up` with a matching `dev-down`, even if the session ends abnormally — `dev-up.mjs` also defensively wipes stale state under the same id before starting, but don't rely on that; clean up your own id when you're done with it.

## Never do this instead

- Never `kill`/`taskkill` a dev process by matching its command name or working directory — you cannot tell your own dev server apart from another agent's that way. Use `dev-down.mjs`, which kills by exact recorded PID.
- Never delete `data/` or `logs/` wholesale, or edit the repo's own `.env` — those aren't scoped to your session and may belong to someone else's in-progress work. `dev-up.mjs`/`dev-down.mjs` only ever touch `data/agent-<id>/` and `logs/agent-<id>/`.
- Never point a manually-started `npm run dev` / `npm run dev:web` pair at the default ports/database "just this once" — even for a quick check. Use `dev-up.mjs` every time; it's exactly as fast and never collides with anyone else's session.

See `docs/DEVELOPMENT.md`'s "Isolated dev sessions & mock data" section for the human-facing version of this, and `scripts/dev-up.mjs`/`scripts/dev-down.mjs`/`scripts/seed-mock-data.ts` for the implementation.
