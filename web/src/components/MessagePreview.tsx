import { applyFont } from "../utils/font";
import type { Mapping, PanelMessageType, SelectionType } from "../types";

interface MessagePreviewProps {
  messageType: PanelMessageType;
  selectionType: SelectionType;
  title: string;
  description: string;
  mappings: Mapping[];
  resolveRoleLabel: (mapping: Mapping) => string;
  /** The globally-configured font (Settings page) — applied only when `useFont` is on. */
  fontMap: string | null;
  useFont: boolean;
}

function emojiNode(mapping: Mapping) {
  if (mapping.emojiId) {
    return (
      <img
        src={`https://cdn.discordapp.com/emojis/${mapping.emojiId}.png`}
        alt={mapping.emojiName ?? ""}
        className="message-preview-emoji-img"
      />
    );
  }
  return mapping.emojiName;
}

/**
 * Mirrors — but does not literally share, since one runs in the browser and
 * one on the bot — buildPanelText()/buildPanelEmbed() in
 * src/services/reactionRoles.ts. Keep the two in sync if that formatting
 * ever changes.
 */
function bodyText(description: string, selectionType: SelectionType, sorted: Mapping[], resolveRoleLabel: (m: Mapping) => string) {
  if (selectionType !== "reactions") return description || "";
  const lines = sorted.map((m) => `${m.emojiId ? `[${m.emojiName}]` : (m.emojiName ?? "")} — ${resolveRoleLabel(m)}`);
  return [description, lines.join("\n")].filter(Boolean).join("\n\n");
}

/** A rough, non-pixel-perfect mockup of how the panel message will render on Discord — enough to sanity-check content/options before sending. */
export default function MessagePreview({
  messageType,
  selectionType,
  title,
  description,
  mappings,
  resolveRoleLabel,
  fontMap,
  useFont,
}: MessagePreviewProps) {
  const sorted = [...mappings].sort((a, b) => a.position - b.position);
  const style = (s: string) => (useFont ? applyFont(s, fontMap) : s);
  const text = style(bodyText(description, selectionType, sorted, resolveRoleLabel));
  const styledTitle = style(title);

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

      {messageType === "embed" ? (
        <div className="message-preview-embed">
          {styledTitle && <div className="message-preview-embed-title">{styledTitle}</div>}
          <div className="message-preview-embed-desc">{text || <span className="muted">Keine Beschreibung festgelegt.</span>}</div>
        </div>
      ) : (
        <div className="message-preview-text">{text || <span className="muted">Kein Nachrichtentext festgelegt.</span>}</div>
      )}

      {selectionType === "reactions" && (
        <div className="message-preview-reactions">
          {sorted.length === 0 && <span className="muted">Noch keine Rollen hinzugefügt.</span>}
          {sorted.map((m) => (
            <span className="message-preview-reaction" key={m.id}>
              {emojiNode(m)} <span className="muted">1</span>
            </span>
          ))}
        </div>
      )}

      {selectionType === "buttons" && (
        <div className="message-preview-buttons">
          {sorted.length === 0 && <span className="muted">Noch keine Buttons hinzugefügt.</span>}
          {sorted.map((m) => (
            <span className="message-preview-button" key={m.id}>
              {emojiNode(m)} {style(resolveRoleLabel(m))}
            </span>
          ))}
        </div>
      )}

      {selectionType === "dropdown" && (
        <div className="message-preview-dropdown">
          <span className="muted">
            {sorted.length === 0
              ? "Noch keine Optionen hinzugefügt"
              : sorted.length === 1
                ? style(resolveRoleLabel(sorted[0]!))
                : `${style(resolveRoleLabel(sorted[0]!))} +${sorted.length - 1} weitere`}
          </span>
          <span>▾</span>
        </div>
      )}
    </div>
  );
}
