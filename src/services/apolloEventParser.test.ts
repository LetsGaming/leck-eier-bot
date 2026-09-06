import { test } from "node:test";
import assert from "node:assert/strict";
import type { Embed, APIEmbed } from "discord.js";
import { parseApolloEventEmbed, type ApolloMessageLike } from "./apolloEventParser.js";
import { APOLLO_EVENT_DEFAULT_DURATION_MS } from "../constants.js";

/**
 * Builds a synthetic `Embed`-shaped object from plain API-embed data — the
 * parser only ever reads a handful of getters off it (`fields`, `title`,
 * `description`, `url`, `footer`); the real `Embed` class's constructor is
 * private in discord.js's typings (constructible only from within the
 * library itself), so a structurally-equivalent plain object stands in for
 * it here, exactly as `ApolloMessageLike`'s own doc comment intends.
 */
function embed(data: APIEmbed): Embed {
  return {
    fields: data.fields ?? [],
    title: data.title ?? null,
    description: data.description ?? null,
    url: data.url ?? null,
    footer: data.footer ? { text: data.footer.text, iconURL: data.footer.icon_url ?? null, proxyIconURL: null } : null,
  } as unknown as Embed;
}

function message(embeds: Embed[], components: unknown[] = []): ApolloMessageLike {
  return { embeds, components };
}

/** A link-button component, shaped like what `extractComponentUrls()` walks (it only ever reads `.url` and, recursively, `.components`; no `toJSON` needed since these are already plain objects). */
function linkButton(url: string): unknown {
  return { type: 2, style: 5, url };
}

// --- Happy path ---

test("parseApolloEventEmbed: well-formed embed with two timestamps, title link, and mixed RSVP fields", () => {
  const e = embed({
    title: "[Raid Night](https://apollo.fyi/e/12345)",
    url: "https://apollo.fyi/e/12345",
    description: "Come one come all",
    fields: [
      { name: "Time", value: "<t:1756832400:F> - <t:1756843200:F>", inline: false },
      { name: "✅ Accepted (2)", value: ">>> Alice\nBob", inline: true },
      { name: "❌ Declined (1)", value: "Carol", inline: true },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.ok(result);
  assert.equal(result!.title, "Raid Night");
  assert.equal(result!.apolloEventId, "12345");
  assert.equal(result!.startsAt, new Date(1756832400 * 1000).toISOString());
  assert.equal(result!.endsAt, new Date(1756843200 * 1000).toISOString());
  assert.deepEqual(result!.signups, [
    { rawName: "Alice", choice: "accepted", mentionUserId: null },
    { rawName: "Bob", choice: "accepted", mentionUserId: null },
    { rawName: "Carol", choice: "declined", mentionUserId: null },
  ]);
});

// --- Detection / no-match cases ---

test("parseApolloEventEmbed: no embeds at all -> null", () => {
  assert.equal(parseApolloEventEmbed(message([])), null);
});

test("parseApolloEventEmbed: embed with no RSVP-shaped fields -> null (not an Apollo event embed)", () => {
  const e = embed({
    title: "Some other bot's embed",
    fields: [{ name: "Random Field", value: "whatever" }],
  });
  assert.equal(parseApolloEventEmbed(message([e])), null);
});

test("parseApolloEventEmbed: RSVP fields present but no timestamp/calendar source anywhere -> null", () => {
  const e = embed({
    title: "Untimed Event",
    fields: [{ name: "Accepted", value: "Alice" }],
  });
  assert.equal(parseApolloEventEmbed(message([e])), null);
});

// --- Title handling ---

test("parseApolloEventEmbed: missing title falls back to '(ohne Titel)'", () => {
  const e = embed({
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.title, "(ohne Titel)");
});

test("parseApolloEventEmbed: plain (non-link) title is used as-is", () => {
  const e = embed({
    title: "Plain Title",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.title, "Plain Title");
});

// --- normalizeFieldLabel edge cases ---

test("normalizeFieldLabel (via field matching): trailing (N) count suffix is stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted (3)", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.signups[0]!.choice, "accepted");
});

test("normalizeFieldLabel: trailing (N/M) actual/cap count suffix (signup-cap format) is stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted (2/1)", value: "Alice\nBob" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.signups.length, 2);
  assert.equal(result!.signups[0]!.choice, "accepted");
});

test("normalizeFieldLabel: unicode emoji decoration and custom emoji token in the field name are stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "<:check:713124484436983971> Accepted ✅", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.signups[0]!.choice, "accepted");
});

test("normalizeFieldLabel: German field-label variants map to the expected choice", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Zeit", value: "<t:1756832400:F>" },
      { name: "Zugesagt", value: "Alice" },
      { name: "Abgesagt", value: "Bob" },
      { name: "Vielleicht", value: "Carol" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.choice),
    ["accepted", "declined", "tentative"],
  );
});

test("normalizeFieldLabel: 'Waitlist' field maps to 'accepted' (waitlisted members did click Accept)", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Waitlist", value: "Dave" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.signups[0]!.choice, "accepted");
});

// --- splitRsvpLines edge cases ---

test("splitRsvpLines: '>>> ' block-quote marker prefixes the whole field value exactly once", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: ">>> Alice\nBob\nCarol" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Alice", "Bob", "Carol"],
  );
});

test("splitRsvpLines: defensive fallback strips a per-line '> ' quote marker too", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      // Outer regex eats the leading "> " of the first line only; the
      // per-line fallback strips it from the remaining lines.
      { name: "Accepted", value: "> Alice\n> Bob" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Alice", "Bob"],
  );
});

