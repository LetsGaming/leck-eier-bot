import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../../src/shared/messageTemplate.js";
import { FONT_REFERENCE } from "../../src/utils/font.js";
import { renderBirthdayTemplate, buildAnchorParts } from "../../src/services/birthdays.js";
import type { BirthdaysByDate } from "../../src/types.js";

function birthdaysOn(dateKey: string): BirthdaysByDate {
  return { [dateKey]: [{ id: 1, date: dateKey, mention: "<@1>", userId: "1", name: "A", source: "list" }] };
}

/**
 * A valid 52-char font map (see utils/font.ts's `isValidFontMap`) that swaps
 * the case of every reference letter, so the transform is deterministic and
 * easy to assert on: uppercase Latin letters come back lowercase and vice
 * versa; everything else (digits, punctuation, mention syntax) is untouched.
 */
const SWAP_CASE_FONT_MAP = [...FONT_REFERENCE]
  .map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
  .join("");

test("renderTemplate: raw context is substituted unstyled", () => {
  const result = renderTemplate(
    "Hello {name}!",
    { raw: { name: "World" } },
    {},
    { useFont: true, fontMap: SWAP_CASE_FONT_MAP },
  );
  // Literal template text IS font-mapped ("Hello" -> "hELLO", "!" untouched),
  // but the raw-substituted value is not.
  assert.equal(result, "hELLO World!");
});

test("renderTemplate: styled context is font-mapped, then substituted", () => {
  const result = renderTemplate(
    "Month: {month}",
    { styled: { month: "March" } },
    {},
    { useFont: true, fontMap: SWAP_CASE_FONT_MAP },
  );
  assert.equal(result, "mONTH: mARCH");
});

test("renderTemplate: styled and raw tokens combine, each following their own rule", () => {
  const result = renderTemplate(
    "{month}: {entries}",
    { styled: { month: "March" }, raw: { entries: "<@1>, <@2>" } },
    {},
    { useFont: true, fontMap: SWAP_CASE_FONT_MAP },
  );
  // {month} is font-mapped (styled); {entries} is left exactly as given (raw),
  // even though it contains plain Latin-free mention syntax that would be
  // untouched by applyFont anyway — the key assertion is the literal ": "
  // between them still gets font-mapped as template text.
  assert.equal(result, "mARCH: <@1>, <@2>");
});

test("renderTemplate: unresolved token braces are never corrupted by the styled pass", () => {
  // If pass 1 blindly font-mapped the *entire* template (including token
  // syntax not yet substituted), the letters inside "{userMention}" would
  // themselves get font-mapped, and pass 2's regex would no longer find a
  // literal "{userMention}" to substitute. This must not happen.
  const result = renderTemplate(
    "Hi {userMention}!",
    { raw: { userMention: "<@123>" } },
    {},
    { useFont: true, fontMap: SWAP_CASE_FONT_MAP },
  );
  assert.equal(result, "hI <@123>!");
});

test("renderTemplate: core channel/user/role tokens resolve unstyled", () => {
  const result = renderTemplate(
    "See {channel:1} and ping {user:2} / {role:3}",
    {},
    {
      channel: (id) => `<#${id}>`,
      user: (id) => `<@${id}>`,
      role: (id) => `<@&${id}>`,
    },
    { useFont: true, fontMap: SWAP_CASE_FONT_MAP },
  );
  // "See" / "and ping" / " / " are literal template text -> font-mapped;
  // the resolved mention tokens are not.
  assert.equal(result, "sEE <#1> AND PING <@2> / <@&3>");
});

test("renderTemplate: bare {date} core token resolves to today's date, unstyled", () => {
  const now = new Date();
  const expected = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const result = renderTemplate("Today: {date}", {}, {}, { useFont: false, fontMap: null });
  assert.equal(result, `Today: ${expected}`);
});

test("renderTemplate: unknown/missing tokens are left as literal text", () => {
  const result = renderTemplate(
    "{known} and {unknown} and {channel:1}",
    { raw: { known: "yes" } },
    {}, // no channel resolver registered -> {channel:1} also stays literal
    { useFont: false, fontMap: null },
  );
  assert.equal(result, "yes and {unknown} and {channel:1}");
});

test("renderTemplate: useFont:false disables font-mapping even with a styled context and valid fontMap", () => {
  const result = renderTemplate(
    "Month: {month}",
    { styled: { month: "March" } },
    {},
    { useFont: false, fontMap: SWAP_CASE_FONT_MAP },
  );
  assert.equal(result, "Month: March");
});

test("renderTemplate: an invalid fontMap is a no-op, matching applyFont's own guard", () => {
  const result = renderTemplate("{month}", { styled: { month: "March" } }, {}, { useFont: true, fontMap: "too-short" });
  assert.equal(result, "March");
});

// --- Feature-specific coverage: birthdays -----------------------------------

test("birthdays: renderBirthdayTemplate substitutes userMention/everyoneMention/userNick, all raw", () => {
  const result = renderBirthdayTemplate("{everyoneMention} {userMention} is now older, {userNick}!", {
    mention: "<@42>",
    userId: "42",
    name: "Alex",
  });
  assert.equal(result, "@everyone <@42> is now older, Alex!");
});

