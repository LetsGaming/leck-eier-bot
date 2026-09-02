---
target: whole dashboard app
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-09-02T22-28-25Z
slug: web-dashboard-app
---
## Design Health Score

| # | Heuristic | Score | Key Issue (this round) |
|---|-----------|-------|-------------------------|
| 1 | Visibility of System Status | 2 | Duplicate, non-deduplicated error toasts fired twice for the same condition; no pending-work indicator anywhere upstream of the pages that have it |
| 2 | Match System / Real World | 2 | "Mitgliederprüfung" reads as a review/approval workflow but contains no approve action — approval happens outside the dashboard, in Discord itself, undocumented on the page |
| 3 | User Control and Freedom | 2 | No undo; destructive deletes still gated only by native `confirm()` (carried, unverified live this round due to session contention, not refuted) |
| 4 | Consistency and Standards | 1 | Confirmed live: one Reaktionsrollen form stacks three incompatible dropdown styles (2 native `<select>` + 1 custom SearchableSelect); Commands.tsx raw checkboxes vs. the pill `.switch` everywhere else |
| 5 | Error Prevention | 2 | Unchanged |
| 6 | Recognition Rather Than Recall | 2 | Cron field is a bare text input with no picker/validation feedback; SearchableSelect exposes no `aria-expanded`/`aria-haspopup` |
| 7 | Flexibility and Efficiency | 1 | Confirmed live: no arrow-key navigation, no shortcuts, no bulk actions anywhere |
| 8 | Aesthetic and Minimalist Design | 2 | Confirmed text-occlusion defect in Settings (see below); flat type hierarchy (7 sizes, 11–21px, 1.9:1 ratio) confirmed by injected overlay |
| 9 | Error Recovery | 2 | Error copy is genuinely clear and actionable, but duplicated/non-deduped |
| 10 | Help and Documentation | 1 | Unchanged — dense always-on prose substitutes for real help |
| **Total** | | **17/40** | **Poor** |

Trend for `web-dashboard-app`: 23 → 17 (out of 40). Real drop, not noise — round 1 was source-only; this round's live evidence corrected assumptions in both directions but net negative, surfacing defects no source read would catch (a layout bug, inconsistent controls within one form, duplicate toasts, and — biggest — a task-flow walkthrough revealing the registration-review page has no approve action).

## Design Specificity Verdict

**LLM assessment (updated with visual evidence)**: Leans more generic than the source-only pass suggested. Live screenshots show a single flat dark theme, Roboto used for ~100% of visible text, and a narrow type-size ratio (independently confirmed by an automated overlay flagging "overused font" and "flat type hierarchy"). The one place specificity holds up is the Reaktionsrollen panel builder's live Discord-message preview — genuinely product-authored, confirmed working live.

**Deterministic scan**: `detect.mjs` on `web/src` — exit 2, still exactly 1 finding (the confirmed false-positive `side-tab` rule on the intentional Discord-embed-mimicry CSS). No change from round 1.

**Visual overlays**: Injection succeeded on Settings, Event-Anwesenheit, and Reaktionsrollen (empty state). Settings triggered 6 findings, including a genuine, screenshot-confirmed layout defect (not a false positive): the SearchableSelect popover for "Registrierungssperre-Rolle" visually overlaps 77–100% of the label/hint text of the field below it when open, instead of pushing layout down. Event-Anwesenheit and Reaktionsrollen triggered only cosmetic/typographic findings (line-length, flat-type-hierarchy).

## Task-Flow / Information Architecture Assessment

Verdict: the current IA does not have an unqualified right to exist as-is — it needs a moderate reorganization, not a rebuild. Individual pages are largely well-built; the structural problem is that the dashboard has no representation of "what needs a moderator's attention right now," and one advertised workflow — registration review — doesn't fully exist in the UI.

- Biggest finding: Mitgliederprüfung is framed as a review workflow (audit page, pending-registration list) but the dashboard has no approve action — `api.ts` only exposes list and delete/reset for registrations. Approval happens by hand-assigning a Discord role, outside this tool entirely, and nothing on the page tells an admin that. A first-time admin looking for "Approve" will not find one.
- Second finding: Übersicht is a stats page, not an attention inbox — no pending-registration count, no unmatched-signup count, and its "Schnellzugriff" links skip the two pages that actually accumulate actionable work (Mitgliederprüfung, Event-Anwesenheit) in favor of one-time setup pages.
- What already works: Settings' card-grid domain grouping is legitimate IA, not a flat toggle wall. The Reaktionsrollen builder enforces its own sequencing with clear blocking messages and progressive disclosure. Event-Anwesenheit's unmatched-signup linking and "Nur Probleme" filter are the right mechanism — they just need to be surfaced upstream, not rebuilt.
- Proposed reorg (moderate, not a rewrite): turn Übersicht into a real attention inbox (pending-registration count, unmatched-signup count, both linking directly into the filtered view); either add an in-dashboard approve action or put a one-line note on the pending state explaining approval happens in Discord; add small "N pending" badges to the relevant sidebar items; group the sidebar into "needs attention" (Mitgliederprüfung, Event-Anwesenheit) vs. "setup/config" (Reaktionsrollen, Geburtstage, Befehle, Einstellungen), separated visually.

