---
target: leck-eier-bot dashboard — all user-facing pages
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-08T09-47-03Z
slug: leck-eier-bot-dashboard-all-user-facing-pages
---
Method: dual-agent (A: general-purpose design-review sub-agent · B: general-purpose detector/browser-evidence sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `/commands` toggles (which remove a slash command from Discord) fire zero success feedback — only errors surface. No dirty-state indicator anywhere in Settings. |
| 2 | Match System / Real World | 2 | `/birthdays` prints raw, unrendered Discord mention markup (`<@100000000000000003>`) instead of a name in 3 of 4 rows. Dev-internal words leak into user copy: "geparste" (parsed), "Zwischengespeicherte" (cached). Detector corroborates with `em-dash-overuse` (10 hits) and ~217-char/line dense prose on `/members` and `/events`. |
| 3 | User Control and Freedom | 2 | Type-to-confirm on the two truly irreversible actions works well, but "Nachricht senden" has no post-hoc undo, `/commands` toggles have neither confirm nor undo, and dirty template edits are lost silently on navigation (no route guard). |
| 4 | Consistency and Standards | 1 | Three incompatible save models coexist — two of them on the *same* Settings→Registrierung screen (autosave-with-toast vs. per-card `Speichern` vs. no save button at all on `/settings?section=events`). A delete action is separately labelled `Entfernen` on the button, "Registrierung zurücksetzen" as the dialog title, and `Zurücksetzen` on the confirm — three verbs for one action. |
| 5 | Error Prevention | 2 | Strong type-to-confirm gates where it counts, undercut by a one-click, unlabeled, unwarned self-assignable `@Admin`/`@Moderator` reaction role, and "Nachricht jetzt neu generieren" (rewrites a live Discord message) has no confirmation at all. |
| 6 | Recognition Rather Than Recall | 1 | She's asked to irreversibly delete a birthday entry identified only by a raw snowflake ID — the app already knows the name and shows it elsewhere. `/commands` stacks two unlabeled dropdowns in one cell, the second meaningless without the first. |
| 7 | Flexibility and Efficiency | 2 | Real wins exist (deep-linkable `?section=`/`?month=` filters, full keyboard-operable combobox, "nur Probleme"-filter) but no bulk actions, no shortcuts, and an unrecognized `?section=` slug silently falls back instead of erroring. |
| 8 | Aesthetic and Minimalist Design | 1 | Settings→Registrierung is a 4-column grid of dense, 6–9-line hint paragraphs with ~1000px of dead space beside an orphaned card. Detector independently confirms this isn't just one page: `flat-type-hierarchy` (~1.9:1 ratio, 11–21px) and `overused-font` (Roboto, 94–100% of text) fire on **every route tested**, and `line-length` (~217 chars/line) hits the same `.muted` intro-paragraph pattern on two routes — mechanical evidence for the same thing the holistic read flagged. |
| 9 | Help Recognize/Diagnose/Recover from Errors | 2 | Message copy is genuinely actionable ("Gib einen Tag und einen Monat ein.") but fires as a toast ~1400px from the field it refers to, with no `aria-invalid`, no focus move, and it auto-dismisses. |
| 10 | Help and Documentation | 3 | The standout heuristic: hints are written from the Discord-admin's side of the boundary ("Falls unsicher: aus lassen (Standard)"), including where to go inside Discord itself. Docked one point for zero first-run onboarding — everything is a permanently-expanded prose wall, nothing progressively disclosed. |
| **Total** | | **18/40** | **Poor — significant, structural issues; not yet safe to hand to a first-timer unsupervised** |

## Design Specificity Verdict

**LLM assessment:** Decisively authored for this bot, not a generic admin panel — and this is exactly what makes the gaps sting. The copy encodes real mechanics ("`—` bedeutet nicht erfasst, nicht dass es nie passiert ist" — an honest disclaimer about the bot's own uptime gaps), the reaction-role page renders an actual Discord-message mockup down to the `BOT` badge and reaction-count pills, and confirmation dialogs state Discord-side consequences by name ("Der Bot postet diese Nachricht jetzt live in #allgemein"). The *thinking* is bespoke. The *visual system* — one accent color, uniform card sizing regardless of content density, one flat type scale — is generic dark-admin-panel default, and that mismatch is where the app loses a first-timer: the copy assumes deep product fluency while the layout gives her no visual cues about what to read first.

**Deterministic scan:** `detect.mjs --json web/src` returns **0 findings** (exit 0) — clean, consistent with the prior two runs' remediation work. But this is a source-regex scanner blind to computed styles; the **live browser scan tells a different story**. Across the 6 routes injected, `overused-font` and `flat-type-hierarchy` fired on every single one — a genuinely system-wide signal, not a page-specific quirk. `line-length` (~217 chars/line) hit the same `.muted` paragraph pattern on two routes. One likely false positive: `text-occlusion` fired 3–4 times each on `/birthdays` and `/settings→Registrierung`, but on inspection this is a standard syntax-highlight-layer-behind-a-transparent-textarea editor pattern (the template editor's mention-pill highlighting), not a genuine visibility bug — flagged rather than dismissed outright, worth a two-minute human glance to confirm the textarea text really is transparent. `all-caps-body` also fired once on Overview's stat-tile labels — plausible, not confirmed, false positive (uppercase labels are a common, accepted stat-tile convention).

## Overall Impression

This is a genuinely well-thought-out tool wearing a visual system that actively works against its own first-timer persona. Where the previous critique (three days ago, same persona lens) found a jargon-and-typography problem at 21/40, this pass went one interaction deeper — actually opening the event-attendance assignment dropdown that the Overview page's top alert points to — and found it **structurally broken**: the popover is clipped to a 6px sliver by a scroll container and the task cannot be completed at all. That's not a regression from anything touched today; it's a pre-existing bug this run's deeper interaction surfaced. Combined with three incompatible save models coexisting on one screen and raw Discord IDs standing in for names inside an irreversible-delete confirmation, the single biggest opportunity isn't more clarifying prose — it's fixing the handful of places where the interface actively lies to or strands this specific user, then trusting the system-wide typography fix (already flagged twice) to do the rest.

## What's Working

1. **Confirmation dialogs state the Discord-side consequence, not the database operation** — "Der Bot postet diese Nachricht jetzt live in #allgemein — alle Mitglieder mit Zugriff auf den Kanal sehen sie sofort." This persona already thinks in terms of channel visibility from moderating with Discord's own permissions; the copy speaks her existing model instead of asking her to learn a new one.
2. **The reaction-role panel's Discord-shaped live preview plus an explicit "Entwurf" state** — her core anxiety as a first-timer is "will this post something embarrassing to my server," and a draft banner plus a pixel-accurate Discord message mockup (avatar, `BOT` tag, timestamp, reaction pills) collapses that anxiety and lets her iterate risk-free.
3. **Hints written precisely at the Discord-native/bot-specific seam** — "Discord bietet ein eigenes „Mitgliedschafts-Screening" an (Server-Einstellungen → Sicherheit) … Falls unsicher: aus lassen (Standard)." This is exactly the gap this persona has, addressed with a humane default recommendation rather than a wall of options.

## Priority Issues

**[P0] The event-attendance "Mitglied zuordnen…" picker is clipped to an unusable 6px sliver — the app's single most-signposted task is a dead end**
- Why it matters: `web/src/theme.css:435`'s `.table-scroll { overflow-x: auto }` clips the absolutely-positioned `SearchableSelect` popover (`theme.css:665`) inside the assignment table. The Overview page's top attention alert ("Event-Anmeldung braucht manuelle Zuordnung") sends her here by name; typing into the search box filters a list she cannot see, and even the "Keine Treffer." empty state is unreachable. A first-timer cannot diagnose a CSS clipping bug — she concludes the tool, or she herself, is broken.
- Fix: Render the popover in a portal to `document.body` with fixed positioning anchored to the trigger, or stop clipping this specific table's overflow on the axis the popover needs. Audit every other `SearchableSelect` living inside a `.table-scroll` for the same bug.
- Suggested command: `/impeccable harden`

**[P1] Raw Discord snowflake IDs stand in for names — including inside an irreversible delete confirmation**
- Why it matters: `entryLabel()` (`web/src/pages/Birthdays.tsx:57`) falls back to the literal mention string `<@100000000000000003>` in the PERSON column, the "Als nächstes" hero tile, and worst of all the delete dialog: "Der Eintrag für `<@100000000000000003>` wird unwiderruflich entfernt…". The app already resolves this exact ID to "Ghost" with an avatar on `/members/100000000000000003` — it knows who this is. A fluent Discord user has never seen raw mention markup; being asked to make an irreversible call about an unnamed 18-digit number is where a cautious moderator abandons the task.
- Fix: Resolve `userId` against the member cache before rendering, showing `@Ghost` (styled as a mention pill) with a `Unbekanntes Mitglied (<id>)` fallback only when truly not cached. Never pass the raw mention string into `confirmDialog`.
- Suggested command: `/impeccable clarify`

**[P1] Three incompatible save models, two of them stacked on one screen, with no dirty-state indicator anywhere**
- Why it matters: On Settings→Registrierung, three fields autosave with a toast while three neighboring cards each need their own `Speichern` — same screen. `/birthdays` has exactly one `Speichern`, sitting in the middle card, that silently persists two other cards with no save affordance of their own. `/commands` autosaves with zero feedback. `/settings?section=events` has no save button at all. She has no code to infer this from — only what she can see, and what she sees is inconsistent. The codebase already has the right pattern once (ReactionRoles: "Diese gehören zu denselben Panel-Einstellungen oben — Änderungen speichern speichert auch sie") — it just isn't applied anywhere else.
- Fix: Pick one save model per page and state it explicitly wherever a button's scope isn't obvious from proximity; add a per-card dirty indicator; add a navigation guard for unsaved template edits.
- Suggested command: `/impeccable clarify`

**[P1] "Rolle" / "Rang" / "Mindestrang" / "Bot-Team-Rang" collide head-on with Discord's own "role," in a persona whose main asset is Discord-role fluency**
- Why it matters: `/commands` explains "Mindestrang" using "Bot-Team-Rang," offers a dropdown with near-synonymous options ("Bot- oder Server-Besitzer" vs. "Bot-Besitzer, Server-Besitzer oder Admin"), and Settings→Konto then calls the identical concept "Rolle: Bot-Besitzer." This persona's Discord fluency — where "Rolle" already means something concrete and different — actively works against her here instead of transferring. She cannot answer "who can run `/clear` on my server right now?" from anything in the UI.
- Fix: Pick one term for the bot-permission tier and never call it "Rolle." Label the dropdown inline. Add one permanent sentence explaining the tier is separate from Discord roles and where it comes from (bot ownership / server ownership / Administrator permission).
- Suggested command: `/impeccable clarify`

**[P2] Settings→Registrierung's dense, uneven layout — now independently confirmed system-wide by the detector**
- Why it matters: A 4-column grid squeezes hint prose to a ~35-character measure over 6–9 lines per card, while an orphaned card later sits alone beside ~1000px of dead space — on the highest-stakes screen in the app, where careful reading matters most. This isn't isolated: the live detector found flat type hierarchy (~1.9:1 ratio) and font-overuse (Roboto, 94–100%) on **every route tested**, not just this one, and the same dense-paragraph pattern (~217 chars/line) recurs on `/members` and `/events`. Two independent passes (this one and the prior critique) and now mechanical evidence all point at the same root cause.
- Fix: Drop to 2 columns (or 1, max-width ~640px), reorder cards to match the stated `Ablauf:` flow, and move long hints behind the `▸`-disclosure pattern that already exists in `ReactionRoles`. This is a system-wide type-scale fix, not a page-specific one.
- Suggested command: `/impeccable typeset`

## Persona Red Flags

**Casey (Discord moderator, fluent in Discord/social media day-to-day, zero prior exposure to this dashboard or any bot-admin tool, zero code literacy — the mandated lens for this review):**

- **Übersicht**: "ZWISCHENGESPEICHERTE MITGLIEDER · 5" sits directly above "MITGLIEDER · 5" — identical number, near-identical label, one of them a raw implementation detail (the bot's in-memory cache). She can't tell which is authoritative or why they'd differ. Every relative timestamp reads "vor 0M, 1T und 0Std" instead of Discord's own "gestern" — looks machine-generated, not native.
- **Event-Anwesenheit**: "Vom Apollo-Bot geparste Events" — Apollo is never introduced as a third-party bot she may not have installed, and "geparst" is developer German. Following the page's own top alert leads directly into the P0 clipped dropdown above.
- **Geburtstage**: raw `<@100000000000000003>` where a name belongs, in the delete confirmation (see P1). "Schrift verwenden" appears on three separate toggles referring to a Unicode-homoglyph alphabet — the actual explanation lives on a different page she hasn't visited yet.
- **Settings→Registrierung**: "Ohne gesetzte Rolle nach der Registrierung (siehe oben) hat dieser Schalter keine Wirkung" — a hard dependency stated only in prose; the toggle stays fully clickable regardless, and on this dev instance the prerequisite role is in fact unset. "sso-Namen" (also an unexplained `SSO-NAME` column on `/members`) is never expanded anywhere in the app.
- **Befehle**: "Mindestrang"/"Bot-Team-Rang" collide with her Discord-role fluency (see P1); toggling a command off gives zero feedback that anything happened.
- **Reaktionsrollen**: the "Reaktion hinzufügen" row offers one-tap self-assignable `@Admin`/`@Moderator` reaction roles with no label and no warning — as a moderator she knows exactly what letting anyone self-assign `@Admin` means, and the app treats it as casually as a color role. Meanwhile `@Mitglied`, the role she'd actually expect to offer, is silently absent (filtered as already-used) with no explanation.

## Minor Observations

- `SearchableSelect` itself is well-built (correct combobox ARIA, full keyboard nav, "Keine Treffer." empty state) — the P0 is a container clipping bug, not a component defect.
- The delete-button-vs-dialog verb mismatch on `/members` (`Entfernen` → "Registrierung zurücksetzen" → `Zurücksetzen`) reads as more severe ("kick this person") than the mild, recoverable action it actually is.
- `/events`' `ANMELDUNG` column renders empty for every row (an `undefined` label lookup on a null `choice`) while the tally above claims zero signups — simultaneously contradicted by three people shown as having attended on time.
- `Unbekannt#0000` uses the retired Discord discriminator format — to a fluent current Discord user this reads as corrupted data, not an intentional placeholder.
- Settings→Konto is a single sentence duplicating the sidebar footer, but using a different word for the same concept (`Rolle` vs. the footer's `bot-owner`) — doesn't earn its own tab.
- Detector's `text-occlusion` hits (template-editor highlight layer under a transparent textarea) are a probable false positive worth one human glance, not urgent.
- `overused-font`/`flat-type-hierarchy` firing on every route is the same signal the prior (Sep 7) critique already flagged as a P2 — worth checking whether the earlier typography fix's coverage is actually reaching every route, since the detector still sees it everywhere.

## Questions to Consider

- If the Übersicht's "Braucht deine Aufmerksamkeit" box is the real front door, why is everything else built as a settings tree instead of a queue? What would change if the two things the app actually asks her to do — approve a registration, resolve an unmatched signup — became the primary surface instead of items buried in reference tables?
- Every template field has a live preview. Why doesn't every *setting* — especially the auto-approve toggle and the permission-tier dropdowns — get one too?
- The app has two separate permission systems (Discord roles, bot tiers) and never admits that out loud in one place. What breaks if it did, in one permanent sentence?
