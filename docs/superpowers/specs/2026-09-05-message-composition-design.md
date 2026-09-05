# Shared message composition: token parser, inline channel picker, live preview

## Context

Every feature that sends a user-facing templated message reimplements its own tiny template engine:

- `src/services/birthdays.ts` — `renderBirthdayTemplate()`/`buildBirthdayMessage()`/`buildAnchorParts()` each do their own `.replace(/{token}/g, ...)` chains for `{userMention}`, `{everyoneMention}`, `{userNick}`, `{month}`, `{entries}`, then separately call `applyFont()`.
- `src/services/reactionRoles.ts` — `buildPanelText()`/`buildPanelEmbed()` build message bodies inline and call `applyFont()` themselves; the web mirror `web/src/components/MessagePreview.tsx` duplicates that formatting logic client-side ("Mirrors — but does not literally share... Keep the two in sync if that formatting ever changes").
- `src/events/registerWatcher.ts` — `renderConfirmation()` substitutes `{roleChannel}` (a hardcoded channel-mention placeholder tied to the single `roleSelectionChannelId` setting) and calls `applyFont()` again.

`applyFont()` (`src/utils/font.ts`) is the only piece that's actually shared. Everything else — token substitution, and the decision of *when* to call `applyFont` relative to substitution — is duplicated three times with three different token vocabularies.

Separately, any feature that wants to reference a channel in a message needs a dedicated settings field (`registerChannelId`, `roleSelectionChannelId`, `apolloEventChannelId`, `eventVoiceChannelId` in `src/types.ts`), each rendered as its own `SearchableSelect` dropdown in `web/src/pages/Settings.tsx`. This doesn't scale: mentioning N channels in one message needs N dedicated dropdowns, fields, and settings-schema entries.

Preview UX is also inconsistent: `web/src/pages/ReactionRoles.tsx` uses `MessagePreview.tsx`, a live-updating component that correctly applies `useFont`/`fontMap`. `web/src/pages/Birthdays.tsx` instead has a "Vorschau" **button** (`handlePreview()`) that fetches a one-shot server-rendered string via `api.previewBirthday()` and displays it as raw text — never passing it through font styling client-side, so the preview does not reflect `useFont`.

This spec unifies all of the above into one shared system, used by all three existing message spots (birthdays, reaction-role panels, registration) and by any future one.

## Scope

In scope:
- A shared token-rendering engine, backend (source of truth) and a web-side mirror for live preview.
- Core tokens (channel/user/role mention, date) resolvable anywhere, via a registry.
- Feature-specific tokens (`{month}`, `{entries}`, etc.) passed per-call as a context object — these are *not* promoted to the core registry.
- An inline `#`-triggered channel-mention picker inside a shared `TemplateEditor` textarea component, inserting Discord's native `<#channelId>` mention syntax.
- A shared `TemplatePreview` component: always live (no fetch-on-click), always respects `useFont`/`fontMap`, replacing both `MessagePreview.tsx` and the Birthdays preview-button flow.
- Migrating `birthdays.ts`, `reactionRoles.ts`, `registerWatcher.ts` (backend) and `Birthdays.tsx`, `ReactionRoles.tsx`, the registration section of `Settings.tsx` (web) onto the shared engine/components.

Out of scope (deferred, explicitly not built here):
- `@`-triggered user/role inline mention picker. `TemplateEditor` is designed so this can be added later without rework, but no current template needs it, so it isn't built now.
- DB-backed, named, cross-feature-reusable template storage/CRUD (i.e. a full "template library" feature). Templates remain per-feature settings fields; only the *rendering mechanism* and *editor/preview UI* become shared.
- Any change to the fixed operational-channel settings fields (`registerChannelId`, `apolloEventChannelId`, `eventVoiceChannelId`, etc.) — those stay single-select `SearchableSelect` dropdowns, since they configure *which channel the bot operates in*, not content mentioned inside a message.

## Token engine (backend, source of truth)

New file `src/shared/messageTemplate.ts`:

```ts
export type TemplateContext = Record<string, string>;

export interface RenderOptions {
  useFont: boolean;
  fontMap: string | null;
}

/** Resolves a single {token} against Discord entity data available at render time. */
export type CoreTokenResolver = (id: string) => string;

export interface CoreResolvers {
  channel?: CoreTokenResolver; // {channel:<id>} -> <#id>
  user?: CoreTokenResolver;    // {user:<id>} -> <@id>
  role?: CoreTokenResolver;    // {role:<id>} -> <@&id>
}

export function renderTemplate(
  template: string,
  context: { styled?: TemplateContext; raw?: TemplateContext },
  core: CoreResolvers,
  options: RenderOptions,
): string;
```

Resolution order fixes a latent question the old per-feature code answered inconsistently: `buildAnchorParts()` applies font to `{month}`'s value before substitution "deliberately" per its own comment, since `applyFont` only maps plain Latin letters and mention/emoji text must not be font-mapped. The engine formalizes this as two context buckets:

1. Font-map the template's literal text and every `styled` context value independently, then substitute `styled` tokens into the font-mapped template.
2. Substitute `raw` context values and all core-registry tokens (`{channel:id}`, `{user:id}`, `{role:id}`, `{date}`) into the result unstyled, always after step 1 — core tokens resolve to Discord mention syntax (`<#id>`, `<@id>`, `<@&id>`) which must never pass through font mapping.

`{month}` is `styled` (font-mapped, matching current behavior); `{userMention}`, `{everyoneMention}`, `{userNick}`, `{entries}` are `raw` (contain mention text, never font-mapped) — matching current behavior exactly, just centralized.

