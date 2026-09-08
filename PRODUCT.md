# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The dashboard's primary user is a Discord server moderator/admin: fluent in Discord and social media day-to-day (roles, channels, reaction roles, mentions), with real hands-on moderation experience — but zero prior exposure to this specific dashboard or to bot-admin tooling in general, and no code literacy. Design and copy should transfer that existing Discord fluency, never assume familiarity with databases, env vars, or developer terminology.

Three RBAC tiers can log in — `bot-owner`, `guild-owner`, `admin` (anyone with the guild's Administrator permission) — but all three currently see identical functionality; the tiers exist for future narrowing of specific destructive routes, not because today's admins differ in what they need.

## Product Purpose

Lets a Discord server's admins configure and operate the `leck-eier-bot` Discord bot live, without SSH access, editing config files, or restarting the bot: birthday tracking and daily announcements, reaction-role panels, per-command enable/permission toggles, member registration workflows, a member audit log (current and former members), and Apollo-sourced event-attendance tracking. Success means an admin can make a change and trust it took effect immediately, using language and mental models drawn from Discord itself rather than from the bot's internals.

## Positioning

A bespoke, single-community tool, not a general product: one deployment serves exactly one Discord guild (`GUILD_ID` is a single value in config), tuned for that community's real, returning admins rather than designed for a stranger's first five minutes or for other servers to self-host and onboard into. The dashboard is a thin UI layer over the bot's own logic — every write goes through the same repository/service functions and the same `settingsBus` event emitter slash commands use, so the dashboard never carries a parallel copy of business logic, and a change made there behaves identically to the equivalent slash command.

## Operating Context

Used by admins moderating an active Discord server, typically while something concrete needs fixing right now — approving a pending registration, resolving an unmatched event sign-up, toggling a misbehaving command, adjusting the birthday schedule. Login is gated behind the guild's own Discord OAuth2 (no separate account system); the seven pages are `/` (status), `/reaction-roles`, `/birthdays`, `/commands`, `/members`, `/events` + `/events/:eventId`, and `/settings`. Self-hosted (Docker or bare-metal + pm2/systemd), backed by one SQLite database, no external hosting or multi-tenant infrastructure involved.

## Capabilities and Constraints

- Single Discord guild per deployment; not multi-tenant, and not architected to become so.
- Discord OAuth2 is the only login path — no dashboard-native accounts or passwords.
- Three RBAC tiers (bot-owner/guild-owner/admin) resolve via a strict hierarchy, but every route currently uses the blanket `requireAdmin` check — no tier sees anything the others don't, yet.
- SQLite is the only datastore; every dashboard write flows through the same repository/service layer and `settingsBus` the slash commands use, never a separate write path.
- Frontend is deliberately dependency-light by existing convention: plain CSS custom properties for theming, no component library, no state-management library. New UI work should keep matching that footprint rather than introducing one.
- "The global font" is a stylized-Unicode-alphabet substitution cipher (a "fancy text generator" style), not a real webfont — an intentional, existing feature, not a typography choice to second-guess.
- Undecided: whether this positioning (single-community, not for reuse) should ever change is explicitly left open — record any future decision to generalize it as a deliberate change, not an assumption.

## Evidence on Hand

None on file — no real user screenshots, testimonials, usage metrics, or case studies exist for this product, and future design work must not fabricate any. The only demonstrable artifact is the running dashboard itself, reachable in an isolated dev session (`node scripts/dev-up.mjs --id <session-id>`) seeded with realistic mock data (`DEV_MOCK_DISCORD=true`) for inspection without a real Discord app.

## Product Principles

1. **Speak the admin's existing Discord fluency, never developer fluency.** Copy, terminology, and information architecture should map onto concepts a Discord moderator already knows (roles, channels, mentions, reaction roles) — never raw IDs, database column names, or internal jargon a first-timer to this specific tool would have to translate.
2. **The dashboard is a UI layer, never a parallel implementation.** Every write goes through the same repository/service functions and `settingsBus` event emitter the slash commands use; a change made on the dashboard must behave identically to the equivalent slash command, with no divergent business logic living only in `web/` or `src/web/`.
3. **Optimize for one returning community, not a stranger's first five minutes.** This is a bespoke tool for a single, specific Discord server's admins over time — not a product that needs generic onboarding, multi-tenant generality, or self-serve adoption by other communities.
4. **Stay dependency-light on the frontend by choice, not neglect.** No component library, no state-management library, plain CSS custom properties — matching this footprint is a constraint future UI work should respect, not a gap to "fix" by introducing a framework.
5. **Every configuration change takes effect live.** No restart, no config-file edit, no deploy step — this is a load-bearing product promise (stated explicitly in the README and docs), and any new dashboard capability should preserve it.
