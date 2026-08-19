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

/**
 * Whether any of `names` matches `query`, normalizing fancy Unicode
 * lookalike characters and transliterating both sides first so stylized
 * names still match. An empty query always matches (a "list everyone, no
 * filter yet" state) — shared by `/finduser`, `searchCachedMembers()` below,
 * and the dashboard's Member Audit page (`web/routes/memberAudit.ts`), which
 * also needs to filter former members it has no live GuildMember for.
 */
export function matchesSearch(query: string, names: Array<string | null | undefined>): boolean {
  const normalizedSearch = normalizeForSearch(query);
  if (!normalizedSearch) return true;
  return names.some((n) => normalizeForSearch(n).includes(normalizedSearch));
}

/**
 * Searches the in-memory member cache by username/global name/nickname/
 * display name — see `matchesSearch()`. Used by `/finduser`; the dashboard's
 * Member Audit page calls `matchesSearch()` directly instead, since it needs
 * to filter former members alongside cached ones.
 */
export function searchCachedMembers(query: string, limit: number = FIND_USER_RESULT_LIMIT): GuildMember[] {
  const matched = getCachedMembers().filter((member) =>
    matchesSearch(query, [member.user.username, member.user.globalName, member.nickname, member.displayName]),
  );
  return [...matched.values()].slice(0, limit);
}
