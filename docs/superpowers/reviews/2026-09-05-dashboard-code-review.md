# Dashboard code review — 2026-09-05

Scope: `web/src/**` (React/Vite admin dashboard) and `src/web/**` (Fastify layer serving it). Standards applied: `code-standards` general references + `react.md` + `fastify.md`, full strength (no project overlay exists for this repo).

## Summary

The dashboard is functionally solid and unusually well-documented (dense, accurate doc comments explaining *why*, not just *what*), with no unsafe casts on persisted data, a clean repository boundary (routes never touch SQL directly), and genuinely good accessibility work in bespoke components (`SearchableSelect`, `ConfirmContext`). The two systemic weaknesses are architectural rather than incidental: **every route hand-rolls request validation and error responses instead of using Fastify's native schema/type-provider mechanism** (60+ manual `reply.code(...).send({error})` call sites, zero `setErrorHandler`, and unchecked `as` casts on every `request.params`/`request.query`), and **the frontend has no data-fetching hook layer at all** — every page fetches directly in a `useEffect` in the component body, and one page (`ReactionRoles.tsx`, 863 lines) has grown into a god component that owns five distinct concerns. Security baseline gaps (no rate limiting, no CSRF token, no `@fastify/helmet`) are present but partially mitigated by the app's existing SameSite/httpOnly cookie discipline.

---

## Boundaries / SRP

**1. (High) No hook layer anywhere on the frontend — every page fetches inside `useEffect` in the component body.**
`web/src/pages/Overview.tsx:19-24`, `Birthdays.tsx:45-62`, `MemberAudit.tsx:243-255`, `Commands.tsx:17-22`, `Settings.tsx:380-393`, `ReactionRoles.tsx:122-134`, `EventAttendance.tsx:55-70`, `EventAttendanceDetail.tsx:27-43`, `components/Layout.tsx:88-98` — every one of these calls `api.xxx()` straight from a `useEffect`/handler in the component, with no `useXxx()` hook in between.
Violates `react.md`'s "Separate view from logic with custom hooks" and the red flag "`fetch`/`axios` called directly in a component body" (here it's `api.foo()`, but the seam being skipped is the same one: a hook should own the fetch/loading/error state, and the component should just consume it). Because the pattern is applied uniformly, the fix is mechanical: extract one `useXxx()` hook per page/resource (e.g. `useStatus()`, `useBirthdaysPage()`, `usePanels()`) that owns the `useState`+`useEffect`+error-toast plumbing, returning `{ data, loading, reload }`. This also removes the repeated `.catch((err) => showError(errorMessage(err)))` boilerplate that appears essentially verbatim in every page.

**2. (High) `ReactionRoles.tsx` is a god component (863 lines).**
`web/src/pages/ReactionRoles.tsx` — one component owns: panel list/selection state, the panel edit form, existing-message attach-mode parsing, mapping (option) CRUD with two different edit/add draft copies, reorder logic, and role/emoji cross-referencing helpers (`roleName`, `roleIsManageable`, `emojiDisplay`). Violates `engineering-principles.md`'s SRP guidance and `react.md`'s "No god components" red flag directly. Split into: a `usePanelEditor(panelId)` hook (form state + save/delete/send/sync), a `useMappingEditor(panel)` hook (add/edit/reorder mapping drafts), and presentational sub-components for the mapping row (currently duplicated inline for both the "editing" and "add new" cases — see DRY finding below).

**3. (Medium) Response-shape interfaces are hand-defined per route file instead of imported from a shared contract.**
`src/web/routes/memberAudit.ts:8-19` (`MemberAuditEntry`), `src/web/routes/registrations.ts:11-28` (`RegistrationEntry`), `src/web/routes/eventAttendance.ts:51-120` (`EventAttendanceMonthsResponse`, `EventSignupEntry`, `EventAttendanceEntry`, `EventAttendanceSummary`, `EventAttendanceListResponse`) each independently re-declare a shape that is *also* independently declared, field-for-field, in `web/src/types.ts` (`MemberAuditEntry`, `Registration`, `EventMonths`, `EventSignup`, `EventAttendance`, `EventAttendanceSummary`, `EventAttendanceListResponse`). Nothing enforces the two stay in sync — see the dedicated Types/Contracts finding below.

**4. (Low) `src/web/session.ts` and `src/web/auth.ts` are appropriately small and single-purpose** — no finding, called out as the pattern the rest of the layer should match (session cookie handling, RBAC gate factory, and OAuth flow are each a separate concern).

---

## DRY / magic values

