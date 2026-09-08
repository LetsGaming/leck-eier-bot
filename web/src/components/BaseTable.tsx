import type { ReactNode } from "react";
import SortableTh from "./SortableTh";
import { useSortableRows, type SortAccessor, type SortDirection } from "../hooks/useSortableRows";

export interface BaseTableColumn<T> {
  /** Must be unique per table — doubles as the sort key passed to `useSortableRows`. */
  key: string;
  label: ReactNode;
  /** Mobile stacked-layout label (see `.stack-on-mobile` in theme.css) — must be a plain string since it goes into a `data-label` attribute. Defaults to `label` when `label` is itself a string; omit for a column (avatar, actions) that shouldn't get a mobile label at all. */
  dataLabel?: string;
  /** Omit to make this column unsortable (an avatar or actions column, or one like Commands' "Berechtigung" whose cell hosts its own interactive controls). */
  accessor?: SortAccessor<T>;
  /** Explanatory text under the header label — same spot a plain `<th>`'s own `<p className="muted small">` would sit. */
  hint?: ReactNode;
  className?: string;
  /** Required unless the table is used with `renderRow` (see `BaseTableProps`), which bypasses per-column cell rendering entirely. */
  render?: (row: T) => ReactNode;
}

export interface BaseTableProps<T> {
  columns: BaseTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Rendered in place of the table when `rows` is empty. */
  emptyMessage?: ReactNode;
  initialSort?: { key: string; direction?: SortDirection };
  /**
   * Escape hatch for rows whose cells don't map 1:1 onto `columns[].render`
   * — e.g. a shared row component (`SignupRow`) that owns its own `<tr>`
   * and inter-cell logic. `columns` still drives the header/sort UI when
   * this is set; each returned element must carry its own `key`, exactly
   * as when mapping rows manually.
   */
  renderRow?: (row: T) => ReactNode;
}

/**
 * The one sortable-table shell behind every `<table>` in the dashboard —
 * table-scroll wrapper, `<thead>` built from `columns` (sortable columns via
 * `SortableTh`, plain ones via a bare `<th>`), the `useSortableRows` engine,
 * and the `<tbody>` row loop (per-column `render`, or `renderRow` for a
 * table whose rows come from an existing shared row component). Column
 * definitions are the only thing each page still writes by hand — the sort
 * wiring, header markup, and mobile stacked-layout `data-label`s live here
 * once instead of once per table.
 */
export default function BaseTable<T>({ columns, rows, rowKey, emptyMessage, initialSort, renderRow }: BaseTableProps<T>) {
  const accessors: Record<string, SortAccessor<T>> = {};
  for (const col of columns) if (col.accessor) accessors[col.key] = col.accessor;

  const { sorted, sortKey, direction, toggleSort } = useSortableRows(rows, accessors, initialSort ?? null);

  if (rows.length === 0 && emptyMessage !== undefined) {
    return <>{emptyMessage}</>;
  }

  return (
    <div className="table-scroll">
      <table className="stack-on-mobile">
        <thead>
          <tr>
            {columns.map((col) =>
              col.accessor ? (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  sortKey={col.key}
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                  className={col.className}
                  hint={col.hint}
                />
              ) : (
                <th key={col.key} className={col.className}>
                  {col.label}
                  {col.hint && <p className="muted small">{col.hint}</p>}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {renderRow
            ? sorted.map((row) => renderRow(row))
            : sorted.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.className} data-label={col.dataLabel ?? (typeof col.label === "string" ? col.label : undefined)}>
                      {col.render?.(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
