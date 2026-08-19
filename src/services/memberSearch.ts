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
 * Searches the in-memory member cache by username/global name/nickname/
 * display name, normalizing fancy Unicode lookalike characters and
 * transliterating first so stylized names still match. Shared by both
 * `/finduser` and the dashboard's Find User page — see docs/ARCHITECTURE.md
 * for why logic like this lives here rather than in either caller.
 */
export function searchCachedMembers(query: string, limit: number = FIND_USER_RESULT_LIMIT): GuildMember[] {
  const normalizedSearch = normalizeForSearch(query);
  const members = getCachedMembers();

  const matched = members.filter((member) => {
    const names = [member.user.username, member.user.globalName, member.nickname, member.displayName].filter(
      Boolean,
    );
    return names.some((n) => normalizeForSearch(n).includes(normalizedSearch));
  });

  return [...matched.values()].slice(0, limit);
}
