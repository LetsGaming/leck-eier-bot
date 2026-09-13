# Events & Event Attendance

Events are created natively — a template (or a from-scratch form) is filled out and published from the dashboard or via `/event create`, posting a message with three RSVP buttons (Accepted/Tentative/Declined). Once an event starts, the bot checks who's actually in one voice channel and keeps watching until it ends, then shows the result — RSVP choice vs. actual outcome, per member, per event — on the dashboard's **Event-Anwesenheit** page.

This replaces an earlier version of this feature that scraped RSVP embeds posted by the third-party [Apollo](https://apollo.fyi/) bot. That scraping/parsing layer (`services/apolloEventParser.ts`, fuzzy name-matching) is gone — see migration v36 in `src/db/index.ts` for the full rationale. Historical events/signups created that way still work and still display correctly; only the creation path changed.

## Creating and publishing an event

1. **Templates** (`Event` → `Vorlagen` tab in the nav) — a template has a name, a default title, a base description, and optional defaults (channel, mention role, attendance voice channel). Both title and description are plain text — no `{token}`/placeholder syntax. They're pre-filled into the publish form and edited freely from there: usually the title is the one thing that changes, and the description is typically posted as-is, occasionally with a specific part edited. Start/end time is never embedded in the text — it's rendered as its own "🕐 Zeitpunkt" field on the embed (`<t:epoch:F>` Discord timestamp tokens), same as Apollo's own "Time" field.
2. **Publishing** — from a template's "Veröffentlichen" action, either on the `Event` → `Vorlagen` tab or via the `Event` → `Anwesenheit` tab's "Neues Event" button (pick a template, then the same form), or `/event create` (Discord picks the template via autocomplete, then a modal with the title/description pre-filled — editable — plus start/end time). Either path calls `publishEvent()`, which posts the message and creates the `events` row.
3. **RSVPs** — a member clicks one of the three buttons; `handleEventRsvpButton()` (in `src/services/events.ts`, wired from `src/events/eventWatcher.ts`) upserts their signup with their real Discord user id and edits the message to show the live per-choice name list.
4. **Editing/cancelling** — while an event is still `scheduled`, the dashboard can edit its title/description/time (re-renders and edits the message) or cancel it (message loses its buttons, shows a cancelled state).
5. **Reminder** — 15 minutes before start (`EVENT_REMINDER_LEAD_MS`), everyone who RSVP'd `accepted` is pinged once in the event's own channel — see `sweepEvents()` in `services/eventAttendance.ts`.

## Setup

Two settings on the dashboard's Settings page, under "Event-Anwesenheit":

- **Standard-Event-Kanal** — fallback channel for a newly-published event when neither its template nor the creation form specifies one.
- **Event-Sprachkanal** — fallback voice channel for attendance tracking, when an event's template doesn't specify its own.

Leave the voice channel empty (and no template configures one) to disable attendance tracking for events without a template-level channel. See [PERMISSIONS.md](PERMISSIONS.md) for the (non-privileged) `GuildVoiceStates` intent this needs, and note the bot must be able to **View Channel** on the configured voice channel — otherwise it can't see who's in it at all.

Events are assumed to never overlap — one voice channel, one event at a time. If two events end up active simultaneously, the bot logs a warning and only tracks the earliest.

## The state machine

Each event is `scheduled` → `active` → `completed` (or `cancelled`, either from the dashboard's cancel action or its message being deleted while still `scheduled`). A background sweep (every 30 seconds, plus a catch-up pass at startup — `sweepEvents()`/`catchUpEvents()` in `services/eventAttendance.ts`) drives the transitions:

- **Activation** (start time reached): snapshots who's currently in the configured voice channel as "present at start", and locks in which voice channel is being used for this event.
- **While active**: every join/leave in that channel is logged live (via Discord's voice-state events), for anyone in the channel — not just RSVP'd members, so a signup made or corrected after activation can still have real attendance reconstructed from the log.
- **Completion** (end time reached): takes a final snapshot, then computes each signed-up member's outcome from the full log.

If the bot is offline when an event's start or end time passes, it catches up at the next startup: an event whose *entire* window was missed is marked `completed` with every signup `not_tracked`. An event that was still `active` when the bot went down gets its current voice-channel occupancy diffed against the log to approximate what happened during the gap, and is flagged `tracking_incomplete` — shown on the dashboard as a warning, since its exact timestamps may be off by however long the bot was down.

## Attendance outcomes

Computed per member from their voice-channel join/leave history for that event (declined sign-ups are never tracked at all):

| Outcome | Meaning |
| --- | --- |
| **Pünktlich** (on time) | In the voice channel at the exact moment the event started. |
| **Zu spät** (late) | Joined after the event started. |
| **Nicht erschienen** (no-show) | Never joined during the whole event window. |
| **Früher gegangen** (left early) | Joined, then left before the event ended, and never came back. |
| **Nicht getrackt** (not tracked) | The bot was offline for the entire window, or the voice channel wasn't configured/visible. |

**Rejoining un-flags "left early"**: if someone leaves and comes back before the event ends, their final status is based on their original join time (on time or late), not left-early — the whole join/leave history is replayed fresh every time, nothing is locked in early.

## Dashboard

**Event-Anwesenheit** in the nav opens a list view: events as cards (title, time range, status, sign-up counts, and once tracking has started, attendance counts), grouped by calendar month. Prev/next arrows, a "Heute" button, and a calendar-style month picker (click the month/year label to open a year grid; months with events are highlighted and badged with their event count) move between months; a title search box scopes to the current month by default, with an "in allen Monaten suchen" escape hatch when nothing turns up there. Clicking a card opens that event's detail view — the full signup table (one row per signed-up member: RSVP choice, attendance outcome, join/leave timestamps, and — for a historical unmatched/ambiguous row — a picker to link it to the right member by hand), a name search and an outcome filter both scoped to just that event's already-loaded signups, a summary tally (including a "davon N leicht verspätet"/"leicht früher gegangen" breakdown for grace-period near-misses), and the event's delete action.

The **Vorlagen** tab manages templates (create/edit/delete/publish) — see "Creating and publishing an event" above. `Event` is a single nav entry with two tabs (`Anwesenheit`/`Vorlagen`), matching Settings.tsx's tab pattern.
