import { renderDiscordMarkdown } from "../utils/discordMarkdown";
import { mockifyChannelMentions } from "../utils/messageTemplate";
import { applyFont } from "../utils/font";
import { formatAbsolute } from "../dateFormat";
import type { Channel } from "../types";

export interface EventEmbedPreviewProps {
  title: string;
  description: string;
  /** ISO UTC, or null while not yet chosen — shows a placeholder instead of a field. */
  startsAt: string | null;
  endsAt: string | null;
  channels: Channel[];
  useFont: boolean;
  fontMap: string | null;
}

/**
 * Mirrors the real event embed built by `buildEventEmbed()`
 * (`src/services/events.ts`): title, description, a "🕐 Zeitpunkt" field,
 * and the three (always-zero, since this is a preview) RSVP fields. Reuses
 * the `.message-preview*` embed-mockup chrome already built for
 * ReactionRoles.tsx instead of inventing new styling.
 */
export default function EventEmbedPreview({ title, description, startsAt, endsAt, channels, useFont, fontMap }: EventEmbedPreviewProps) {
  const styledTitle = useFont ? applyFont(title, fontMap) : title;
  const styledDescription = useFont ? applyFont(description, fontMap) : description;
  const mockifiedDescription = mockifyChannelMentions(styledDescription, channels);
  const timeValue = startsAt && endsAt ? `${formatAbsolute(startsAt)} – ${formatAbsolute(endsAt)}` : "—";

  return (
    <div className="message-preview">
      <div className="message-preview-header">
        <div className="message-preview-avatar">🤖</div>
        <div>
          <span className="message-preview-author">
            leck-eier-bot <span className="message-preview-bot-tag">BOT</span>
          </span>
          <span className="muted message-preview-timestamp">Heute um 12:00</span>
        </div>
      </div>

      <div className="message-preview-embed">
        <div className="message-preview-embed-title">
          {styledTitle ? renderDiscordMarkdown(styledTitle) : <span className="muted">Kein Titel festgelegt.</span>}
        </div>
        <div className="message-preview-embed-desc">
          {mockifiedDescription ? renderDiscordMarkdown(mockifiedDescription) : <span className="muted">Keine Beschreibung.</span>}
        </div>
        <div className="message-preview-embed-fields">
          <div className="message-preview-embed-field" style={{ width: "100%" }}>
            <div className="message-preview-embed-field-name">🕐 Zeitpunkt</div>
            <div className="message-preview-embed-field-value">{timeValue}</div>
          </div>
          <div className="message-preview-embed-field">
            <div className="message-preview-embed-field-name">✅ Zusagen (0)</div>
            <div className="message-preview-embed-field-value muted">—</div>
          </div>
          <div className="message-preview-embed-field">
            <div className="message-preview-embed-field-name">❌ Absagen (0)</div>
            <div className="message-preview-embed-field-value muted">—</div>
          </div>
          <div className="message-preview-embed-field">
            <div className="message-preview-embed-field-name">❓ Vielleicht (0)</div>
            <div className="message-preview-embed-field-value muted">—</div>
          </div>
        </div>
      </div>
    </div>
  );
}
