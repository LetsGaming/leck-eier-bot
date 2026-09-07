# tests/dashboard

Reserved for `web/` (React/Vite dashboard) tests. No test runner is wired up
for the dashboard yet — CI currently guards this package with `tsc --noEmit`
and `vite build` only (see `.github/workflows/ci.yml`, job `dashboard`).

When frontend tests are added here, pick a runner (e.g. Vitest) in
`web/package.json`, add a `test` script there, and wire it into the
`dashboard` CI job alongside the existing build step.
