/**
 * Client-side mirror of `src/shared/messageTemplate.ts`'s `renderTemplate()`
 * token engine — the two never share code (one runs in the browser, one on
 * the bot), but must implement the exact same two-pass substitution algorithm
 * so a dashboard live preview matches what the bot actually posts. See
 * `docs/superpowers/specs/2026-09-05-message-composition-design.md` ("Web-side
 * mirror") for the design rationale, and `../utils/font.ts` for this file's
 * sibling mirror of `applyFont()`.
 *
 * Same two-pass resolution as the backend engine:
 *
 * 1. **styled pass** — the template's own literal text and every
 *    `context.styled` value are each run through `applyFont()`
 *    independently, then substituted into the font-mapped template. A token
 *    not in `context.styled` is left as literal `{token}` text (never
 *    font-mapped) so pass 2 can still find it.
 * 2. **raw pass** — `context.raw` values and core-registry tokens
 *    (`{channel:<id>}`, `{user:<id>}`, `{role:<id>}`, `{date}`) are
 *    substituted unstyled. An unresolved token is left as literal text.
 *
 * Unlike the backend, the `channel` core resolver here renders `#name`
 * mockup labels (backed by the `channels: Channel[]` data pages already load
 * via `api.channels()`) instead of a real Discord `<#id>` mention — this is a
 * rough preview mockup, not real Discord, matching the existing
 * `MessagePreview.tsx`/`font.ts` "non-pixel-perfect" framing. No `@` user/role
 * resolution is implemented (out of scope — see the design spec).
 */

import { applyFont } from "./font";
import type { Channel } from "../types";

export type TemplateContext = Record<string, string>;

export interface RenderOptions {
  useFont: boolean;
  fontMap: string | null;
}

export type CoreTokenResolver = (id: string) => string;

export interface CoreResolvers {
  channel?: CoreTokenResolver; // {channel:<id>} -> "#name" mockup label
  user?: CoreTokenResolver; // {user:<id>} -> mockup label
  role?: CoreTokenResolver; // {role:<id>} -> mockup label
}

/** Matches one `{tokenName}` (no nested braces) — used to tokenize the template in both passes. */
const TOKEN_PATTERN = /\{([^{}]+)\}/g;

/** `DD.MM.YYYY` — matches the backend's `formatCoreDate()` exactly. */
function formatCoreDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

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

/** Mirrors `renderTemplate()` from `src/shared/messageTemplate.ts` exactly — see this file's header comment. */
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
    return full;
  });
}

/** `#name` for a known channel, or `#unbekannter-kanal` if `id` doesn't match anything in `channels` — used as this mirror's `channel` core resolver. */
export function mockChannelLabel(id: string, channels: Channel[]): string {
  const channel = channels.find((c) => c.id === id);
  return `#${channel?.name ?? "unbekannter-kanal"}`;
}

/** `{ channel: (id) => mockChannelLabel(id, channels) }` — the core resolver set every preview call site in this app should pass to `renderTemplate()`. */
export function buildCoreResolvers(channels: Channel[]): CoreResolvers {
  return { channel: (id) => mockChannelLabel(id, channels) };
}

/**
 * Discord's real `<#channelId>` mention syntax — inserted directly (not as a
 * `{channel:<id>}` engine token) by `TemplateEditor`'s `#`-popover — renders
 * literally in this browser-only mockup unless converted. Replaces every
 * `<#id>` occurrence in `text` with the same `#name` mockup label the
 * `channel` core resolver produces, so a preview looks consistent regardless
 * of whether a channel mention came from the editor's popover or from a
 * legacy `{channel:<id>}`/`{roleChannel}`-style token.
 */
export function mockifyChannelMentions(text: string, channels: Channel[]): string {
  // Channel IDs are Discord snowflakes (numeric) in production, but not
  // assumed to be digit-only here so this also works against non-numeric
  // ids from the dev mock-Discord client (see mockDiscordClient.ts) used
  // for local preview testing.
  return text.replace(/<#([^<>]+)>/g, (_full, id: string) => mockChannelLabel(id, channels));
}
