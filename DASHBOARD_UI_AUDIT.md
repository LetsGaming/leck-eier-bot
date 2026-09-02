# Dashboard UI Audit

Phase-driven audit of confirmed UI/UX issues across the web dashboard, written 2026-09-03. Each phase is grounded in the actual source (files/lines cited) — not assumptions. This is a planning document; no implementation has started yet. Delete or archive once all phases are implemented.

## Cross-cutting note

Phase 3 (Event-Anwesenheit) interacts with the "N Anmeldungen brauchen Zuordnung" attention link on Overview (added during the earlier design-audit pass), which currently points at `/events?problems=1`. That link's target page is being restructured in Phase 3, so its destination needs to be redesigned alongside it — see the open question in Phase 3.

---

## Phase 1 — Mitgliederprüfung: search scope + ranking

**Findings** (`src/web/routes/memberAudit.ts`, `src/services/memberSearch.ts`):
- The single search box already filters both "Auf dem Server" and "Server verlassen" (same `q` param, `matchesSearch()` applied to both). It does **not** touch the separate `RegistrationsCard` component (`web/src/pages/MemberAudit.tsx`), which calls `/members/registrations` with no search param at all.
- `matchesSearch()` (`src/services/memberSearch.ts:46`) is a pure `.includes()` substring check — no scoring, no ranking. Results are sorted alphabetically by display name afterward, not by match quality. This function is shared with the `/finduser` slash command and `searchCachedMembers()`, so a change here has blast radius beyond the dashboard.

**Decision (locked in):** one unified search box filters all three lists (in-guild, left, Registrierungen) — single mental model, single box.

**Still open at implementation time:** whether relevance scoring should live only in the dashboard's consumption of results, or change `matchesSearch()` itself (which would also affect `/finduser`).

---

## Phase 2 — Reaktionsrollen: horizontal overflow (small, isolated fix)

**Root cause, confirmed:** `.mapping-row > *` (`theme.css:448`) sets `flex-shrink: 0` on every direct child by default; siblings that need to shrink opt out via a `.grow` class (used on the adjacent `SearchableSelect` and label `<input>`). `RoleCheckboxList` (`web/src/components/RoleCheckboxList.tsx`) is used as a direct `.mapping-row` child in two places (`ReactionRoles.tsx:648` and `:741`) but never gets `.grow`, and the component doesn't even accept a `className` prop to receive one. Its root `<div>` therefore renders at its natural (unwrapped) content width and refuses to shrink — hence the overflow of both the card and the page.

**Fix scope:** give `RoleCheckboxList` a `className`/width API and apply `.grow` (or an equivalent internal fix) at both call sites. No design decision needed — self-contained, low-risk.

---

## Phase 3 — Event-Anwesenheit: master list / detail view rework (largest phase)

**Findings, confirmed in `web/src/pages/EventAttendance.tsx`:**

1. **Two unrelated search boxes, visually identical, in separate cards:**
   - "Ereignisse durchsuchen" — server-side, debounced, filters by event *title*, drives pagination.
   - "Suche" (second card, next to "Nur Probleme anzeigen") — client-side only, filters signup *names* within whatever 10 events are already loaded on the current page.
   
   Nothing distinguishes these as different kinds of search.

2. **Pagination/filter interaction bug:** `filteredEvents` (line 265) filters over the `events` state — the current page's 10 events — not the full server-side result set. "Nur Probleme anzeigen" and the member-name search therefore only ever look inside the current page.

3. **No page-size control, no jump-to-page**, just Zurück/Weiter.

4. **Lateness/earliness data already exists end-to-end** — verified `deriveAttendance()` (`src/services/eventAttendance.ts:44`) always computes `lateMinutes`/`earlyMinutes` regardless of grace-period status, and the API (`src/web/routes/eventAttendance.ts`) always passes them through. `ResultCell` (`EventAttendance.tsx:90`) *does* render a small badge for sub-5-minute lateness today, in a neutral "fine" (green) tier. But: it's buried in one column of a dense per-signup table row, and the event-level summary line (`counts.late`, etc.) only tallies by `attendanceStatus` bucket — a signup 2 minutes late within grace never appears in any summary count anywhere. Needs live verification with seeded test data before assuming this is purely a display-prominence gap vs. something deeper.

