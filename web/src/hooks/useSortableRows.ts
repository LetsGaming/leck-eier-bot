import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/** Pulls the comparable value for one column out of a row. Return `null`/`undefined` to sort that row to the end regardless of direction. */
export type SortAccessor<T> = (row: T) => string | number | null | undefined;

export interface UseSortableRowsResult<T> {
  sorted: T[];
  sortKey: string | null;
  direction: SortDirection;
  /** Click handler for a column header: same key toggles asc/desc, a different key switches to it (starting asc). */
  toggleSort: (key: string) => void;
}

/** Compares two present (non-missing) values — callers handle missing values themselves, since "missing" must sort last regardless of direction, not just reverse to first on desc. */
function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "de", { numeric: true, sensitivity: "base" });
}

/**
 * One reusable engine behind every sortable `<table>` in the dashboard —
 * `accessors` maps each sortable column's key to a function pulling its
 * comparable value out of a row; `SortableTh` (same directory's sibling
 * component) drives `toggleSort` and renders the up/down indicator. Missing
 * values (`null`/`undefined`) always sort to the end, in both directions,
 * rather than flip-flopping to the front on desc — a table full of "—" cells
 * belongs at the bottom whichever way you're sorting.
 *
 * No `useMemo` around the caller's `accessors` object is required: table
 * sizes here top out in the low hundreds of rows (server members, commands,
 * signups), so re-sorting on every render of an inline accessors literal is
 * imperceptible — memoizing it would just be ceremony for a cost that
 * doesn't exist at this scale.
 */
export function useSortableRows<T>(
  rows: T[],
  accessors: Record<string, SortAccessor<T>>,
  initial: { key: string; direction?: SortDirection } | null = null,
): UseSortableRowsResult<T> {
  const [sortKey, setSortKey] = useState<string | null>(initial?.key ?? null);
  const [direction, setDirection] = useState<SortDirection>(initial?.direction ?? "asc");

  function toggleSort(key: string) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const accessor = accessors[sortKey];
    if (!accessor) return rows;
    // Decorate-sort-undecorate keeps the sort stable (ties keep their
    // original relative order) regardless of Array.prototype.sort's own
    // stability guarantees across engines/versions.
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = accessor(a.row);
        const bv = accessor(b.row);
        const aMissing = av === null || av === undefined;
        const bMissing = bv === null || bv === undefined;
        if (aMissing || bMissing) {
          // Missing values sort last no matter which direction is active —
          // flipping the comparator's sign for desc (like every other row
          // pair below) would otherwise send them to the front instead.
          if (aMissing && bMissing) return a.index - b.index;
          return aMissing ? 1 : -1;
        }
        const cmp = compareValues(av, bv);
        if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
        return a.index - b.index;
      })
      .map((entry) => entry.row);
  }, [rows, accessors, sortKey, direction]);

  return { sorted, sortKey, direction, toggleSort };
}
