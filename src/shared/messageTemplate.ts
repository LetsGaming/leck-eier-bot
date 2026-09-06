/**
 * Shared token-rendering engine — the single place that understands `{token}`
 * substitution syntax for every feature that sends a templated message
 * (birthday announcements/anchor, reaction-role panels, registration
 * confirmations). See `docs/superpowers/specs/2026-09-05-message-composition-design.md`
 * for the full design; this module implements the "Token engine (backend,
 * source of truth)" section of that spec.
 *
 * Two-pass resolution, in order:
 *
 * 1. **styled pass** — the template's own literal text (everything that
 *    isn't a `{token}`) and every `context.styled` value are each run
 *    through `applyFont()` independently, then the styled values are
 *    substituted into the font-mapped template. Tokens that aren't in
 *    `context.styled` are left untouched (still literal `{token}` text) at
 *    this point — critically, *not* font-mapped — so step 2 can still find
 *    and resolve them, and so `applyFont`'s plain-Latin-letter substitution
 *    never has a chance to corrupt a token's own `{...}` syntax before it's
 *    resolved.
 * 2. **raw pass** — `context.raw` values and core-registry tokens
 *    (`{channel:<id>}`, `{user:<id>}`, `{role:<id>}`, `{date}`) are
 *    substituted into the step-1 result, always unstyled — core tokens
 *    resolve to Discord mention syntax (`<#id>`, `<@id>`, `<@&id>`), which
 *    must never pass through font mapping. A token that doesn't match
 *    `styled`, `raw`, or a core resolver is left as literal `{token}` text —
 *    matching the no-op behavior of the old per-feature `.replace()` chains
 *    on an unmatched pattern.
 */

import { applyFont } from "../utils/font.js";

export type TemplateContext = Record<string, string>;

export interface RenderOptions {
  useFont: boolean;
  fontMap: string | null;
}

/** Resolves a single {token} against Discord entity data available at render time. */
export type CoreTokenResolver = (id: string) => string;

export interface CoreResolvers {
  channel?: CoreTokenResolver; // {channel:<id>} -> <#id>
  user?: CoreTokenResolver; // {user:<id>} -> <@id>
  role?: CoreTokenResolver; // {role:<id>} -> <@&id>
}

/** Matches one `{tokenName}` (no nested braces) — used to tokenize the template in both passes. */
const TOKEN_PATTERN = /\{([^{}]+)\}/g;

/** `DD.MM.YYYY`, matching the German-language date convention used elsewhere in this bot (see e.g. `birthdays.ts`'s `DD.MM` date keys). Not exercised by any migrated feature today — provided for completeness of the core registry per spec. */
function formatCoreDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Resolves `tokenName` (the text between `{` and `}`, e.g. `channel:123` or `date`) against the core registry. Returns `undefined` if it isn't a recognized core token. */
function resolveCoreToken(tokenName: string, core: CoreResolvers): string | undefined {
  if (tokenName === "date") return formatCoreDate(new Date());

  const colonIndex = tokenName.indexOf(":");
  if (colonIndex === -1) return undefined;
  const kind = tokenName.slice(0, colonIndex);
  const id = tokenName.slice(colonIndex + 1);
  if (!id) return undefined;

  switch (kind) {
    case "channel":
      return core.channel?.(id);
    case "user":
      return core.user?.(id);
    case "role":
      return core.role?.(id);
    default:
      return undefined;
  }
}

export function renderTemplate(
  template: string,
  context: { styled?: TemplateContext; raw?: TemplateContext },
  core: CoreResolvers,
  options: RenderOptions,
): string {
  const styledContext = context.styled ?? {};
  const raw = context.raw ?? {};

  const maybeFont = (text: string): string => (options.useFont ? applyFont(text, options.fontMap) : text);

  // --- Pass 1: font-map literal text + styled values, substitute styled values ---
  let pass1 = "";
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(template))) {
    const literal = template.slice(lastIndex, match.index);
    pass1 += maybeFont(literal);

    const tokenName = match[1]!;
    if (Object.prototype.hasOwnProperty.call(styledContext, tokenName)) {
      pass1 += maybeFont(styledContext[tokenName]!);
    } else {
      // Not a styled token — leave the literal `{token}` text untouched so
      // pass 2 can still find and resolve it (or leave it as-is if unknown).
      pass1 += match[0];
    }
    lastIndex = match.index + match[0].length;
  }
  pass1 += maybeFont(template.slice(lastIndex));

  // --- Pass 2: substitute raw context values + core tokens, always unstyled ---
  TOKEN_PATTERN.lastIndex = 0;
  return pass1.replace(TOKEN_PATTERN, (full, tokenName: string) => {
    if (Object.prototype.hasOwnProperty.call(raw, tokenName)) {
      return raw[tokenName]!;
    }
    const coreValue = resolveCoreToken(tokenName, core);
    if (coreValue !== undefined) return coreValue;
    return full; // unknown/missing token — left as literal text, matching old .replace() no-op behavior
  });
}