Core token registry (`channel`, `user`, `role`, `date`) is a fixed small set built into `messageTemplate.ts` itself; callers supply resolver functions (backed by Discord.js client lookups on the bot side) rather than the engine reaching into `discord.js` directly, keeping the module dependency-free and testable in isolation.

## Web-side mirror

New `web/src/utils/messageTemplate.ts` — mirrors `renderTemplate`'s substitution logic (not a shared import; bot and web are separate runtimes, matching the existing documented pattern in `MessagePreview.tsx`). Core resolvers here are backed by the `channels: Channel[]` data pages already load via `api.channels()` (channel → `#name` label instead of a real Discord mention render, since the web preview is a mockup, not real Discord — consistent with `MessagePreview`'s existing "rough, non-pixel-perfect mockup" framing). No live user/role resolution needed since `@` mentions are out of scope this pass.

## `TemplateEditor` component

New `web/src/components/TemplateEditor.tsx`:

```ts
interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  channels: Channel[];
  placeholder?: string;
  id?: string;
}
```

Wraps a `<textarea>`. On typing `#`, opens a popover (reusing `SearchableSelect`'s filtering/keyboard-nav internals, anchored at cursor position instead of below a trigger button) listing `channels`; selecting one inserts `<#channelId>` at the cursor and closes the popover. Built so an `@` trigger (users/roles) can be added later as another registered trigger character without restructuring the component — but only `#` is wired up now.

## `TemplatePreview` component

New `web/src/components/TemplatePreview.tsx`, replacing `MessagePreview.tsx` and Birthdays' preview-button flow:

```ts
interface TemplatePreviewProps {
  template: string;
  context: { styled?: Record<string, string>; raw?: Record<string, string> };
  channels: Channel[];
  useFont: boolean;
  fontMap: string | null;
}
```

Always live — re-renders on every keystroke via the web-side `renderTemplate` mirror, no fetch, no button. `ReactionRoles.tsx`'s existing panel-shape-specific chrome (embed vs. text, reactions/buttons/dropdown mockup) stays in `ReactionRoles.tsx` itself, calling `TemplatePreview` for just the token-resolved text/title portions — `MessagePreview.tsx` is retired, its panel-shape rendering folded into `ReactionRoles.tsx` as the one remaining caller.

A "Vorschau" **toggle** (checkbox/switch) replaces the old preview button anywhere one existed (Birthdays), controlling whether `TemplatePreview` is rendered at all — not whether it fetches.

## Migration of existing features

**`src/services/birthdays.ts`**: `renderBirthdayTemplate()`, `buildBirthdayMessage()`, `buildAnchorParts()` become thin wrappers calling `renderTemplate()` with `{ userMention, everyoneMention, userNick }` → `raw` context (all three are mention text) and `{ month }` → `styled` context (plain text, per the existing deliberate ordering), `{ entries }` → `raw`. `web/src/pages/Birthdays.tsx`: delete `handlePreview()`, `preview` state, and `api.previewBirthday()`; render `<TemplateEditor>` for the template textareas and `<TemplatePreview>` gated by a new `showPreview` toggle.

**`src/services/reactionRoles.ts`**: `buildPanelText()`/`buildPanelEmbed()` route their text/title substitution through `renderTemplate()` (panels currently have no feature-specific tokens beyond mappings' own labels, which stay as-is — mapping rendering, e.g. the reaction-emoji list, remains panel-shape logic, not a token). `web/src/pages/ReactionRoles.tsx` swaps its template inputs for `<TemplateEditor>` and its use of `MessagePreview` for `TemplatePreview` plus its own retained shape-specific chrome (per above).

**`src/events/registerWatcher.ts`**: `renderConfirmation()` (used for both `settings.registerConfirmationTemplate` and `settings.autoRegisterConfirmationTemplate`, per `Settings.tsx`'s confirmation-template fields) becomes a `renderTemplate()` call. `{name}` moves to `raw` context (registrant's display name, not font-mapped today either — `renderConfirmation` never wraps it in `applyFont`). `{roleChannel}` stops being a pre-formatted string baked in before substitution and becomes `{channel:<roleSelectionChannelId>}` resolved through the core `channel` resolver at render time — the *setting* `roleSelectionChannelId` still exists (it's how the fallback text "dem Rollen-Kanal" and legacy `{roleChannel}` token are populated), but new templates reference channels through the generic core-token mechanism. `web/src/pages/Settings.tsx`'s two confirmation-template fields become `<TemplateEditor>` instances with `#`-picker support, letting staff type `<#channelId>` for *any* channel directly in the message body — not only the one wired to `roleSelectionChannelId`.

## Testing

- Backend: unit tests for `renderTemplate()` covering core-token resolution, `styled` vs `raw` context ordering relative to `applyFont`, unknown/missing token handling (left as literal `{token}` text, matching current `.replace()` behavior of no-op on unmatched patterns), and each migrated feature's specific token set (birthdays' three call sites, reaction roles, registration).
- Frontend: manual browser verification (no existing component-test harness in `web/`) of `TemplateEditor`'s `#` popover (insertion at cursor, filtering, keyboard nav via reused `SearchableSelect` internals) and `TemplatePreview`'s live update + font-toggle behavior on all three migrated pages.
- Regression check: for each of the three migrated features, compare actual bot-sent Discord message output before/after migration with an identical template+context, to confirm `renderTemplate` reproduces prior `.replace()`-chain output byte-for-byte.
