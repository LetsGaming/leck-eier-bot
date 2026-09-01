import { useEffect, useMemo, useRef, useState } from "react";
import { STANDARD_EMOJI } from "../emojiData";
import type { EmojiOption } from "../types";

export interface EmojiValue {
  emojiId: string | null;
  emojiName: string | null;
}

interface EmojiPickerProps {
  value: EmojiValue;
  onChange: (value: EmojiValue) => void;
  customEmojis: EmojiOption[];
  /** Whether "no emoji" is itself a valid, explicit choice (buttons/dropdown) rather than something to avoid (reactions). */
  allowEmpty?: boolean;
}

function customEmojiUrl(id: string, animated: boolean): string {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
}

export default function EmojiPicker({ value, onChange, customEmojis, allowEmpty = false }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filteredCustom = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? customEmojis.filter((e) => (e.name ?? "").toLowerCase().includes(q)) : customEmojis;
    return list.slice(0, 60);
  }, [customEmojis, search]);

  const filteredStandard = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? STANDARD_EMOJI.filter((e) => e.name.includes(q)) : STANDARD_EMOJI;
    return list.slice(0, 200);
  }, [search]);

  function pick(v: EmojiValue) {
    onChange(v);
    setOpen(false);
    setSearch("");
  }

  const selectedCustom = value.emojiId ? customEmojis.find((e) => e.id === value.emojiId) : undefined;

  return (
    <div className="emoji-picker" ref={rootRef}>
      <button
        type="button"
        className="emoji-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Emoji auswählen"
      >
        {value.emojiId ? (
          <img
            src={customEmojiUrl(value.emojiId, selectedCustom?.animated ?? false)}
            alt={value.emojiName ?? "Emoji"}
            className="emoji-picker-thumb"
          />
        ) : value.emojiName ? (
          <span>{value.emojiName}</span>
        ) : (
          <span className="muted">{allowEmpty ? "Kein Emoji" : "Emoji auswählen"}</span>
        )}
      </button>

      {open && (
        <div className="emoji-picker-popover">
          <input
            type="text"
            autoFocus
            placeholder="Emoji suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="emoji-picker-scroll">
            {allowEmpty && (
              <button type="button" className="emoji-picker-clear" onClick={() => pick({ emojiId: null, emojiName: null })}>
                Kein Emoji
              </button>
            )}
            {filteredCustom.length > 0 && (
              <>
                <div className="emoji-picker-section">Dieser Server</div>
                <div className="emoji-grid">
                  {filteredCustom.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      title={e.name ?? undefined}
                      onClick={() => pick({ emojiId: e.id, emojiName: e.name ?? e.id })}
                    >
                      <img src={customEmojiUrl(e.id, e.animated)} alt={e.name ?? "Emoji"} />
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="emoji-picker-section">Standard</div>
            <div className="emoji-grid">
              {filteredStandard.map((e) => (
                <button key={e.char} type="button" title={e.name} onClick={() => pick({ emojiId: null, emojiName: e.char })}>
                  {e.char}
                </button>
              ))}
              {filteredStandard.length === 0 && filteredCustom.length === 0 && (
                <span className="muted" style={{ padding: 8 }}>
                  Keine Treffer.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
