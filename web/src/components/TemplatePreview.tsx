import { buildCoreResolvers, mockifyChannelMentions, renderTemplate, type TemplateContext } from "../utils/messageTemplate";
import { renderDiscordMarkdown } from "../utils/discordMarkdown";
import type { Channel } from "../types";

export interface TemplatePreviewProps {
  template: string;
  context: { styled?: TemplateContext; raw?: TemplateContext };
  channels: Channel[];
  useFont: boolean;
  fontMap: string | null;
}

/**
 * Always-live rendering of `template` through the web-side `renderTemplate()`
 * mirror — re-renders on every keystroke via React's normal render cycle, no
 * fetch, no button. Replaces both `MessagePreview.tsx` (whose panel-shape
 * chrome — embed box, reactions/buttons/dropdown mockups — is now retained
 * directly in `ReactionRoles.tsx`, which calls this component just for the
 * token-resolved text/title portions) and Birthdays' old preview-button flow.
 *
 * Callers are responsible for invoking this with the SAME `context`
 * bucket/`useFont` shape their corresponding backend caller actually uses
 * today (raw vs. styled, and whether `useFont` is routed through the engine
 * or hand-applied by the caller before calling this component with
 * `useFont: false`) — see each page's usage for the specific reasoning,
 * mirroring `src/services/birthdays.ts` / `reactionRoles.ts` /
 * `src/events/registerWatcher.ts`.
 */
export default function TemplatePreview({ template, context, channels, useFont, fontMap }: TemplatePreviewProps) {
  const rendered = renderTemplate(template, context, buildCoreResolvers(channels), { useFont, fontMap });
  const mockified = mockifyChannelMentions(rendered, channels);

  return (
    <div className="template-preview-text">
      {mockified ? renderDiscordMarkdown(mockified) : <span className="muted">Keine Vorschau verfügbar.</span>}
    </div>
  );
}
