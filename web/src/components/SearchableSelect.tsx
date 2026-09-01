import { useEffect, useMemo, useRef, useState } from "react";

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
  const rootRef = useRef<HTMLDivElement>(null);

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

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className={`searchable-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "" : "muted"}>{selected ? selected.label : placeholder}</span>
        <span className="searchable-select-arrow">▾</span>
      </button>

      {open && !disabled && (
        <div className="searchable-select-popover">
          <input
            type="text"
            autoFocus
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="searchable-select-list">
            {emptyLabel && (
              <button type="button" className="searchable-select-option muted" onClick={() => pick("")}>
                {emptyLabel}
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className="searchable-select-option"
                disabled={o.disabled}
                onClick={() => pick(o.value)}
              >
                {o.label}
                {o.hint && <span className="muted"> {o.hint}</span>}
              </button>
            ))}
            {filtered.length === 0 && <span className="muted searchable-select-empty">Keine Treffer.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