**5. (High) Every mutating route hand-rolls `zod.safeParse` + `reply.code(400).send({ error: z.prettifyError(...) })` instead of using Fastify's schema validation.**
Present in `src/web/routes/commands.ts:21-22`, `birthdaySettings.ts:41-42,79-80`, `birthdays.ts:38-39,62-63`, `generalSettings.ts:44-45`, `eventAttendance.ts:258-259,325-326`, `reactionRolePanels.ts:142-143,161-162,238-239,265-266,300-301`. This is the same four-line block copy-pasted ~13 times. `fastify.md` explicitly calls this out: *"Don't hand-build `reply.code(400).send({error})` across routes — that scattered duplication is a known anti-pattern"* and prescribes attaching JSON Schema/TypeBox/zod **via a type provider** so validation runs automatically and one `setErrorHandler` produces the response. There is no `setErrorHandler` anywhere in `src/web` (confirmed via search — zero matches) and no type provider is registered, despite zod already being a dependency (`package.json`). Fix direction: register `fastify-type-provider-zod` (or equivalent), attach `{ schema: { body, params, querystring } }` to every route, and add one `app.setErrorHandler` that maps a `ZodError`/validation failure to a consistent 400 body — collapsing all ~13 call sites into config plus one handler.

**6. (High) Every `request.params`/`request.query` access is an unchecked cast, not validated input.**
`src/web/auth.ts:143`, `birthdays.ts:59,81`, `commands.ts:16`, `eventAttendance.ts:312,323,356`, `memberAudit.ts:38`, `reactionRolePanels.ts:65,261,284`, `registrations.ts:33,84,96` all do `request.params as { id: string }` (or similar) with zero runtime verification — this is exactly the "cast trap" from `types-and-contracts.md` ("An unchecked cast … asserts a shape with zero verification … at the exact boundary types are supposed to protect"), just applied to the request boundary instead of a query result. It happens to be low-risk today only because Fastify parses these as strings and the code re-validates numerically afterward (e.g. `Number.isInteger(id)`), but it's accidental safety, not designed safety — the same type-provider fix in finding 5 resolves this too (params/query schemas give typed, validated `request.params`/`request.query` for free).

**7. (Medium) `Settings.tsx` repeats the same channel/role-option-mapping literal five times.**
`web/src/pages/Settings.tsx:206,218,321,333` and the birthday page's `Birthdays.tsx:327,357` all repeat `channels.map((c) => ({ value: c.id, label: `#${c.name}` }))` (and the role equivalent at `Settings.tsx:142,154`) verbatim. This clears the Rule of Three several times over. Extract `toChannelOptions(channels)` / `toRoleOptions(roles)` helpers (e.g. in a small `web/src/utils/selectOptions.ts`) and use them everywhere a `SearchableSelect`/`RoleCheckboxList` is fed channel or role data — this also is the seam the "single-purpose channel-picker per field" pattern flagged in the task brief actually needs (the repetition is in the *option-mapping*, not in having many pickers — many distinct settings legitimately need their own picker, so the fix is a shared mapper, not fewer pickers).

**8. (Medium) `ReactionRoles.tsx` duplicates the entire mapping-row form (EmojiPicker + role picker + label input) between the "editing" and "add new" branches.**
Lines 638-696 (edit) and 732-787 (add) are near-identical JSX blocks differing only in which draft state (`editDraft` vs `mappingDraft`) they bind to and the trailing action buttons. `frontend.md`: *"Two components that differ only slightly … share a primitive plus a hook — never a duplicated block of markup."* Extract a `MappingForm` component parameterized by `draft`/`setDraft`/`onSubmit`/`submitLabel`.

