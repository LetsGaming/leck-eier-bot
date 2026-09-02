# Event Attendance (Apollo)

Tracks who actually showed up to an [Apollo](https://apollo.fyi/) event, compared against who signed up. Apollo posts an embed where members click Accept/Decline/Tentative; when the event starts, the bot checks who's in one fixed voice channel and keeps watching until the event ends, then shows the result — sign-up choice vs. actual outcome, per member, per event — on the dashboard's **Event-Anwesenheit** page.

## Setup

Two settings, both on the dashboard's Settings page under "Event-Anwesenheit (Apollo)":

- **Apollo-Event-Kanal** — the channel Apollo posts its event embeds in.
- **Event-Sprachkanal** — the one voice channel every tracked event happens in.

Leave either empty to disable the feature. See [PERMISSIONS.md](PERMISSIONS.md) for the (non-privileged) `GuildVoiceStates` intent this needs, and note the bot must be able to **View Channel** on the configured voice channel — otherwise it can't see who's in it at all.

Events are assumed to never overlap — one voice channel, one event at a time. If two Apollo events end up active simultaneously, the bot logs a warning and only tracks the earliest.

## How detection works

The bot doesn't hardcode Apollo's application id. Instead, any message in the configured channel is checked for the *shape* of an Apollo event embed: at least one field whose name (after stripping emoji/counts) matches an RSVP label — "Accepted"/"Declined"/"Tentative" or a German equivalent. See `APOLLO_RSVP_FIELD_LABELS` in `src/constants.ts`.

**Caveat:** these labels (and the exact format Apollo uses for start/end times, guest counts, etc.) are a best-effort guess, not confirmed against a real Apollo embed on this server yet. If parsing doesn't pick up a real event, the labels or the parsing rules in `src/services/apolloEventParser.ts` likely need adjusting — see "Verifying against a real embed" below.

Start/end times are read from Discord timestamp tokens (`<t:1234567890:F>`) in the embed's "Time" field, which is what Apollo's rendered date/time actually is under the hood. If those are ever missing, the bot falls back to the `dates=` parameter on Apollo's "add to Google Calendar" link.

The event's identity is the numeric id from its `apollo.fyi/.../events/<id>` link, found anywhere in the embed (url, footer, fields, or a link-button component) — this survives Apollo editing the message in place as RSVPs change. If that id can't be found, the Discord message id is used instead, which is still stable across edits but won't correctly distinguish two different occurrences of a recurring event that reuse a message.

Each RSVP field's list is split one name per line. Every non-empty line is treated as one member's current display name/nickname exactly as it appears — including the emoji at the front, since (on this server) that's part of the member's actual nickname, not decoration Apollo added.

## Matching a name to a member

Apollo's embed only has plain text, no user mentions — so a name has to be matched against the live member cache. This is an **exact match**, not a fuzzy one: the name is normalized (the same normalization used elsewhere for search — strips the bot's styled-nickname font, punctuation, accents, and case) and compared against every member's current nickname/username/global name. Since virtually every member's nickname already carries the bot's enforced `💙NAME — surname` format, this resolves cleanly in practice; an unstyled name is the rare edge case that won't match anything.

A name that doesn't match exactly (zero matches, or ambiguously matches more than one member) is recorded as-is (`match_source: 'unmatched'`/`'ambiguous'`) and shown on the dashboard with a member picker to link it by hand. A manual link is never overwritten by a later re-parse of the Apollo message.

## The state machine

Each event is `scheduled` → `active` → `completed` (or `cancelled` if its message is deleted while still `scheduled`). A background sweep (every 30 seconds, plus a catch-up pass at startup) drives the transitions:

- **Activation** (start time reached): snapshots who's currently in the configured voice channel as "present at start", and locks in which voice channel is being used for this event.
- **While active**: every join/leave in that channel is logged live (via Discord's voice-state events), for anyone in the channel — not just resolved signups, so a name linked *after* the event can still have their real attendance reconstructed from the log.
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

**Event-Anwesenheit** in the nav lists every detected event, newest first, each as its own card: title, time range, status, a link back to the original Apollo message, sign-up counts, and (once tracking has started) attendance counts. Below that, one row per signed-up member: their sign-up choice, their attendance outcome, join/leave timestamps, and — for an unmatched or ambiguous name — a picker to link it to the right member by hand. A search box and a "nur Probleme" filter narrow the view down to what needs attention.

## Verifying against a real embed

Since the exact Apollo embed format hasn't been confirmed on this server, the fastest way to validate (or fix) `src/services/apolloEventParser.ts` after a real event gets posted — no code changes needed, just an env var:

1. Set `LOG_APOLLO_EMBEDS=true` in `.env` and restart the bot (see [CONFIGURATION.md § Debug variables](CONFIGURATION.md#debug-variables)).
2. Post (or wait for) a real Apollo event in the configured channel — every message there gets its raw embed/component JSON logged before parsing, whether parsing succeeds or not.
3. Compare the field names/values against what `APOLLO_RSVP_FIELD_LABELS`/the timestamp-token regex expect, and adjust `src/constants.ts`/`src/services/apolloEventParser.ts` as needed.
4. Set `LOG_APOLLO_EMBEDS` back to `false` (or remove it) and restart once satisfied — it logs every message in the channel indefinitely otherwise.

The parser is pure and side-effect-free (no `client`, no DB) — it can also be exercised directly with a synthetic object shaped like `{ embeds: [...], components: [...] }` in a throwaway script, without needing a live Discord connection at all.
