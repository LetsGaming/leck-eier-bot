# Documentation

Reference docs for `leck-eier-bot`. Start with the root [README](../README.md) for a feature overview and quick start; this index is for finding the doc that answers a specific question.

| Doc | Read this for |
| --- | --- |
| [CONFIGURATION.md](CONFIGURATION.md) | Every environment variable (`.env`), which are required vs. dashboard-only, regenerating `.env.example` |
| [DASHBOARD.md](DASHBOARD.md) | Setting up the web dashboard: the Discord OAuth2 app, required redirect URIs, multi-domain access, who's allowed to log in, what each page does |
| [REACTION_ROLES.md](REACTION_ROLES.md) | Reaction-role panels: modes (toggle/unique/verify), the `removeReaction` option, bot permission requirements |
| [COMMANDS.md](COMMANDS.md) | Every slash command, its options, and who can run it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Project layout, startup sequence, live reconfiguration, the permission model, how the dashboard backend is wired |
| [DATABASE.md](DATABASE.md) | SQLite schema, the migration runner, where the file lives, inspecting/backing it up |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running in Docker (recommended) or bare-metal with `pm2`/`systemd`, including the dashboard-specific setup step |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup, npm scripts, project conventions, adding a new command or env var, the dashboard frontend |

## Common tasks

- **First-time setup** — [CONFIGURATION.md](CONFIGURATION.md) for what to put in `.env`, then [DEPLOYMENT.md](DEPLOYMENT.md) for how to actually run it.
- **Dashboard shows a login/origin error** — [DASHBOARD.md § Multiple domains](DASHBOARD.md#multiple-domains) covers the usual causes (port mismatch, a proxy not forwarding `X-Forwarded-Proto`, a redirect URI that isn't registered on the Discord application).
- **Adding a new slash command** — [DEVELOPMENT.md § Adding a new command](DEVELOPMENT.md#adding-a-new-command).
- **Adding a new env var** — [DEVELOPMENT.md § Adding a new env var](DEVELOPMENT.md#adding-a-new-env-var).
- **Understanding how a setting takes effect without a restart** — [ARCHITECTURE.md § Live reconfiguration](ARCHITECTURE.md#live-reconfiguration).
