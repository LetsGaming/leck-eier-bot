import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Channel } from "../types";

export interface TemplatePlaceholder {
  /** The token name between braces, e.g. `name` for `{name}`. */
  token: string;
  /** Human-readable button label — never the raw token itself (see chip row below). */
  label: string;
}

export interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  channels: Channel[];
  placeholder?: string;
  id?: string;
  /** Fixed set of `{token}` placeholders valid for this field, shown as insertable chips above the textarea and highlighted as pills inside it. Omit (or pass an empty array) for a field with no placeholders (e.g. ReactionRoles' message templates) — no chip row or highlighting renders. */
  placeholders?: TemplatePlaceholder[];
}

/** Matches one `{tokenName}` (no nested braces) — same shape as the rendering engines' own TOKEN_PATTERN, kept local here since this only needs to *recognize* a token, not resolve it. */
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

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
export default function TemplateEditor({ value, onChange, channels, placeholder, id, placeholders }: TemplateEditorProps) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const recognizedTokens = useMemo(() => new Set((placeholders ?? []).map((p) => p.token)), [placeholders]);
  const hasPlaceholders = (placeholders?.length ?? 0) > 0;

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

  /** Inserts `{token}` at the cursor (replacing any active selection) — the click-target for a chip in the placeholder row above the textarea. Unlike `insertChannel`, this isn't gated on an open trigger popover; it's a direct, always-available insertion. */
  function insertPlaceholder(token: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const inserted = `{${token}}`;
    const nextValue = `${before}${inserted}${after}`;
    onChange(nextValue);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  /** Keeps the highlight overlay's scroll position identical to the real (invisible-text) textarea's — otherwise the visible pill-rendered copy would drift out of alignment with the caret/selection on any content taller than the field. */
  function syncHighlightScroll() {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }

  /** Splits `text` on `{token}` boundaries, wrapping only recognized tokens (from `placeholders`) in a pill span — an unrecognized `{typo}` is left as plain text so a mistake doesn't look like a valid token. */
  function renderHighlighted(text: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(text))) {
      if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
      if (recognizedTokens.has(match[1]!)) {
        nodes.push(
          <span key={key++} className="template-editor-pill">
            {match[0]}
          </span>,
        );
      } else {
        nodes.push(match[0]);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    // A trailing newline needs a trailing space to actually take up a visible
    // line in a pre-wrap block, matching how the real textarea renders it.
    if (text.endsWith("\n")) nodes.push(" ");
    return nodes;
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
      {hasPlaceholders && (
        <div className="template-editor-chip-row">
          {placeholders!.map((p) => (
            <button
              key={p.token}
              type="button"
              className="template-editor-chip"
              title={`{${p.token}}`}
              onClick={() => insertPlaceholder(p.token)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className={`template-editor-textarea-wrap${hasPlaceholders ? " has-highlight" : ""}`}>
        {hasPlaceholders && (
          <div className="template-editor-highlight mono-input" ref={highlightRef} aria-hidden="true">
            {renderHighlighted(value)}
          </div>
        )}
        <textarea
          id={id}
          ref={textareaRef}
          className="mono-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            // The change hasn't reflected into the DOM's selection yet on this
            // tick in every browser, but selectionStart already matches the
            // new caret position by the time this handler runs.
            requestAnimationFrame(syncTriggerFromCursor);
            if (hasPlaceholders) requestAnimationFrame(syncHighlightScroll);
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
          onScroll={hasPlaceholders ? syncHighlightScroll : undefined}
        />
      </div>

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
