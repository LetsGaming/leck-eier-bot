/**
 * Shared "fancy text" font support — set once globally (`settings.fontMap`,
 * see DATABASE.md#settings), then opted into per feature (the birthday
 * anchor message, the daily birthday announcement, a reaction-role panel's
 * text) via that feature's own `useFont`/`*UseFont` flag, so nothing has to
 * paste the alphabet more than once.
 */

/** The 52-character reference alphabet a pasted font is matched against, position for position. */
export const FONT_REFERENCE = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz";

/** Counted by code point, not UTF-16 code unit, since many stylized alphabets use characters outside the BMP. */
export function isValidFontMap(fontMap: string): boolean {
  return [...fontMap].length === FONT_REFERENCE.length;
}

/**
 * Re-renders `text` through a pasted font map, substituting each character
 * that appears in FONT_REFERENCE with whatever sits at the same position in
 * `fontMap`; anything else (digits, punctuation, emoji, mentions) passes
 * through unchanged — so it's always safe to apply to a fully-rendered
 * message, mentions and all. Iterates by code point rather than UTF-16 code
 * unit so a supplementary-plane alphabet like Mathematical Bold (𝐀𝐁𝐂…,
 * U+1D400+) round-trips correctly instead of splitting a surrogate pair in
 * half.
 */
export function applyFont(text: string, fontMap: string | null): string {
  if (!fontMap || !isValidFontMap(fontMap)) return text;
  const reference = [...FONT_REFERENCE];
  const styled = [...fontMap];
  const table = new Map<string, string>();
  reference.forEach((ch, i) => table.set(ch, styled[i]!));
  return [...text].map((ch) => table.get(ch) ?? ch).join("");
}