**Decision (locked in): master list / detail view**, refined per Apollo's own pattern but fixing its one flaw:

| Element | Behavior |
|---|---|
| List view | Event cards, **paginated by month** (not a flat page-of-N) — prev/next month arrows, a "Heute" (jump to current month) button, **and a month/date picker for direct jumps** (Apollo itself lacks this — going back several months there means clicking through every month in between; this dashboard should not inherit that gap) |
| List view search | Filters event titles/cards within scope, server-side |
| Card click | Opens the detail view for that one event |
| Detail view | Full signup table for that event only; name search scoped to it (no more page/scope ambiguity); late/early minutes as a dedicated labeled field, not folded into "Ergebnis"; a summary tally including minor/grace-period lateness; the existing delete action |

Why this resolves the confirmed problems structurally, not just cosmetically:
- The two-search confusion disappears — list-view search and detail-view search are on different screens with different, unambiguous scopes.
- The pagination/filter bug goes away by construction — detail-view filtering operates on one event's complete, already-loaded signup list, never a client-side slice of a paginated fetch.
- Late/early minutes get room to be a first-class field with a clear label and a summary count, addressing "instantly visible, not alarming for a few minutes."

**Open question for implementation time:** Overview's "N Anmeldungen brauchen Zuordnung" link needs a new target under this structure — either the list view filtered to "months/events with unresolved signups," or a direct deep-link into the one event if there's only one. Decide during Phase 3's detailed design, not before.

---

## Phase 4 — Geburtstage: order, alignment, button color

**Findings, confirmed in `web/src/pages/Birthdays.tsx`:**

1. **Order**: the 3-card settings grid (Nachrichtenvorlage / Ankernachricht / Selbstregistrierung, lines 158–270) renders before the birthday list (lines 272–386).
   **Fix:** swap the two blocks — birthday list on top, settings on the bottom.

2. **"Hinzufügen" button misalignment**: root cause confirmed — `.row { align-items: flex-end }` aligns children by their margin-box bottom edge. `.field` carries `margin-bottom: 16px` (`theme.css:309`); the bare `<button>` (line 341) has no such margin, so it sits flush at the row's edge while each field's *input* sits 16px above its own margin-box edge — the button reads as hanging lower than the inputs despite being technically "aligned." Also present in the same row: `.row > * { flex: 1 }` (`theme.css:325`) stretches the button to share equal width with the text fields — a separate smell worth reconsidering while in this code.

3. **Bearbeiten/Löschen have no color distinction**: confirmed — both are bare `<button>` with no class (lines 374–375), unlike every other delete action in the app (MemberAudit, EventAttendance, ReactionRoles), all of which use `.danger`.
   **Fix:** give Löschen the `.danger` class, matching the rest of the app.

No open design decisions — all three are ready to implement as specified.

---

## Phase 5 — Einstellungen: split into sub-sections

**Root cause, confirmed:** `.card-grid` (`theme.css:170`) is `grid-template-columns: repeat(auto-fit, minmax(340px, 1fr))`. Settings has 6 cards of wildly uneven length (Allgemein: one toggle; Registrierungsformular: ~150+ words and 5+ fields). CSS Grid sizes each row by its tallest cell and, by default, stretches every cell in that row to match — so a short card sharing a row with a long one inherits all that empty vertical space. 340px works fine for Birthdays' 3 more evenly-sized cards; it's the wrong fit for Settings' specific content mix.

**Decision (locked in):** split into sub-sections/tabs — General / Registration / Apollo / Session — addressing the "completely bloated" complaint at the IA level, not just the CSS level. This removes the long-scrolling single-grid layout entirely rather than just resizing it.

**Still open at implementation time:** exact navigation pattern for the sub-sections (tabs vs. a secondary nav list vs. anchored jump-links) and whether the 6 existing cards map one-to-one to sections or get further consolidated.

---

## Suggested implementation order

Phases 2 and 4 are small, isolated, and unblock nothing else — good candidates to do first. Phase 1 is medium-sized and self-contained. Phases 3 and 5 are the larger structural reworks and should come last, in either order (no dependency between them beyond the Overview-link question noted in Phase 3).
