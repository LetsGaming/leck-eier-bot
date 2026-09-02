---
target: whole dashboard app
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-02T21-01-21Z
slug: web-dashboard-app
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/toast states exist broadly; no per-row pending indicator on some save/link actions |
| 2 | Match System / Real World | 4 | Speaks Discord-admin domain fluently (RSVP terms, role/message concepts explained in place) |
| 3 | User Control and Freedom | 2 | No undo anywhere; destructive deletes gated only by native `window.confirm()` |
| 4 | Consistency and Standards | 2 | Commands.tsx uses raw checkboxes while every other page uses the custom `.switch` toggle |
| 5 | Error Prevention | 2 | Birthday day/month and font-map fields have no visible validation until after submit |
| 6 | Recognition Rather Than Recall | 3 | Inline hints under most fields; SearchableSelect reduces recall burden for long lists |
| 7 | Flexibility and Efficiency | 1 | No bulk actions, no keyboard shortcuts, no persisted filters — applies fully, data-heavy Operate tool |
| 8 | Aesthetic and Minimalist Design | 3 | Mostly clean card/grid layout; Settings and event cards get text-dense |
| 9 | Error Recovery | 2 | Toasts carry backend error text but no `aria-live`, so errors can be visual-only |
| 10 | Help and Documentation | 1 | No in-app help/tooltips/onboarding for genuinely complex domain logic (Apollo linking, attach modes) |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment**: Not a templated CRUD scaffold. The Discord-native palette matches Discord's own dark theme exactly, `MessagePreview` live-renders a fake Discord message so admins can WYSIWYG-check panels before sending, and the severity-tier badge system was clearly built around Apollo's specific late/no-show/early-leave semantics rather than a generic status enum. German copy throughout is instructional and specific, not boilerplate. That said, the layout skeleton (sidebar nav, card grid, stat tiles, table+badge) is generic-admin-panel shape, and several controls (SearchableSelect, the pill toggle, toasts) are from-scratch reimplementations of standard components with no shared interaction language beyond color tokens.

**Deterministic scan**: `detect.mjs --json` against `web/src` returned exit code 2, **1 finding**: rule `side-tab` (Side-tab accent border) on `web/src/theme.css:637`, `.message-preview-embed { border-left: 4px solid var(--accent); }`. This is a **confirmed false positive** — that class is part of the intentional Discord-embed-mimicry styling in `MessagePreview` (Discord embeds genuinely have a colored left border), the same known deliberate pattern already on record for this codebase. No other findings anywhere in the tree. This near-clean deterministic result is consistent with the LLM verdict of low generic-slop risk.

**Visual overlays**: Only the unauthenticated Login page was reachable (the backend requires real Discord OAuth credentials and crashed on a placeholder token, so gated pages — Overview, Settings, MemberAudit, EventAttendance, Birthdays, ReactionRoles, Commands — could not be visually inspected live this run). Injection succeeded on the Login page: `[impeccable] No anti-patterns found.` No user-visible overlay persists now; the live server was stopped after evidence gathering.

## Overall Impression

The app is genuinely built for this product — the Apollo severity-tier model, the message-preview-before-send pattern, and the German domain copy show real authorship, not a scaffold. But the interface treats every action as equally low-stakes: irreversible deletes (an Apollo event with all its attendance history, a registration entry) get the same native `confirm()` and the same green toast as a cosmetic settings save. For a tool where the audience is small and trusted but the mistakes are genuinely costly (wiped history, wrong registration role granted), the biggest opportunity is closing the gap between what's actually high-stakes and what the UI visually treats as high-stakes — plus fixing that the app's primary relational control (SearchableSelect, used on nearly every config field) is currently unusable without a mouse.

## What's Working

1. **MessagePreview component** — live-renders a literal fake Discord message (avatar, bot tag, embed, reaction pills) before an admin sends a reaction-role panel or birthday announcement to the whole server. This catches an entire class of "I just posted something ugly to 500 people" mistakes, and no generic admin-panel template gives you this for free.
2. **Independent lateness/early-leave severity badges** in EventAttendance — late-arrival and early-leave are modeled and shown as two separate facts rather than collapsed into one "worst wins" status, correctly reflecting that both can be true for the same signup.
3. **Responsive table-to-card transformation** (`theme.css:1072-1139`) is a real `data-label`-driven restructuring, not just horizontal scroll, applied consistently across MemberAudit, EventAttendance, Birthdays, and Commands — unusually thorough for an internal tool.

## Priority Issues

