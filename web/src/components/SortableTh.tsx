import type { ReactNode } from "react";
import type { SortDirection } from "../hooks/useSortableRows";

interface SortableThProps {
  label: ReactNode;
  sortKey: string;
  activeKey: string | null;
  direction: SortDirection;
  onSort: (key: string) => void;
  className?: string;
  /** Explanatory text below the label, same spot a plain `<th>`'s own `<p className="muted small">` would sit — kept outside the sort button so it isn't itself clickable. */
  hint?: ReactNode;
}

/**
 * A `<th>` whose label is a sort trigger — pairs with `useSortableRows`
 * (`activeKey`/`direction`/`onSort` are that hook's `sortKey`/`direction`/
 * `toggleSort` passed straight through). Renders a neutral ↕ when this
 * column isn't the active sort and a directional ▲/▼ when it is, and sets
 * `aria-sort` on the `<th>` itself per the standard sortable-table pattern.
 */
export default function SortableTh({ label, sortKey, activeKey, direction, onSort, className, hint }: SortableThProps) {
  const active = activeKey === sortKey;
  return (
    <th
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sortable-th" onClick={() => onSort(sortKey)}>
        {label}
        <span className="sortable-th-arrow" aria-hidden="true">
          {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
      {hint && <p className="muted small">{hint}</p>}
    </th>
  );
}
