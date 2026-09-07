import {
  REGISTER_FORM_NAME_REGEX,
  REGISTER_FORM_SSO_NAME_REGEX,
  REGISTER_FORM_ALTER_REGEX,
  DISCORD_NICKNAME_MAX_LENGTH,
} from "../constants.js";
import { applyFont } from "../utils/font.js";
import { renderTemplate } from "../shared/messageTemplate.js";

export interface RegisterFormFields {
  name: string;
  /** Full `sso name:` field value, as submitted — shown as-is on the dashboard. */
  ssoName: string;
  /** Last whitespace-separated word of `ssoName` — see `buildRegisterNickname()`. */
  ssoLastName: string;
  /** Raw `alter:` field value. Optional — a submission missing it is still valid, since it isn't used to build the nickname. */
  age: string | null;
}

/** Extracts the `name:`, `sso name:`, and `alter:` fields from a register-form submission. Only `name:`/`sso name:` are required — returns null if either is missing, so a message without them is left alone as ordinary chat. */
export function parseRegisterForm(content: string): RegisterFormFields | null {
  const name = content.match(REGISTER_FORM_NAME_REGEX)?.[1]?.trim();
  const ssoName = content.match(REGISTER_FORM_SSO_NAME_REGEX)?.[1]?.trim();
  if (!name || !ssoName) return null;

  const ssoLastName = ssoName.split(/\s+/).pop();
  if (!ssoLastName) return null;

  const age = content.match(REGISTER_FORM_ALTER_REGEX)?.[1]?.trim() || null;

  return { name, ssoName, ssoLastName, age };
}

/** Code-point-aware truncation so a supplementary-plane styled character (see utils/font.ts) never gets split in half. */
function truncateToCodePoints(text: string, maxLength: number): string {
  const codePoints = [...text];
  return codePoints.length <= maxLength ? text : codePoints.slice(0, maxLength).join("");
}

/**
 * Builds the standard registration nickname: `emoji` (settings.registerNicknameEmoji,
 * configurable from the dashboard — previously a hardcoded constant) prefixed
 * onto the first-name field in caps, run through the shared global font
 * (settings.fontMap — same one used by the birthday anchor/announcement and
 * reaction-role panels) when useFont/settings.registerNicknameUseFont is on
 * (default), then the lowercase, unstyled surname from the sso-name field.
 * E.g. name "Areum" + sso name "... Shadowray" + fontMap set ->
 * "💙𝐀𝐑𝐄𝐔𝐌 — shadowray". Falls back to plain (unstyled) caps when no font is
 * configured or useFont is off, and drops the surname half (then truncates)
 * if the styled form would exceed Discord's nickname length cap.
 */
export function buildRegisterNickname(
  fields: RegisterFormFields,
  fontMap: string | null,
  useFont: boolean,
  emoji: string,
): string {
  const styledFirstName = useFont ? applyFont(fields.name.toUpperCase(), fontMap) : fields.name.toUpperCase();
  const full = `${emoji}${styledFirstName} — ${fields.ssoLastName.toLowerCase()}`;
  if ([...full].length <= DISCORD_NICKNAME_MAX_LENGTH) return full;

  const nameOnly = `${emoji}${styledFirstName}`;
  return truncateToCodePoints(nameOnly, DISCORD_NICKNAME_MAX_LENGTH);
}

/**
 * `{name}` is substituted via `renderTemplate()`'s `raw` bucket (unstyled —
 * `renderConfirmation` never applied `applyFont`, before or after this
 * migration). `{roleChannel}` is rewritten to the core `{channel:<id>}`
 * token before rendering when `roleSelectionChannelId` is configured, so it
 * resolves through the core `channel` resolver to `<#id>` — matching the
 * old pre-formatted `<#id>` string exactly. When no channel is configured,
 * `{roleChannel}` is left as-is and resolved via the `raw` bucket instead,
 * to the same "dem Rollen-Kanal" fallback text as before.
 */
export function renderConfirmation(template: string, name: string, roleSelectionChannelId: string | null): string {
  const effectiveTemplate = roleSelectionChannelId
    ? template.replace(/{roleChannel}/g, `{channel:${roleSelectionChannelId}}`)
    : template;
  return renderTemplate(
    effectiveTemplate,
    { raw: { name, roleChannel: "dem Rollen-Kanal" } },
    { channel: (id) => `<#${id}>` },
    { useFont: false, fontMap: null },
  );
}

/**
 * Whether `settings.registerAutoComplete` should skip the staff-review step
 * entirely for a fresh submission — see the auto-complete branch in
 * `registerWatcher.ts`'s `tryHandleSubmission()`. Both the feature flag and a
 * configured tier role to grant are required.
 */
export function shouldAutoCompleteRegistration(settings: {
  registerAutoComplete: boolean;
  registrationTierRoleId: string | null;
}): boolean {
  return settings.registerAutoComplete && !!settings.registrationTierRoleId;
}