test("birthdays: renderBirthdayTemplate falls back to <@userId>/'Friend' when mention/name are missing", () => {
  const result = renderBirthdayTemplate("{userMention} / {userNick}", { mention: "", userId: "", name: "" }, false);
  assert.equal(result, " / Friend");
});

test("birthdays: renderBirthdayTemplate respects pingEveryone=false", () => {
  const result = renderBirthdayTemplate("{everyoneMention}x", { mention: "<@1>", userId: "1", name: "A" }, false);
  assert.equal(result, "x");
});

test("birthdays: buildAnchorParts fonts {month} but leaves {entries} raw, per-month", () => {
  const parts = buildAnchorParts(birthdaysOn("05.03"), "{month}\n{entries}", SWAP_CASE_FONT_MAP, null);
  const marchPart = parts.find((p) => p.key === "3");
  assert.ok(marchPart);
  // "März" (month 3) is font-mapped ('ä' isn't in the Latin reference table
  // and passes through unchanged); the entries line (mentions/dates) is not.
  assert.equal(marchPart!.text, "mäRZ\nღ: 05.03: <@1>");
});

test("birthdays: buildAnchorParts does NOT font-map the template's own literal text — only the {month} value (regression)", () => {
  // Regression guard for a real bug: buildAnchorParts() must reproduce the
  // pre-migration `.replace()` chain, which only ever ran applyFont() on the
  // substituted month heading — never on the template's own literal text.
  // renderTemplate()'s general pass-1 contract *does* font-map a whole
  // template's literal text runs (see the "raw context is substituted
  // unstyled" test above, where "Hello" IS font-mapped) — that's correct
  // and intentional for the engine in general, but buildAnchorParts() must
  // deliberately bypass it (see its doc comment in birthdays.ts) precisely
  // because birthdayAnchorTemplate is a free-text field that commonly
  // contains literal Latin-letter text like "Born in " below, which the old
  // code never touched.
  const parts = buildAnchorParts(birthdaysOn("05.03"), "Born in {month}:\n{entries}", SWAP_CASE_FONT_MAP, null);
  const marchPart = parts.find((p) => p.key === "3");
  assert.ok(marchPart);
  // "Born in " and ":\n" stay exactly as typed; only "März" is font-mapped
  // ('ä' isn't in the Latin reference table and passes through unchanged);
  // the entries line (mentions/dates) is untouched either way.
  assert.equal(marchPart!.text, "Born in mäRZ:\nღ: 05.03: <@1>");
});

test("birthdays: buildAnchorParts appends entries after the template when {entries} is absent", () => {
  const parts = buildAnchorParts(birthdaysOn("05.03"), "{month}", null, null);
  const marchPart = parts.find((p) => p.key === "3");
  assert.equal(marchPart!.text, "März\nღ: 05.03: <@1>");
});

test("birthdays: buildAnchorParts uses the 'empty' fallback when there are no entries at all", () => {
  const parts = buildAnchorParts({}, "{month}\n{entries}", null, null);
  assert.deepEqual(
    parts.map((p) => p.key),
    ["empty"],
  );
});

// --- Feature-specific coverage: reaction-role panels (via renderTemplate directly) ---
// buildPanelText/buildPanelEmbed's `styled()` helper isn't exported (it's a
// one-line pass-through — see src/services/reactionRoles.ts), so its exact
// call shape is exercised here directly: no context, no core resolvers, just
// a fully-composed string and a font toggle.

test("reactionRoles-equivalent: renderTemplate with no context reduces to plain applyFont", () => {
  const composed = "🎮 — <@&1>, <@&2> — Gamer role";
  const styledOn = renderTemplate(composed, {}, {}, { useFont: true, fontMap: SWAP_CASE_FONT_MAP });
  const styledOff = renderTemplate(composed, {}, {}, { useFont: false, fontMap: SWAP_CASE_FONT_MAP });
  assert.equal(styledOn, "🎮 — <@&1>, <@&2> — gAMER ROLE");
  assert.equal(styledOff, composed);
});

// --- Feature-specific coverage: registration confirmation (renderTemplate call shape) ---
// Mirrors renderConfirmation()'s exact renderTemplate call from
// src/services/registration.ts. A channel reference is literal `<#id>` text
// already (inserted via the `#`-trigger popover), so this needs no core
// resolver — only the `{name}` raw substitution.

function renderConfirmationEquivalent(template: string, name: string): string {
  return renderTemplate(template, { raw: { name } }, {}, { useFont: false, fontMap: null });
}

test("registerWatcher-equivalent: {name} is substituted unstyled", () => {
  const result = renderConfirmationEquivalent("Willkommen {name}! Schau in <#555> vorbei.", "Alex");
  assert.equal(result, "Willkommen Alex! Schau in <#555> vorbei.");
});

test("registerWatcher-equivalent: an unrecognized token is left as literal text", () => {
  const result = renderConfirmationEquivalent("Willkommen {name}! {unknownToken}", "Alex");
  assert.equal(result, "Willkommen Alex! {unknownToken}");
});
