import type { GuildMember } from "discord.js";
import { transliterate } from "transliteration";
import { getCachedMembers } from "./memberCache.js";
import { FIND_USER_RESULT_LIMIT } from "../constants.js";

/** Unicode ranges for the "Mathematical Alphanumeric Symbols" block, mapped back to plain ASCII. */
const MATH_ALPHANUMERIC_RANGES: Array<{ start: number; end: number; base: number }> = [
  { start: 0x1d400, end: 0x1d419, base: 65 }, // Bold A-Z
  { start: 0x1d41a, end: 0x1d433, base: 97 }, // Bold a-z
  { start: 0x1d434, end: 0x1d44d, base: 65 }, // Italic A-Z
  { start: 0x1d44e, end: 0x1d467, base: 97 }, // Italic a-z
  { start: 0x1d468, end: 0x1d481, base: 65 }, // Bold Italic A-Z
  { start: 0x1d482, end: 0x1d49b, base: 97 }, // Bold Italic a-z
  { start: 0x1d5a0, end: 0x1d5b9, base: 65 }, // Sans-Serif A-Z
  { start: 0x1d5ba, end: 0x1d5d3, base: 97 }, // Sans-Serif a-z
];

function unfancy(text: string): string {
  return text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => {
    const cp = char.codePointAt(0)!;
    const range = MATH_ALPHANUMERIC_RANGES.find((r) => cp >= r.start && cp <= r.end);
    return range ? String.fromCharCode(cp - range.start + range.base) : char;
  });
}

function normalizeForSearch(str: string | null | undefined): string {
  if (!str) return "";

  return transliterate(unfancy(str))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Relevance tiers for `scoreCandidate()`, highest first. Multiplied by `TIER_MULTIPLIER` and combined with a length penalty so ties within a tier favor the shorter (tighter) match. */
const SCORE_EXACT = 4;
const SCORE_PREFIX = 3;
const SCORE_WORD_BOUNDARY = 2;
const SCORE_SUBSTRING = 1;
const TIER_MULTIPLIER = 10_000;

/** Score returned by `scoreMatch()` for an empty query, so "no filter" still lists everyone with a positive, constant score instead of ranking them. */
const EMPTY_QUERY_SCORE = 1;

/**
 * Scores one already-normalized candidate against an already-normalized
 * query. `0` means no match. Tiers (highest first): exact equality, prefix
 * match, match at the start of a word (space-separated, so "lu" matches
 * "Max Luna" but not "Almuth"), then any substring match. Within a tier,
 * shorter candidates score higher so tight matches outrank incidental ones
 * (e.g. a 4-char name that equals the query outranks a 20-char name that
 * merely contains it).
 */
function scoreCandidate(normalizedQuery: string, normalizedCandidate: string): number {
  if (!normalizedCandidate) return 0;

  let tier: number;
  if (normalizedCandidate === normalizedQuery) {
    tier = SCORE_EXACT;
  } else if (normalizedCandidate.startsWith(normalizedQuery)) {
    tier = SCORE_PREFIX;
  } else if (normalizedCandidate.split(" ").some((word) => word.startsWith(normalizedQuery))) {
    tier = SCORE_WORD_BOUNDARY;
  } else if (normalizedCandidate.includes(normalizedQuery)) {
    tier = SCORE_SUBSTRING;
  } else {
    return 0;
  }

  return tier * TIER_MULTIPLIER - normalizedCandidate.length;
}

/**
 * Scores how well any of `names` matches `query`, normalizing fancy Unicode
 * lookalike characters and transliterating both sides first so stylized
 * names still match — see `scoreCandidate()` for the tiering. Returns the
 * best score across `names` (member has multiple name fields: username,
 * global name, nickname, display name), or `0` if none match. An empty
 * query always returns `EMPTY_QUERY_SCORE` (a "list everyone, no filter yet"
 * state) — shared by `/finduser`, `searchCachedMembers()` below, and the
 * dashboard's Member Audit page (`web/routes/memberAudit.ts`), which also
 * needs to filter former members it has no live GuildMember for.
 */
export function scoreMatch(query: string, names: Array<string | null | undefined>): number {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return EMPTY_QUERY_SCORE;

  let best = 0;
  for (const name of names) {
    const score = scoreCandidate(normalizedQuery, normalizeForSearch(name));
    if (score > best) best = score;
  }
  return best;
}

/**
 * Whether any of `names` matches `query` — a thin boolean wrapper around
 * `scoreMatch()`. Semantics are unchanged for existing callers: an empty
 * query always matches, and any tier (exact/prefix/word-boundary/substring)
 * counts as a match.
 */
export function matchesSearch(query: string, names: Array<string | null | undefined>): boolean {
  return scoreMatch(query, names) > 0;
}

/**
 * Searches the in-memory member cache by username/global name/nickname/
 * display name, ranked by relevance (best match first) via `scoreMatch()` —
 * see there for tiering. Used by `/finduser`; the dashboard's Member Audit
 * page calls `matchesSearch()`/`scoreMatch()` directly instead, since it
 * needs to filter former members alongside cached ones.
 */
export function searchCachedMembers(query: string, limit: number = FIND_USER_RESULT_LIMIT): GuildMember[] {
  const scored: Array<{ member: GuildMember; score: number }> = [];
  for (const member of getCachedMembers().values()) {
    const score = scoreMatch(query, [
      member.user.username,
      member.user.globalName,
      member.nickname,
      member.displayName,
    ]);
    if (score > 0) scored.push({ member, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.member);
}

export type NameResolution =
  | { status: "matched"; userId: string }
  | { status: "unmatched" }
  | { status: "ambiguous"; userIds: string[] };

/**
 * Resolves a single free-text name (e.g. one line of an Apollo RSVP list) to
 * exactly one guild member, by exact match after normalization —
 * deliberately NOT `matchesSearch()`'s substring logic, which would
 * false-positive here (e.g. "Lu" substring-matching both "Luna" and "Lucy").
 * Almost always resolves cleanly since this server's nickname convention
 * (see `buildRegisterNickname()` in `events/registerWatcher.ts`) is what
 * `unfancy()`/`normalizeForSearch()` were built to undo; an unstyled name
 * that doesn't match anyone is the rare edge case this reports as
 * `unmatched` for manual reconciliation rather than guessing.
 */
export function resolveMemberByExactName(rawName: string): NameResolution {
  const target = normalizeForSearch(rawName);
  if (!target) return { status: "unmatched" };

  const matches = [...getCachedMembers().values()].filter((member) =>
    [member.user.username, member.user.globalName, member.nickname, member.displayName].some(
      (candidate) => normalizeForSearch(candidate) === target,
    ),
  );

  if (matches.length === 0) return { status: "unmatched" };
  if (matches.length === 1) return { status: "matched", userId: matches[0]!.id };
  return { status: "ambiguous", userIds: matches.map((m) => m.id) };
}

/** The same normalization `resolveMemberByExactName()` matches against, exposed so callers can compute a stable natural key (e.g. `apollo_event_signups.normalized_name`) without needing the live member cache. */
export function normalizeSignupName(rawName: string): string {
  return normalizeForSearch(rawName);
}
