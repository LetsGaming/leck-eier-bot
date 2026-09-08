---
target: leck-eier-bot dashboard — all user-facing pages
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-09-08T11-09-07Z
slug: leck-eier-bot-dashboard-all-user-facing-pages
---
Method: dual-agent (A: general-purpose design-review sub-agent `aabb78bd` · B: general-purpose detector/browser-evidence sub-agent `a7dea28f`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Per-card "Ungespeicherte Änderungen"/spinner-label now live on Settings and Birthdays. Docked: Reaction Roles' "Änderungen speichern" is always enabled — no signal there's anything to save. |
| 2 | Match System / Real World | 3 | "Rang"/"Mindestrang"/"Bot-Team-Rang" fully purged from the frontend, replaced by a clearly-explained "Berechtigungsstufe" vs. "Rolle" split. Docked: `formatRelative()` prints "vor 0M, 1T und 0Std" — Discord's own relative-time convention never shows a zero unit. |
| 3 | User Control and Freedom | 3 | New navigation guard (`UnsavedChangesContext`) blocks both in-app `<Link>` nav and browser `beforeunload`, live-verified. Docked: that protection doesn't reach Reaction Roles. |
| 4 | Consistency and Standards | 2 | Prior "three incompatible save models" is now "two unified, one left as-is (Commands' autosave, which is internally fine), one newly divergent (Reaction Roles, which looks identical to the two fixed pages but behaves like the old broken model)." |
| 5 | Error Prevention | 3 | Tiered `requireText` type-to-confirm on the two most catastrophic actions is well-judged, not indiscriminate. Docked: Reaction Roles' "Nachricht senden" — a live, public Discord post — has zero confirmation step. |
| 6 | Recognition Rather Than Recall | 4 | SearchableSelect combobox pattern used uniformly everywhere; every template field has a live preview before commit. Detector corroborates zero source-level anti-patterns. |
| 7 | Flexibility and Efficiency | 3 | Advanced/simple cron toggle, debounced search throughout. No bulk actions, acceptable at current scale. |
| 8 | Aesthetic and Minimalist Design | 3 | Type-scale tokens now consistently applied; Settings→Registrierung's card grid confirmed 2-column (was 4). Docked: the grid still pairs mismatched-height cards, leaving a live ~300px void. |
| 9 | Error Recovery | 3 | Toast errors surface backend messages on every observed failed mutation; not adversarially tested this pass. |
| 10 | Help and Documentation | 3 | Inline hints remain extensive and product-specific; no searchable help, but the persona likely doesn't need one at this scale. |
| **Total** | | **30/40** | **Good — up from 18/40 three hours ago; a real, substantive improvement, not cosmetic polish** |

## Design Specificity Verdict

**LLM assessment:** More decisively authored-for-this-product than at the prior audit, not less. The domain vocabulary (Ankernachricht, Auswahltyp, Apollo-Event-Kanal), the pixel-accurate Discord message-preview mockups, and per-field hints written from the bot-admin's side of the boundary are genuine product thinking, not admin-panel boilerplate. The name-resolution fix in particular is systemic (`useMemberNames`/`/members/resolve`) rather than a spot-patch of the one place the last critique happened to look.

**Deterministic scan:** `detect.mjs --json web/src` returns **0 findings**, exit 0 — clean. Live browser-injected scan across 6 routes found real signal concentrated on two things: (1) a genuine `line-length` hit on `Commands.tsx`'s `p.muted` (~217 chars/line — this paragraph is missing the `.small` modifier that gives sibling paragraphs a 60ch max-width elsewhere in the codebase, confirmed in source, **not previously flagged**), and (2) a `gpt-thin-border-wide-shadow` hit on the SearchableSelect popover (a real but minor styling match, not a bug). The rest — `overused-font` (single system-font stack by design for an admin tool), `text-occlusion` on the template-editor highlight layer (the intended transparent-textarea-over-styled-div technique), and `all-caps-body` on stat-tile/table-header labels (deliberate design-system convention) — are all corroborated false positives, independently confirmed by direct source inspection.

**Independent corroboration:** Both assessments, working in isolation, converged on the same verdict for the P0 event-attendance popover: Assessment A found it portal-rendered and working via live click-through; Assessment B independently measured its DOM bounding rect and confirmed it sits fully inside the viewport with `overflow: visible`. Two different methods, same conclusion — this fix is solid, not just visually plausible.

## Overall Impression

This is a real fix pass, not a repaint. The single most consequential bug from three hours ago — a task the app's own front-door alert pointed straight into, that was completely undoable — now works, and works for the right engineering reason (scroll-aware portal positioning), not a lucky CSS tweak. Raw Discord IDs are gone from the one place they hurt most (an irreversible-delete confirmation), backed by a real bulk-resolve endpoint used consistently, not patched at the one call site a reviewer happened to check. The terminology collision that would have actively worked against this persona's Discord fluency is fully resolved with an explicit inline explanation of the two-tier-systems problem.

The one place this pass fell short is instructive rather than damning: the team built the *right* primitive (`useUnsavedChanges` + per-card dirty mirrors) and proved it twice, correctly, then didn't reach the fourth save surface — Reaction Roles — which is the page with the highest real-world stakes (it posts live, public content to Discord) and now looks *more* dangerous than before by comparison, because it visually promises the same safety the persona just experienced on two other pages and doesn't deliver it. That's the single biggest opportunity left: not a new problem, but the exact class of problem this session already knows how to fix, applied to one more file.

## What's Working

1. **The popover fix is engineered, not patched.** Portal-to-`document.body`, `getBoundingClientRect()`-based fixed positioning, a capture-phase scroll listener specifically because nested `.table-scroll` events don't bubble, and flip-above-when-no-room-below logic — independently verified two different ways (interaction + DOM measurement).
2. **Name resolution is systemic.** A real `/members/resolve` bulk endpoint backs Birthdays' delete dialog, Overview's activity feed, and event attendance uniformly — this was the exact kind of thing that could have been a one-off patch and wasn't.
3. **The dirty-state pattern that shipped is correctly scoped, not decorative.** Editing one card's field live-verified to leave a neighboring card's save button untouched; the nav guard fires on both in-app routing and native `beforeunload`.

## Priority Issues

**[P1] Reaction Roles' panel editor was left out of the save-model unification — it now silently discards edits on a page that posts live, public Discord messages.**
- Why it matters: `ReactionRoles.tsx`/`usePanelEditor.ts` have no `useUnsavedChanges` call and no dirty tracking (confirmed by grep). Live-verified: typing into the message body, then clicking a sidebar link, discards the edit with zero warning. This page looks identical in shape to Birthdays and Settings (text field + "Speichern" button), so the persona has every reason from her fresh experience elsewhere in this same app to expect the same protection — and silently doesn't get it, on the one page where the consequence of an unnoticed loss is a stale message going out to a real server.
- Fix: Apply the same `savedX`/dirty-mirror pattern already proven on Settings.tsx and Birthdays.tsx to `usePanelEditor`'s form state; wire `useUnsavedChanges(formDirty || mappingsDirty)`.
- Suggested command: `/impeccable harden`

**[P2] Settings→Registrierung's card grid is 2 columns now (down from 4), but still pairs mismatched-height cards and leaves a live, visible void.**
- Why it matters: "Rollen im Registrierungsablauf" and its row-partner "Registrierungsformular" differ enough in content length that ~300px of empty bordered space sits next to the shorter card. The prior root cause — grid pairing by arrival order, not content length — is narrower now but not resolved.
- Fix: `grid-auto-flow: dense` re-ordering, or pair by content length, or accept the whitespace with `align-self: start` instead of a bordered empty-looking card shape.
- Suggested command: `/impeccable polish`

**[P2] `Commands.tsx`'s intro paragraph runs ~217 chars/line — genuinely missing a max-width modifier the codebase already uses elsewhere.**
- Why it matters: Detector-caught and source-confirmed: sibling `.muted` paragraphs elsewhere get `.small` (60ch max-width); this one doesn't. Newly surfaced this pass — not previously flagged, not a false positive.
- Fix: Add the `.small` modifier (or equivalent max-width) to the paragraph in `Commands.tsx` around line 106-108.
- Suggested command: `/impeccable typeset`

**[P3] Reaction Roles' "Nachricht senden" carries the same real-world stakes as the app's type-to-confirm actions but gets zero confirmation.**
- Why it matters: Sending posts live, publicly-visible Discord content immediately on click. A recoverable action (deleting a birthday entry) gets a modal; this irreversible, org-visible action gets none — an inconsistent risk tier.
- Fix: Add at minimum a plain `confirmDialog` before `handleSend`.
- Suggested command: `/impeccable harden`

**[P3] `formatRelative()`'s zero-unit output doesn't match this persona's Discord-native mental model of relative time.**
- Why it matters: "vor 0M, 1T und 0Std" appears throughout Overview and Member Audit. Discord's own relative timestamps never show a zero-value unit and collapse to the single most relevant one; this reads as a debug artifact to a fluent Discord user, undercutting the otherwise strong "built for this product" feel.
- Fix: Suppress zero-value leading/trailing units in `dateFormat.ts`.
- Suggested command: `/impeccable polish`

## Persona Red Flags

**Casey (Discord moderator, fluent in Discord/social media, zero prior exposure to this dashboard, zero code literacy):**

- **Übersicht**: names resolve cleanly, no raw IDs. The "vor 0M, 1T und 0Std" phrasing would still read as unfinished/machine-generated to her — she's never seen Discord itself talk this way.
- **Geburtstage**: clean. The delete confirmation now names the person ("Der Eintrag für Ehemalige Person wird unwiderruflich entfernt…") — exactly the reassurance she needed before an irreversible action, and it's there now.
- **Event-Anwesenheit**: the picker that was a hard dead end three hours ago now opens a full, scrollable, typeable list with real names. This is the single biggest experiential win of this pass — a task that was previously not just confusing but literally impossible now just works.
- **Befehle**: "Mindest-Berechtigungsstufe" is now explicitly explained as independent from Discord's own role system — the exact confusion that would have collided with her existing fluency is defused inline.
- **Reaktionsrollen**: this is where she'd get burned today. The page looks and behaves like Birthdays/Settings (field + Speichern button), so she'd assume the same "don't lose my edit" safety net applies — it doesn't, and she'd only find out later when the edit simply isn't there, with no explanation.
- **Settings→Registrierung**: the per-card save model now matches her mental model of "each box is its own form" — a real win. She'd still take a beat on "Rolle vor der Registrierung" vs. "Rolle nach der Registrierung" (both say "Rolle"), but the inline hints resolve it, and critically it's naming an actual Discord role correctly now, not conflating it with the bot's internal tier.

## Minor Observations

- The Member Overview page shows the raw snowflake ID as small `<code>` metadata *beneath* the resolved display name — this is fine (mirrors Discord's own "Copy ID" dev-mode convention with the name clearly primary), not a recurrence of the raw-ID problem.
- Commands.tsx's per-command "Standard: …" hint (showing the default gate) is a nice, underused pattern for reducing "what happens if I don't touch this" anxiety — worth reusing elsewhere.
- Reaction Roles' `#1` list-item ID prefix is mildly technical but low-stakes (internal list, not member-facing).
- No mobile/narrow-viewport testing was done this pass; dedicated CSS for it exists but wasn't live-verified.
- Detector's `overused-font`, `text-occlusion`, and `all-caps-body` hits are all confirmed false positives / context mismatches (single-font admin tool by design, intended transparent-textarea-over-highlight technique, deliberate uppercase label convention) — worth adding to `.impeccable/critique/ignore.md` if they keep resurfacing on future runs, since both this run and the prior one independently flagged and dismissed the same three.

## Questions to Consider

- The team proved the dirty-state/guard primitive works correctly twice in one session. What made Reaction Roles fall outside that pass's scope — was it not recognized as the same save-model shape, or just not gotten to yet?
- Now that the highest-severity item (P0 popover) is fixed with real scroll-aware positioning logic, is there a systematic way to check for other absolutely-positioned-inside-overflow instances, rather than fixing them one report at a time?
- `formatRelative()`'s zero-unit math is clearly a deliberate, commented design choice — was it ever checked against how Discord itself phrases relative time for this exact audience?
