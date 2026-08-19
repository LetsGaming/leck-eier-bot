import type { Mapping, PanelMessageType, SelectionType } from "../types";

interface MessagePreviewProps {
  messageType: PanelMessageType;
  selectionType: SelectionType;
  title: string;
  description: string;
  mappings: Mapping[];
  resolveRoleLabel: (mapping: Mapping) => string;
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
}: MessagePreviewProps) {
  const sorted = [...mappings].sort((a, b) => a.position - b.position);
  const text = bodyText(description, selectionType, sorted, resolveRoleLabel);

  return (
    <div className="message-preview">
      <div className="message-preview-header">
        <div className="message-preview-avatar">🤖</div>
        <div>
          <span className="message-preview-author">
            leck-eier-bot <span className="message-preview-bot-tag">BOT</span>
          </span>
          <span className="muted message-preview-timestamp">Today at 12:00</span>
        </div>
      </div>

      {messageType === "embed" ? (
        <div className="message-preview-embed">
          {title && <div className="message-preview-embed-title">{title}</div>}
          <div className="message-preview-embed-desc">{text || <span className="muted">No description set.</span>}</div>
        </div>
      ) : (
        <div className="message-preview-text">{text || <span className="muted">No message text set.</span>}</div>
      )}

      {selectionType === "reactions" && (
        <div className="message-preview-reactions">
          {sorted.length === 0 && <span className="muted">No roles added yet.</span>}
          {sorted.map((m) => (
            <span className="message-preview-reaction" key={m.id}>
              {emojiNode(m)} <span className="muted">1</span>
            </span>
          ))}
        </div>
      )}

      {selectionType === "buttons" && (
        <div className="message-preview-buttons">
          {sorted.length === 0 && <span className="muted">No buttons added yet.</span>}
          {sorted.map((m) => (
            <span className="message-preview-button" key={m.id}>
              {emojiNode(m)} {resolveRoleLabel(m)}
            </span>
          ))}
        </div>
      )}

      {selectionType === "dropdown" && (
        <div className="message-preview-dropdown">
          <span className="muted">
            {sorted.length === 0
              ? "No options added yet"
              : sorted.length === 1
                ? resolveRoleLabel(sorted[0]!)
                : `${resolveRoleLabel(sorted[0]!)} +${sorted.length - 1} more`}
          </span>
          <span>▾</span>
        </div>
      )}
    </div>
  );
}
