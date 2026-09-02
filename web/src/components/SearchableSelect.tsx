import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Placeholder shown both when nothing is selected and as the search box's placeholder. */
  placeholder: string;
  disabled?: boolean;
  /** Shown as a selectable first row that clears the value back to "". Omit to make a selection required. */
  emptyLabel?: string;
  id?: string;
  className?: string;
}

/**
 * A single-select combobox: a text field that filters a dropdown list of
 * options as you type, for pickers (channels, roles, ...) that can run to
 * dozens or hundreds of entries in a busy server — a plain `<select>`
 * makes those effectively unusable to scan by eye.
 *
 * Implements the standard combobox ARIA pattern (role="combobox" on the
 * search input, role="listbox"/"option" on the popover, aria-expanded/
 * aria-activedescendant wired to the highlighted option) plus ArrowUp/
 * ArrowDown/Home/End/Enter keyboard navigation — previously this only
 * exposed a plain button + list of unlabeled buttons, operable via mouse or
 * Tab-cycling but invisible to assistive tech and without the conventional
 * arrow-key pattern every other combobox on the page/OS uses.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  emptyLabel,
  id,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, search]);

  /** The virtual option list including the synthetic "clear" row, in display order — what ArrowUp/Down/Home/End actually walk. */
  const rows: (SearchableSelectOption & { isEmptyRow?: boolean })[] = useMemo(
    () => (emptyLabel ? [{ value: "", label: emptyLabel, isEmptyRow: true }, ...filtered] : filtered),
    [emptyLabel, filtered],
  );

  // Filtering can shrink `rows` out from under a stale index — clamp on every change so the highlight never points past the end.
  useEffect(() => {
    setHighlighted((h) => Math.min(h, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  function openPopover() {
    setOpen(true);
    setHighlighted(0);
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setSearch("");
  }

  function optionId(index: number): string {
    return `${listId}-option-${index}`;
  }

  function scrollIntoView(index: number) {
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setHighlighted((h) => {
          const next = Math.min(h + 1, rows.length - 1);
          scrollIntoView(next);
          return next;
        });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setHighlighted((h) => {
          const next = Math.max(h - 1, 0);
          scrollIntoView(next);
          return next;
        });
        break;
      }
      case "Home":
        e.preventDefault();
        setHighlighted(0);
        scrollIntoView(0);
        break;
      case "End":
        e.preventDefault();
        setHighlighted(rows.length - 1);
        scrollIntoView(rows.length - 1);
        break;
      case "Enter": {
        e.preventDefault();
        const row = rows[highlighted];
        if (row && !row.disabled) pick(row.value);
        break;
      }
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setSearch("");
        break;
    }
  }

  return (
    <div className={`searchable-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="searchable-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openPopover();
            // Focus lands on the search input once it mounts, matching the
            // combobox pattern (typing immediately filters/navigates).
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <span className={selected ? "" : "muted"}>{selected ? selected.label : placeholder}</span>
        <span className="searchable-select-arrow">▾</span>
      </button>

      {open && !disabled && (
        <div className="searchable-select-popover">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length > 0 ? optionId(highlighted) : undefined}
            autoFocus
            placeholder={placeholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
          <div className="searchable-select-list" role="listbox" id={listId}>
            {rows.map((o, index) => (
              <button
                key={o.value || "__empty__"}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`searchable-select-option${o.isEmptyRow ? " muted" : ""}${
                  index === highlighted ? " highlighted" : ""
                }`}
                disabled={o.disabled}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(o.value)}
              >
                {o.label}
                {o.hint && <span className="muted"> {o.hint}</span>}
              </button>
            ))}
            {rows.length === 0 && <span className="muted searchable-select-empty">Keine Treffer.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