test("splitRsvpLines: numbered and bulleted list prefixes are stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "1. Alice\n2) Bob\n- Carol\n* Dave\n• Eve" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Alice", "Bob", "Carol", "Dave", "Eve"],
  );
});

test("splitRsvpLines: Waitlist's custom accepted-checkmark emoji token is stripped, but a genuine unicode emoji in a nickname is left untouched", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      {
        name: "Waitlist",
        value: "<:accepted:713124484436983971> Frank\n💙 Grace",
      },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Frank", "💙 Grace"],
  );
});

test("splitRsvpLines: trailing '(+N)' plus-one count is stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice (+2)" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.signups[0]!.rawName, "Alice");
});

test("splitRsvpLines: markdown wrapping (bold/italic/strike/code) around a name is stripped", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "**Alice**\n_Bob_\n~Carol~\n`Dave`" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Alice", "Bob", "Carol", "Dave"],
  );
});

test("splitRsvpLines: empty lines and dash/underscore-only separator lines are filtered out", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice\n\n---\n___\nBob\n   " },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(
    result!.signups.map((s) => s.rawName),
    ["Alice", "Bob"],
  );
});

test("splitRsvpLines: an empty signup field yields zero signups for that choice", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(result!.signups, []);
});

test("splitRsvpLines: a plain '<@id>' mention line short-circuits to mentionUserId, rawName kept verbatim", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "<@123456789012345678>\n<@!987654321098765432>" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.deepEqual(result!.signups, [
    { rawName: "<@123456789012345678>", choice: "accepted", mentionUserId: "123456789012345678" },
    { rawName: "<@!987654321098765432>", choice: "accepted", mentionUserId: "987654321098765432" },
  ]);
});

// --- Timestamp extraction ---

test("extractTimestampEpochs: 'Time'-labeled field is searched first; two distinct epochs there win", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F> <t:1756843200:R>" },
      { name: "Accepted", value: "<t:9999999999:F> Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.startsAt, new Date(1756832400 * 1000).toISOString());
  assert.equal(result!.endsAt, new Date(1756843200 * 1000).toISOString());
});

test("extractTimestampEpochs: a repeated identical epoch token doesn't count twice; search continues to other fields for the second distinct one", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F> <t:1756832400:R>" },
      { name: "Accepted", value: "Alice" },
      { name: "Description note", value: "ends at <t:1756843200:F>" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.startsAt, new Date(1756832400 * 1000).toISOString());
  assert.equal(result!.endsAt, new Date(1756843200 * 1000).toISOString());
});

test("extractTimestampEpochs: exactly one epoch found -> end is start + default duration", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  const expectedStart = new Date(1756832400 * 1000);
  assert.equal(result!.startsAt, expectedStart.toISOString());
  assert.equal(
    result!.endsAt,
    new Date(expectedStart.getTime() + APOLLO_EVENT_DEFAULT_DURATION_MS).toISOString(),
  );
});

// --- Google Calendar `dates=` fallback ---

test("Google Calendar dates= fallback: no timestamp tokens anywhere, but a literal-slash dates= link in the description is used", () => {
  const e = embed({
    title: "T",
    description: "Add to calendar: https://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260902T165000Z/20260902T175000Z",
    fields: [{ name: "Accepted", value: "Alice" }],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.startsAt, "2026-09-02T16:50:00.000Z");
  assert.equal(result!.endsAt, "2026-09-02T17:50:00.000Z");
});

test("Google Calendar dates= fallback: %2F-encoded separator (as seen in a URL-encoded link button) is also matched", () => {
  const e = embed({
    title: "T",
    fields: [{ name: "Accepted", value: "Alice" }],
  });
  const components = [
    linkButton(
      "https://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260902T165000Z%2F20260902T175000Z",
    ),
  ];
  const result = parseApolloEventEmbed(message([e], components));
  assert.equal(result!.startsAt, "2026-09-02T16:50:00.000Z");
  assert.equal(result!.endsAt, "2026-09-02T17:50:00.000Z");
});

test("Google Calendar dates= fallback: also found in a plain field value, not just the description", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Accepted", value: "Alice" },
      {
        name: "Links",
        value: "https://calendar.google.com/calendar/render?dates=20260902T165000Z/20260902T175000Z",
      },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.startsAt, "2026-09-02T16:50:00.000Z");
  assert.equal(result!.endsAt, "2026-09-02T17:50:00.000Z");
});

// --- apolloEventId extraction ---

test("apolloEventId: long-form apollo.fyi/workspaces/<id>/events/<id> link (arbitrary path segments before events/<id>)", () => {
  const e = embed({
    title: "T",
    url: "https://apollo.fyi/workspaces/abc123/events/98765",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.apolloEventId, "98765");
});

test("apolloEventId: short-form apollo.fyi/e/<id> link", () => {
  const e = embed({
    title: "T",
    url: "https://apollo.fyi/e/54321",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.apolloEventId, "54321");
});

test("apolloEventId: found in a link-button component when absent from the embed itself", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const components = [linkButton("https://apollo.fyi/e/11223")];
  const result = parseApolloEventEmbed(message([e], components));
  assert.equal(result!.apolloEventId, "11223");
});

test("apolloEventId: found in the embed footer text", () => {
  const e = embed({
    title: "T",
    footer: { text: "Event: https://apollo.fyi/e/33445" },
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.apolloEventId, "33445");
});

test("apolloEventId: null (not found anywhere) is a valid result — caller falls back to the message id", () => {
  const e = embed({
    title: "T",
    fields: [
      { name: "Time", value: "<t:1756832400:F>" },
      { name: "Accepted", value: "Alice" },
    ],
  });
  const result = parseApolloEventEmbed(message([e]));
  assert.equal(result!.apolloEventId, null);
});
