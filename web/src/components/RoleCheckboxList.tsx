import { useMemo, useState } from "react";

export interface RoleCheckboxListOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface RoleCheckboxListProps {
  options: RoleCheckboxListOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}

/**
 * A filtered multi-select over a checkbox grid — extracted from the
 * "Allowed roles" picker on a reaction-role panel (used there, and reused
 * by a Reactions mapping's role picker on ReactionRoles.tsx, which is the
 * only place a member can select more than one role for a single option).
 * Already-checked options stay visible even when they don't match the
 * current search text, so typing never hides your existing selection.
 */
export default function RoleCheckboxList({ options, value, onChange, placeholder }: RoleCheckboxListProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || value.includes(o.value));
  }, [options, search, value]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div>
      {options.length > 8 && (
        <input
          type="text"
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 6 }}
        />
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 8,
          maxHeight: 140,
          overflowY: "auto",
        }}
      >
        {options.length === 0 && <span className="muted">Keine Rollen gefunden.</span>}
        {options.length > 0 && filtered.length === 0 && <span className="muted">Keine Treffer.</span>}
        {filtered.map((o) => (
          <label
            key={o.value}
            className="switch"
            style={{ fontSize: 13, background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 999 }}
          >
            <input
              type="checkbox"
              checked={value.includes(o.value)}
              disabled={o.disabled}
              onChange={() => toggle(o.value)}
            />
            {o.label}
            {o.hint && <span className="muted"> {o.hint}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
