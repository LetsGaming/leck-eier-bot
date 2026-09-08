import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; left: number; width: number; flipped: boolean }>({
    top: 0,
    left: 0,
    width: 220,
    flipped: false,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
      setSearch("");
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Popover renders through a portal (see below) so it's positioned against
  // the viewport instead of the nearest CSS-positioned ancestor — a
  // trigger inside any scroll-clipping container (e.g. `.table-scroll`,
  // present on 6 pages) would otherwise get its popover cut off, as the
  // absolutely-positioned version did on Event-Anwesenheit's "Mitglied
  // zuordnen…" picker. Recomputed on open and on every scroll/resize while
  // open — `scroll` is captured (3rd arg `true`) because it doesn't bubble,
  // so this is the only way to hear a nested `.table-scroll` div scroll,
  // not just the window.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = rootRef.current?.querySelector(".searchable-select-trigger");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 220);
      const viewportWidth = window.innerWidth;
      const left = Math.min(Math.max(rect.left, 8), viewportWidth - width - 8);
      // Estimated popover height (search input + padding/border + the
      // list's own 240px max-height) — flip above the trigger when there
      // isn't room below, same as the space-below check any native
      // <select>/combobox does.
      const estimatedHeight = 296;
      const spaceBelow = window.innerHeight - rect.bottom;
      const flipped = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      const top = flipped ? rect.top - 4 : rect.bottom + 4;
      setPopoverStyle({ top, left, width, flipped });
    }
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
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

      {open &&
        !disabled &&
        createPortal(
          <div
            className="searchable-select-popover"
            ref={popoverRef}
            style={{
              position: "fixed",
              top: popoverStyle.top,
              left: popoverStyle.left,
              width: popoverStyle.width,
              transform: popoverStyle.flipped ? "translateY(-100%)" : undefined,
            }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