**[P0] Destructive actions rely solely on native `window.confirm()`, with no friction scaled to the damage.**
- **Why it matters**: Deleting an Apollo event wipes all its signups and attendance history, permanently, with no undo — and it gets the exact same one-click OS dialog as any trivial action (`MemberAudit.tsx:41`, `EventAttendance.tsx:234`, `ReactionRoles.tsx:237-241`). A fat-fingered click destroys data with zero recovery path.
- **Fix**: Replace `confirm()` with an in-app modal, themed consistently with the rest of the app, that requires typing the event/entry name (or an explicit "yes, delete" step) for irreversible multi-row deletes.
- **Suggested command**: `/impeccable harden`

**[P1] SearchableSelect — the app's primary relational picker — has no keyboard/ARIA support.**
- **Why it matters**: Used on nearly every config field (roles, channels, members, voice channels, event linking), this from-scratch combobox has no `role="combobox"`/`listbox`, no `aria-expanded`/`aria-activedescendant`, and no arrow-key navigation — only mouse click or typed filtering works. A keyboard-only or screen-reader admin cannot operate most of the app's configuration surface.
- **Fix**: Add standard combobox ARIA roles and keyboard handling (arrow keys, Enter, Escape), or fall back to a native `<select>` + `<datalist>` filter.
- **Suggested command**: `/impeccable audit`

**[P1] Toast notifications are not announced to assistive tech.**
- **Why it matters**: `.toast-container` has no `aria-live`/`role="status"`. Every save confirmation and error — often the *only* feedback a form gives — is visual-only for a screen-reader user.
- **Fix**: Add an `aria-live="polite"` (or `"assertive"` for errors) region to the toast container.
- **Suggested command**: `/impeccable harden`

**[P2] Inconsistent toggle pattern for equivalent controls.**
- **Why it matters**: `Commands.tsx` uses raw native checkboxes for "Aktiviert"/"Nur auf Server" while every other boolean control app-wide (Settings, Birthdays, ReactionRoles, EventAttendance) uses the custom pill `.switch`. Commands is likely the page admins visit most for quick on/off changes, and it's the one page that looks like a different app.
- **Fix**: Swap the raw checkboxes for the shared `.switch` component.
- **Suggested command**: `/impeccable polish`

**[P3] Overview's quick-access omits the two newest, highest-stakes features.**
- **Why it matters**: `Overview.tsx:59-70` links to reaction-roles, birthdays, and commands, but not Mitgliederprüfung (pending registrations needing approval) or Event-Anwesenheit (Apollo signups needing manual "unmatched"/"ambiguous" resolution). There's no badge/count anywhere in the shell to signal outstanding work, so an admin can land on Overview with pending items and get no signal that action is needed.
- **Fix**: Add both to Overview's quick-access, and surface pending/unmatched counts as a badge.
- **Suggested command**: `/impeccable layout`

## Persona Red Flags

**Alex (Power User)**: No bulk operations anywhere — approving registrations, linking Apollo signups, and managing birthday entries are strictly one-row-at-a-time with a full reload after each action. No keyboard shortcuts. Search/filter state resets on remount in MemberAudit and EventAttendance. ReactionRoles' panel-creation flow is an 850-line single-file form requiring several simultaneous mode-dependent decisions with no stepper — high abandonment/error risk for the app's most complex flow.

**Sam (Accessibility-Dependent User)**: SearchableSelect (the primary picker across the app) has no ARIA roles or keyboard list navigation — blocks most of the configuration surface for keyboard-only use. Toasts carry no `aria-live` region, so save confirmations and errors are silent to screen readers. Custom popovers (SearchableSelect, EmojiPicker) don't appear to manage focus trapping/return on open/close.

## Minor Observations

- The same `.warn` (amber) badge color is reused for "mild lateness," "pending registration," and "Vielleicht RSVP" across different pages — same visual signal, three different meanings, disambiguated only by surrounding copy.
- EventAttendance's "Nur Probleme anzeigen" filter runs client-side *after* the paginated server fetch, so it can show 0 results on one page while problems exist on another page — a filter/pagination interaction worth a closer look (`EventAttendance.tsx:252-276` vs `206-214`).
- Birthdays' day/month entry fields are plain number inputs with no format hint, inconsistent with the DD.MM convention used everywhere in read views.
- Login page copy undersells the app, naming only reaction-roles/birthdays/commands and omitting the higher-stakes registration and event-attendance modules.

## Questions to Consider

- If deleting an Apollo event is genuinely irreversible, why does it carry the same confirmation weight as a low-stakes toggle — has anyone estimated the cost of the first accidental delete?
- Is there a keyboard-only admin on this mod team today? If so, has configuring a reaction-role panel without a mouse ever actually been tried?
- Was a stepper/wizard considered for the reaction-roles editor, or did it grow into an 850-line single-file flow one field at a time?
