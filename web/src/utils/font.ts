/**
 * Client-side mirror of src/utils/font.ts's "fancy text" font support — the
 * two never share code (one runs in the browser, one on the bot), but must
 * stay in sync so a dashboard preview matches what the bot actually posts.
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
 * `fontMap`; anything else passes through unchanged. Iterates by code point
 * so a supplementary-plane alphabet (e.g. Mathematical Bold) round-trips
 * correctly instead of splitting a surrogate pair in half.
 */
export function applyFont(text: string, fontMap: string | null | undefined): string {
  if (!fontMap || !isValidFontMap(fontMap)) return text;
  const reference = [...FONT_REFERENCE];
  const styled = [...fontMap];
  const table = new Map<string, string>();
  reference.forEach((ch, i) => table.set(ch, styled[i]!));
  return [...text].map((ch) => table.get(ch) ?? ch).join("");
}