## Overall Impression

The tool is authored, not templated — but this round's live evidence shows the gap between "looks fine in source" and "actually works for an admin" is wider than round 1 suggested. The single most damaging finding isn't visual: it's that the page whose whole purpose is registration review can't actually complete a review. Everything else — the inconsistent dropdowns, the duplicate toasts, the text-occlusion bug — compounds a tool that reads as built feature-by-feature without a shared pass for control consistency or task completeness.

## What's Working

1. Reaktionsrollen's live Discord-message preview and blocking sequencing — genuinely product-specific, and its validation messages ("Wähle zuerst einen Kanal aus", "Speichere das Panel zuerst, bevor du Rollen hinzufügst") keep a first-timer from getting lost, confirmed by actually walking the flow to a validation error.
2. Error toast copy is human-readable and actionable ("Der Mitglieder-Cache wird noch aufgebaut — versuche es gleich noch einmal"), better than a source-only read would suggest.
3. Settings' domain-grouped card grid is real information architecture — each card is self-contained and skimmable by its own heading, not a wall of unrelated toggles.

## Priority Issues

**[P0] Registration approval doesn't exist in the dashboard.**
- Why it matters: Mitgliederprüfung is presented as the review workflow for new members but only supports list + delete/reset — approving happens by hand-assigning a role in Discord, outside the tool, with no on-page explanation. A moderator relying on this page alone cannot complete the task it implies it supports.
- Fix: Either wire an approve action into the dashboard (grant the registration role via the bot), or add explicit on-page copy telling admins where approval actually happens.
- Suggested command: /impeccable shape

**[P0] Settings has a real layout defect: SearchableSelect popover overlaps the field below it.**
- Why it matters: Opening "Registrierungssperre-Rolle" visually covers 77–100% of the next field's label/hint instead of pushing layout down — confirmed by screenshot, not a detector false positive.
- Fix: Popover should reflow layout (push content down) or render in a portal/overlay layer that doesn't collide with document flow.
- Suggested command: /impeccable polish

**[P0] Destructive deletes still rely on native `window.confirm()` (carried from round 1, not refuted).**
- Why it matters: Same as before — irreversible deletes get one-click OS-dialog friction, same as any trivial action.
- Fix: In-app modal requiring typed confirmation for irreversible multi-row deletes.
- Suggested command: /impeccable harden

**[P1] Inconsistent form controls, confirmed live within a single form.**
- Why it matters: The Reaktionsrollen panel builder stacks two native `<select>` elements and one custom SearchableSelect with different caret styles side by side; Commands.tsx's raw checkboxes vs. the `.switch` pill everywhere else compounds this — an admin building the same kind of thing sees three different affordances.
- Fix: Standardize on one dropdown component and one toggle component app-wide.
- Suggested command: /impeccable polish

**[P1] SearchableSelect has no ARIA combobox role and no arrow-key navigation (refined from round 1).**
- Why it matters: Confirmed live: the control IS keyboard-operable end-to-end via Tab-cycling + Enter, better than round 1 feared — but ArrowDown does nothing, there's no `aria-activedescendant`/roving highlight, and the trigger exposes no `aria-expanded`/`aria-haspopup` to the accessibility tree, so screen-reader users get no signal it's a combobox with a popup.
- Fix: Add standard combobox ARIA (`aria-expanded`, `aria-haspopup`, `aria-activedescendant`) and arrow-key highlight/selection.
- Suggested command: /impeccable audit

## Persona Red Flags

**Alex (Power User)**: Cron field is raw and unforgiving with no picker; three dropdown styles in one form will slow down repeated panel creation; still no bulk actions or shortcuts anywhere.

**Sam (Accessibility-Dependent User)**: SearchableSelect exposes no combobox ARIA to the accessibility tree (confirmed via inspection) despite being keyboard-reachable; ironically, Commands.tsx's plain native checkboxes are more accessible by default than the custom switches used elsewhere.

## Minor Observations

- Overview's "SERVER" stat card clips long names mid-word with no ellipsis/wrap — confirmed via zoom (`(DEV_MOCK_DISCORD` cut off at the card edge).
- Duplicate, non-deduplicated error toasts fired twice for the identical member-cache-warming condition on first load of Event-Anwesenheit.
- Mitgliederprüfung's intro copy has a punctuation glitch: an em dash immediately followed by an en dash ("— –"), confirmed via zoom; broader em-dash overuse (13 instances) flagged independently by the injected overlay.
- "Nachricht jetzt neu generieren" on Birthdays renders disabled/greyed with no tooltip explaining why.
- Overview's quick-access still omits Mitgliederprüfung and Event-Anwesenheit — confirmed live (only 3 links present).

## Questions to Consider

- If three dropdown patterns can coexist in one form, was there ever a shared design system, or did each feature just get built against whatever was fastest at the time?
- Given moderators can't actually approve registrations from the dashboard, was that intentional (approval must stay a deliberate Discord action) or just an unfinished feature — and does the page's framing need to change either way?
- Would collapsing Settings' always-on explanatory paragraphs into short labels + optional "?" tooltips change how confident admins feel making these consequential toggles?