**9. (Low) The `...(x !== undefined && { x })` partial-patch idiom is repeated field-by-field in both `birthdaySettings.ts:57-66` and `generalSettings.ts:68-82`.**
Not yet at the Rule-of-Three threshold, but a small `pickDefined(patch, keys)` helper would remove the boilerplate in both files without hiding the actual field list (`data-persistence.md`'s "extract the boilerplate, keep the queries explicit" applies equally here).

**10. (Low) 30 inline `style={{ ... }}` literals scattered across `web/src/pages/*.tsx` and `web/src/components/*.tsx`** (e.g. `Birthdays.tsx:167,184,196,227,306,396`, `ReactionRoles.tsx:439,494,607,797`, `SignupRow.tsx:35,37`) hardcode pixel margins/widths/colors instead of referencing `theme.css` tokens or a utility class. `theme.css` itself is well-tokenized (colors, radius, font all as custom properties) — this is the "half-tokenized system" `frontend.md` calls out as the common failure: the token system exists but individual components bypass it for one-off spacing. Not urgent, but worth sweeping into existing utility classes (`.row`, `.field`, etc. already exist in the stylesheet) or a couple of new small ones (`.mt-3`, `.max-w-90`) rather than continuing to hardcode.

---

## Types / contracts

**11. (Medium) `web/src/types.ts` and per-route response shapes in `src/web/routes/**` are drift-risk duplicates, not a disciplined mirror.**
As noted in finding 3: `MemberAuditEntry`, `Registration`/`RegistrationEntry`, `EventMonths`/`EventAttendanceMonthsResponse`, `EventSignup`/`EventSignupEntry`, `EventAttendance`/`EventAttendanceEntry`, `EventAttendanceSummary`, and `EventAttendanceListResponse` are each defined twice — once in `web/src/types.ts` and once locally in the corresponding `src/web/routes/*.ts` file — with identical field lists but zero shared import between them. `types-and-contracts.md`: *"Never redefine the same type in two layers … it lives in a shared contract module everyone imports."* Two separate runtimes (browser vs. Node) is a legitimate reason to have two `import`-able files, but nothing here derives one from the other or type-checks them against each other; a backend field rename or addition silently stops matching the frontend type with no compiler error on either side (TS only checks each file's own consistency, not cross-file equivalence). This is exactly the drift risk the task brief asked to assess, and it's real: recommend either (a) a shared `contracts/` package/directory imported by both `tsconfig` projects (cleanest, satisfies "one source of truth"), or at minimum (b) generating the Fastify response schema in each backend route (finding 5) and deriving the frontend type from that schema's output — which also closes finding 5/6 at the same time. `Panel`/`Mapping`/`GeneralSettings`/`BirthdaySettings`/`CommandDef` on the frontend do largely track their backend `serialize()` functions (`birthdaySettings.ts`, `generalSettings.ts`) the same way, so this is systemic across nearly every resource, not an isolated case.

**12. (Low) `src/web/mockDiscordClient.ts:113` uses `as unknown as BotClient`.**
A double-cast escape hatch (`types-and-contracts.md`'s "no escape hatches"). This one is dev-only mock infrastructure gated behind `devMockDiscord`, so the blast radius is small, but it's worth a one-line comment justifying why a full mock implementing every `BotClient` member isn't practical, if that's the reasoning — currently it reads as an unexplained cast.

---

## Security

**13. (High) No rate limiting anywhere in `src/web`.**
`grep` for `rate-limit`/`rateLimit` across `src/web` and `package.json` returns nothing — `@fastify/rate-limit` isn't installed or registered. `/auth/login`, `/auth/callback`, and every `POST`/`PATCH`/`DELETE` under `/api/*` (role approval, panel mutation, birthday CRUD, command toggles) are unthrottled. `backend-apis.md`: *"Rate-limit public writes with one shared utility."* The OAuth callback and login routes are the most exposed since they're reachable pre-auth. Fix: register `@fastify/rate-limit` once at the app level in `server.ts` (finding scope: this is a single registration, not a per-route change).

**14. (Medium) No `@fastify/helmet` / security headers beyond the one manual `Origin-Agent-Cluster` header.**
`src/web/server.ts:45-47` sets exactly one header by hand; there's no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no HSTS. `fastify.md`'s security baseline calls for `@fastify/helmet` plus a real CSP for any HTML surface (this app serves an SPA `index.html` — finding applies directly) and `backend-apis.md` lists HSTS/frame/content-type/referrer as the "standard hardening set." Fix: `await app.register(fastifyHelmet, { contentSecurityPolicy: {...} })` in `server.ts` alongside the existing `fastifyCookie`/`fastifyFormbody` registrations.

**15. (Medium) No explicit CSRF protection on state-changing routes beyond `SameSite=Lax`.**
Every mutating `/api/*` route (birthdays, panels, settings, member approval/removal, command toggles) relies solely on `SameSite: "lax"` (`session.ts:25`, `auth.ts:125`) to block cross-site requests; there's no CSRF token check and no same-origin/`Sec-Fetch-Site` verification on mutations. `backend-apis.md`: *"Credentialed cross-origin + cookies is a CSRF surface — lock allowed origins and check same-origin on mutations."* `SameSite=Lax` does block most cross-site POST/PATCH/DELETE in modern browsers (it only allows top-level GET navigations cross-site), which meaningfully reduces the risk, but it's not a substitute for an explicit check, and it offers no defense on older/misconfigured clients. Given the app already computes `resolveRequestOrigin()` in `auth.ts` for the OAuth flow, the same helper could gate `onRequest` for `/api/*` mutations (reject if `Origin`/`Referer` doesn't match an allowed public URL) as a cheap, high-value addition.

**16. (Low) No `@fastify/cors` registered — but this is very likely correct, not a gap.**
No CORS package appears anywhere, which is fine given the SPA and API are served from the same origin and `api.ts` always calls same-origin relative paths (`fetch(\`/api${path}\`, { credentials: "same-origin" })`). Flagging only so this reads as a deliberate absence rather than an oversight — `fastify.md`'s baseline lists CORS "locked to known origins" as a checklist item, but a same-origin-only app has no CORS surface to lock down. No action needed unless a separate origin is ever added.

**17. (Low) `/auth/dev-login` mock login route is registered inside the same `registerAuthRoutes` function as production routes, gated only by `config.devMockDiscord`.**
`src/web/auth.ts:90-109`. The gating is correct and well-commented, and it mirrors a flag the rest of the bot already uses — no functional issue — but `backend-apis.md`/`fastify.md`'s "keep apps with different threat models separate" is worth a note: if `devMockDiscord` were ever accidentally true in a production config, this route grants unauthenticated bot-owner access. Since `startWebServer`'s doc comment says `config.web` is only set once `loadConfig()` validates required env vars, confirm (in the bot-side review, since `config/index.ts` is out of this scope) that `devMockDiscord` can't independently be true when `NODE_ENV=production` — this route's safety is entirely inherited from that guarantee.

---

## React-specifics

**18. (Medium) `errorMessage(err)` + `showError` pattern is repeated in nearly every async handler instead of being centralized in a fetch wrapper.**
This is the flip side of finding 1: once a `useXxx()` hook layer exists, the `.catch((err) => showError(errorMessage(err)))` boilerplate (appears 20+ times across pages) collapses into the hook's own error handling, consistent with `react.md`'s hook-centralization guidance.

**19. (Low) `EventAttendance.tsx:52` has an `eslint-disable-next-line react-hooks/exhaustive-deps`.**
A suppressed lint rule is exactly what `types-and-contracts.md`'s "no escape hatches" principle warns about, even though it's a lint suppression rather than a type one, and the accompanying comment does explain the intent (debounce effect that must not re-fire when `setSearchParams` changes identity). Low severity since the reasoning is documented and correct, but a `useRef`-based debounce hook would remove the need for the suppression entirely.

**20. (Low) No global `ErrorBoundary`.**
`react.md`: *"Error boundaries around render-error-prone subtrees."* `App.tsx` renders `<Routes>` directly with no boundary — an uncaught render error in any page takes down the whole dashboard shell (including navigation) instead of just that page's content.

---

## Fastify-specifics

(Most Fastify findings are covered above under DRY #5/#6 and Security #13/#14/#15, since they're really one root cause — no schema/type-provider adoption. Two additional items:)

**21. (Low) Routes are organized as one flat `registerApiRoutes` composing ten `register*Routes(app, ...)` functions (`src/web/routes/index.ts:20-36`), not as encapsulated Fastify plugins.**
This works fine at the current size and does keep each domain in its own file (good), but `fastify.md`'s "Encapsulated plugins are the boundary system" suggests each `register*Routes` could be wrapped as its own `fp()`-free plugin (`app.register(async (sub) => {...}, { prefix: "/birthdays" })`) to get Fastify's built-in encapsulation (independent hooks/decorators per domain) instead of relying on manual discipline. Not urgent — no evidence of leakage today — but worth doing opportunistically if any route starts needing route-group-specific hooks.

**22. (Low) Structured logging exists (`utils/logger.js`, Pino-based per `fastify.md` conventions) and is used consistently (`logger.warn`/`logger.error` throughout every route file) — no `console.log` found in `src/web`.** Called out as a positive, not a finding.

---

## Other

**23. (Info) `src/db/index.ts`'s in-file array-of-functions migration style (noted in the task brief) is out of this review's depth per scope, but it is directly visible from `src/web` in one place worth flagging here: none of the route files add a migration when `serializeBirthdaySettings`/`serialize` (generalSettings) shapes change — settings columns are added straight to the existing `getSettings()`/`updateSettings()` object.** This is a data-persistence-layer concern more than a web-layer one; flagging only so the bot-side reviewer correlates it with these two call sites (`birthdaySettings.ts:24-35`, `generalSettings.ts:22-38`) if they assess schema evolution safety.

---

## Priority recap (highest impact first)

1. Adopt a Fastify zod type-provider + one `setErrorHandler` across all of `src/web/routes/**` (findings 5, 6) — collapses ~13 duplicated validation blocks and closes the unchecked-params-cast gap in one move.
2. Extract a custom-hook layer on the frontend (`useXxx()` per resource) to close finding 1 and, as a side effect, 18.
3. Split `ReactionRoles.tsx` into a couple of hooks + a shared `MappingForm` component (findings 2, 8).
4. Register `@fastify/rate-limit` and `@fastify/helmet` in `server.ts`, and add an origin check on `/api/*` mutations (findings 13, 14, 15).
5. Decide on one source of truth for the ~7 duplicated response shapes between `web/src/types.ts` and `src/web/routes/**` (finding 11) — ideally derived from the same schemas introduced in item 1.
