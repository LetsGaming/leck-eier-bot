import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Channel } from "../types";

export interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  channels: Channel[];
  placeholder?: string;
  id?: string;
}

interface TriggerState {
  /** Index into `value` of the trigger character itself (the `#`). */
  triggerIndex: number;
  /** Text typed since the trigger character, used to filter the popover's list. */
  query: string;
}

/**
 * Wraps a `<textarea>`; typing `#` opens a popover listing `channels`,
 * filtered by whatever's typed after it — reusing `SearchableSelect`'s
 * filtering/keyboard-nav internals (ArrowUp/ArrowDown/Home/End/Enter/Escape,
 * mouse hover/click), just anchored at the text cursor instead of below a
 * trigger button, since there's no separate trigger element here — the
 * textarea IS the trigger. Selecting a channel replaces the `#query` text
 * (trigger character included) with Discord's native `<#channelId>` mention
 * syntax and closes the popover.
 *
 * Deliberately structured so a second trigger character (`@`, for a future
 * user/role picker — out of scope for this task, see the design spec) can be
 * registered later without restructuring: `TRIGGER_CHARS` below is the only
 * place that would need to grow, and `TriggerState`/`findActiveTrigger()`
 * are already keyed by "which character triggered this" in spirit (a second
 * entry would just add another regex/lookup here) rather than hardcoding `#`
 * assumptions elsewhere in the component.
 */
export default function TemplateEditor({ value, onChange, channels, placeholder, id }: TemplateEditorProps) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    return q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;
  }, [trigger, channels]);

  useEffect(() => {
    setHighlighted((h) => Math.min(h, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  useEffect(() => {
    if (!trigger) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setTrigger(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [trigger]);

  /**
   * Looks backward from the cursor to see whether it's currently sitting
   * inside an in-progress `#query` (a `#` with no whitespace/newline between
   * it and the cursor) — recomputed on every keystroke rather than tracked
   * as separate open/close events, so the popover naturally tracks the
   * cursor through arbitrary edits (typing, deleting, pasting).
   */
  function findActiveTrigger(text: string, cursor: number): TriggerState | null {
    const uptoCursor = text.slice(0, cursor);
    const hashIndex = uptoCursor.lastIndexOf("#");
    if (hashIndex === -1) return null;
    const between = uptoCursor.slice(hashIndex + 1);
    if (/[\s\n]/.test(between)) return null;
    return { triggerIndex: hashIndex, query: between };
  }

  function syncTriggerFromCursor() {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const next = findActiveTrigger(value, cursor);
    setTrigger(next);
    if (next) setHighlighted(0);
  }

  function insertChannel(channelId: string) {
    if (!trigger) return;
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? trigger.triggerIndex + 1 + trigger.query.length;
    const before = value.slice(0, trigger.triggerIndex);
    const after = value.slice(cursor);
    const mention = `<#${channelId}>`;
    const nextValue = `${before}${mention}${after}`;
    onChange(nextValue);
    setTrigger(null);
    requestAnimationFrame(() => {
      const pos = before.length + mention.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!trigger) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setHighlighted(0);
        break;
      case "End":
        e.preventDefault();
        setHighlighted(filtered.length - 1);
        break;
      case "Enter": {
        const channel = filtered[highlighted];
        if (channel) {
          e.preventDefault();
          insertChannel(channel.id);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        setTrigger(null);
        break;
    }
  }

  return (
    <div className="template-editor" ref={rootRef}>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          // The change hasn't reflected into the DOM's selection yet on this
          // tick in every browser, but selectionStart already matches the
          // new caret position by the time this handler runs.
          requestAnimationFrame(syncTriggerFromCursor);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          // Arrow-key/Home/End navigation while the popover is open is
          // handled by handleKeyDown above (and must not also move the
          // cursor's trigger lookup here); everything else re-checks.
          if (trigger && ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"].includes(e.key)) return;
          syncTriggerFromCursor();
        }}
        onClick={syncTriggerFromCursor}
      />

      {trigger && (
        <div className="template-editor-popover searchable-select-popover">
          <div className="searchable-select-list" role="listbox">
            {filtered.map((c, index) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                className={`searchable-select-option${index === highlighted ? " highlighted" : ""}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => insertChannel(c.id)}
              >
                #{c.name}
              </button>
            ))}
            {filtered.length === 0 && <span className="muted searchable-select-empty">Keine Treffer.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
