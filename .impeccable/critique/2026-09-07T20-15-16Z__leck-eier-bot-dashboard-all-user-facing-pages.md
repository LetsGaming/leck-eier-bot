---
target: all user-facing dashboard pages (Casey-the-Moderator persona lens)
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-09-07T20-15-16Z
slug: leck-eier-bot-dashboard-all-user-facing-pages
---
Method: dual-agent (A: general-purpose design-review sub-agent · B: general-purpose detector/browser-evidence sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toasts, busy states, live pending-count badges are solid; a few async actions (e.g. "regenerate birthday message") give no visible confirmation of the actual Discord-side result |
| 2 | Match System / Real World | 1 | Bot/developer vocabulary ("Sitzung", "Mindest-Stufe", "Registrierungssperre-Rolle", cron, raw `{placeholder}` tokens) has no analog in a moderator's existing mental model |
| 3 | User Control and Freedom | 3 | Confirm dialogs are cancelable (Escape verified live), edits are per-field; no undo window after a confirmed destructive action |
| 4 | Consistency and Standards | 3 | Strong visual/component consistency; but destructive-action friction is inconsistent (see P2) |
| 5 | Error Prevention | 3 | Good input constraints (typed numbers, live char-count validation) but the Birthdays Discord-user-ID field accepts free text with no format hint |
| 6 | Recognition Rather Than Recall | 2 | Icons are consistently labeled (good), but jargon terms must be remembered across the session with no glossary/inline help |
| 7 | Flexibility and Efficiency | 2 | Genuinely good progressive disclosure on the cron field; but no bulk-approve, no saved views, no keyboard shortcuts for a daily-use admin tool |
| 8 | Aesthetic and Minimalist Design | 2 | Individual cards are clean, but Settings' Registrierung tab stacks ~5 equally-weighted dense cards with no pacing; detector independently confirms flat type hierarchy on every page (11–21px, 1.9:1 ratio) |
| 9 | Error Recovery | 2 | Errors are visually distinct (red toast, 8s dwell) but surface raw API error text with no friendly translation layer |
| 10 | Help and Documentation | 0 | No in-app help, tooltips-on-demand, onboarding, or glossary anywhere across the 8 pages reviewed |
| **Total** | | **21/40** | **Acceptable — significant improvements needed before first-time users are happy** |

## Design Specificity Verdict

**LLM assessment**: This is not a generic CRUD admin panel — it is authored specifically for this bot's real moderation mechanics. The registration approval dialog states the exact consequence ("Neuling erhält die konfigurierte Registrierungsrolle... der private Thread wird automatisch geschlossen"), the Apollo-event attendance page has bespoke grace-period tallies, and the reaction-role editor renders a live Discord-bubble mockup that changes by message/selection type. That same specificity is precisely what makes it hostile to a newcomer: the copy is written in the bot's own internal vocabulary (pipelines, tiers, template tokens) rather than translated into a moderator's vocabulary.

**Deterministic scan**: `detect.mjs --json web/src` returns **0 findings** by default (exit 0). With `--no-config`, one `side-tab` hit surfaces at `web/src/theme.css:750` (`.message-preview-embed` left-border accent) — this is a project-configured, previously-confirmed false positive (genuine Discord-embed mimicry), independently re-verified this run and correctly suppressed. No new static-markup anti-patterns exist in the codebase.

**Visual overlays** (live browser injection, isolated context, `detect.js` on 6 routes): overlays are not currently visible in a live tab (the live-server session was stopped after evidence collection, per protocol), but the console findings were captured cleanly:
- **`flat-type-hierarchy`** fired on every one of the 6 routes tested (Overview, Birthdays, ReactionRoles, Events, Members, Settings) — sizes cluster in an 11–21px band (~1.9:1 ratio). This *independently* confirms Assessment A's own holistic read that "font-size/type-hierarchy variety is genuinely narrow across body copy."
- **`overused-font`** (advisory, roboto 100% of text) still fires on most routes despite the recent monospace-role typography refactor (git history shows a P2 fix for exactly this shipped 2026-09-07) — worth a quick look at whether that fix's coverage reaches every route, since the detector still sees single-font dominance on Overview/Birthdays/Events/Members/Settings.
- **`body-text-viewport-edge`** fired on ReactionRoles, Events, and Members — but all three trace to the *same* reused `.muted` page-description-paragraph pattern, so this is one systemic component issue, not three independent ones.
- **`call-caps-body`** fired once on Overview, traced to the six all-caps stat-card `.label` divs (e.g. "Zwischengespeicherte Mitglieder", 31 chars) — plausible false positive (stat-card labels, not shouted prose), flagged rather than dismissed.
- A native Chrome DevTools accessibility issue also surfaced independently of Impeccable's own rules: **an unlabeled form field on `/birthdays`** — this lines up with Assessment A's own finding that the Birthdays page's Discord-user-ID field lacks format guidance, and adds a concrete a11y dimension to that same field.

## Overall Impression

The bones are genuinely good — a real confirm-dialog system with type-to-confirm gating for the worst actions, live Discord-accurate message previews, and progressive disclosure that hides cron syntax behind an opt-in toggle. But the whole interface is written for someone who already understands *this specific bot's* internal model (registration pipelines, permission tiers, template tokens, cron), not for a moderator arriving cold with only Discord-native moderation experience. The single biggest opportunity is closing that vocabulary gap — not by ripping out the specificity that makes the tool good, but by adding a plain-language layer on top of it.

## What's Working

1. **The confirm-dialog system (`ConfirmContext.tsx`) scales friction to actual stakes** — `requireText` type-to-confirm for the worst actions, real focus trap, Escape-to-cancel (verified live), proper `alertdialog`/`aria-modal` semantics. This is deliberate design engineering, not a wrapped `window.confirm()`.
2. **Progressive disclosure on the cron field** — defaults to a plain `time` input and only reveals raw cron syntax behind an explicit "Cron-Ausdruck manuell bearbeiten" toggle. Exactly the right pattern for a mixed-skill user base.
3. **Live, Discord-accurate previews** (reaction-role panel mockup, birthday/registration template previews) let a moderator see what members will actually see before committing — this maps naturally onto instincts she'd already have from other mod tools.

## Priority Issues

**[P0] Jargon-first vocabulary with zero onboarding or glossary**
- **Why it matters**: A moderator with real Discord-mod experience but zero exposure to this dashboard and zero code literacy hits terms like "Sitzung", "Mindest-Stufe", "Registrierungssperre-Rolle", and cron syntax as *primary* labels, not secondary detail. On the Settings → Registrierung tab alone she'd hit six such terms before finding one control she's confident about.
- **Fix**: Add a persistent, dismissible "what this section controls" primer per settings tab, and lead every field with task-framed plain language ("Who can use this command?") with the technical term demoted to a secondary hint, not the primary label.
- **Suggested command**: `/impeccable clarify`

**[P1] Raw template-placeholder syntax (`{userMention}`, `{roleChannel}`, `{month}`) exposed as literal text a non-coder must type and preserve exactly**
- **Why it matters**: Curly-brace token syntax is code to someone with zero programming literacy — a hard comprehension failure, not an inconvenience. The editor already solves this for one case (a `#channel` typeahead in `TemplateEditor.tsx`) but not for the other tokens, which sit as raw editable text in a monospace textarea.
- **Fix**: Extend the existing `#`-trigger insert pattern to every placeholder, rendering inserted tokens as visually distinct pills rather than raw braces the user can accidentally mistype.
- **Suggested command**: `/impeccable shape`

**[P2] Inconsistent destructive-action friction across equally irreversible actions**
- **Why it matters**: Registration reset and event deletion require typed-name confirmation; birthday-entry deletion and reaction-role-mapping removal — both also described in their own copy as irreversible — get a plain OK/Cancel. Once a user learns "typing the name means this is really serious," the absence of that signal elsewhere reads as either those actions being safe (they aren't) or the app being arbitrary about risk, which erodes the trust the better example built.
- **Fix**: Apply one rule — every backend-irreversible delete gets `requireText` — and audit `Birthdays.tsx`'s delete handler and `ReactionRoles.tsx`'s mapping/panel-delete handlers against it.
- **Suggested command**: `/impeccable harden`

**[P2] Flat type hierarchy confirmed on every page by the deterministic scan, plus an unlabeled form field on Birthdays**
- **Why it matters**: The detector independently corroborates the design review's own read that type sizes cluster too tightly (11–21px, ~1.9:1) across all 6 routes tested, which is exactly why a first-time user can't tell what matters most on dense screens like Settings. Separately, DevTools flagged a genuinely unlabeled form field on `/birthdays` — likely the same Discord-user-ID input the design review flagged as unvalidated — a real accessibility gap independent of the design-taste finding.
- **Fix**: Widen the type scale so primary values/headings read clearly above labels/hints (the earlier monospace-role fix addressed code/data text but the detector shows single-font dominance persists on most routes); add a proper `<label for>`/`aria-label` to the flagged Birthdays field.
- **Suggested command**: `/impeccable typeset`

**[P3] No visible "this is now live on Discord" state once a reaction-role panel is sent**
- **Why it matters**: The editor already shows a clear draft-state banner ("Entwurf — es wurde noch nichts auf Discord gepostet") but drops that signal entirely once the panel is sent — editing something 100 members can already see looks identical to editing a private draft. This is the single biggest before/after behavior difference in the tool and currently has no matching visual weight.
- **Fix**: Add a parallel "Live — bereits gepostet" banner/border treatment mirroring the existing draft alert.
- **Suggested command**: `/impeccable bolder`

## Persona Red Flags

**Casey (Discord Moderator, first time on this dashboard, zero code literacy — the mandated lens for this review)**:
- "Sitzung" (Settings tab) reads as "meeting", not "session" — no context to correct that assumption.
- "Events (Apollo)" and the Events page's opening sentence both assume she already knows Apollo is a third-party bot her server may use — the one explanatory hint sits below the tab label, after she's already clicked in.
- "Registrierungssperre-Rolle" vs. "Registrierungsrolle (niedrigste Stufe)" are two near-identical, easily-confused technical role names distinguished only by dense hint paragraphs — no mapping onto Discord's native role-assignment model she already knows.
- The cron escape hatch is one click away from the friendly `time` picker with no warning that it's an expert-only mode — a natural, exploratory click for someone new to the tool drops her straight into `0 0 * * *` syntax.
- Raw Discord snowflake IDs (`100000000000000002`) sit in `<code>` next to recognizable names throughout Members/MemberOverview with no explanation of what they're for or a copy button.
- "SSO-Name" in the registration table — unexpanded IT jargon with no place in a Discord moderation context.
- "Mindest-Stufe" permission tiers ("Bot-Besitzer, Server-Besitzer oder Admin") don't map onto Discord's own boolean per-role permission model she already understands — she has to learn a second, bot-specific authorization model from a one-line hint.
- The "Regeln akzeptiert" data-gap caveat ("`—` bedeutet nicht erfasst, nicht dass es nie passiert ist") assumes she already thinks of the bot as a fallible, sometimes-offline process — not the default mental model for a Discord bot.

**Sam (accessibility, secondary lens)**: the confirm-dialog system does real accessibility work (proper `alertdialog`/`aria-modal`, focus trap, Escape-to-close). But the reaction-role emoji/button/dropdown preview relies entirely on emoji glyphs with `alt=""` on custom emoji images — a screen-reader user gets no equivalent of the emoji identity in the live preview. Independently, DevTools flagged one genuinely unlabeled form field on `/birthdays`.

## Minor Observations

- Nav pending-count badges are a nice ambient-awareness pattern, correctly mirrored between sidebar and the Overview's "Braucht deine Aufmerksamkeit" card.
- `ToastContext.tsx` deliberately keeps error toasts up longer (8s) than success (4s) and de-dupes repeated identical messages — good, otherwise-invisible craftsmanship.
- The Members "three lists" search explanation would land far better as 2–3 short labeled bullets than one dense paragraph.
- `EventAttendanceDetail.tsx`'s nested "davon X leicht verspätet" sub-line isn't visually indented/bulleted relative to its parent tally, risking double-counting on a quick read.
- Login page copy ("Melde dich mit Discord an, um Reaktionsrollen, Geburtstage und Befehle zu verwalten") is refreshingly plain and task-oriented — a good tone model for the rest of the app.
- The `side-tab` detector rule on `theme.css:750` remains a correctly-suppressed, re-verified false positive (genuine Discord-embed mimicry) — no action needed.
- The `call-caps-body` hit on Overview's stat-card labels is a plausible false positive (labels, not shouted prose) but worth a quick human glance.

## Questions to Consider

- The confirm-dialog system already proves the team knows how to calibrate friction to stakes — why does that judgment stop at the registration/event-delete boundary instead of being a blanket rule audited across every destructive action?
- Cron and template-placeholder syntax are each one click away from the friendlier default view — is hiding them behind an escape hatch actually solving the comprehension problem, or just moving the same hard failure one click deeper with no warning label?
- If a moderator's very first click from Overview's attention card drops her into a page that opens by naming a bot she may never have heard of (Apollo), should first-touch context ever be assumed, or should every "needs attention" link carry its own one-line plain-language preamble?
