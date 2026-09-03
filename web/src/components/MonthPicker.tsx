import { useEffect, useRef, useState } from "react";

/**
 * Apollo-style month navigation for the Event-Anwesenheit list page:
 * a "Heute" pill, prev/next arrows, and a big month/year label that opens a
 * calendar-style popover for jumping directly to any month. Months that
 * actually hold events are highlighted in the popover grid and carry a
 * small badge with their event count.
 *
 * Purely controlled: the parent owns the URL's `?month=` param and decides
 * what "current" means (the server's echoed/resolved month), this
 * component only ever calls `onChange`.
 *
 * `onChange(null)` means "clear the param" (i.e. land back on the implicit
 * current month) — used by "Heute" and whenever an arrow/jump would otherwise
 * write the current month back into the URL redundantly.
 */

interface MonthPickerProps {
  /** The effective month currently shown, "YYYY-MM" — either the URL's explicit `?month=` or the server-echoed current month when the param is absent. */
  month: string;
  /** Event count per month, "YYYY-MM" -> count. Months present here (with count > 0) are highlighted in the popover grid. */
  monthCounts: Record<string, number>;
  /** The server's notion of "now", "YYYY-MM" — target for "Heute" and used to decide when a param can be cleared instead of written explicitly. */
  currentMonth: string;
  onChange: (month: string | null) => void;
}

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yearOf(month: string): number {
  return Number(month.split("-")[0]);
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortMonthLabel(monthIndex: number): string {
  const date = new Date(Date.UTC(2000, monthIndex, 1));
  return date.toLocaleDateString("de-DE", { month: "short", timeZone: "UTC" });
}

export default function MonthPicker({ month, monthCounts, currentMonth, onChange }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => yearOf(month));
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the popover's year in sync with the externally-driven month (arrow
  // nav, "Heute", browser back/forward) whenever it's closed — but don't
  // fight the user while they're browsing other years inside the popover.
  useEffect(() => {
    if (!open) setViewYear(yearOf(month));
  }, [month, open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function go(target: string): void {
    onChange(target === currentMonth ? null : target);
  }

  function pick(target: string): void {
    go(target);
    setOpen(false);
  }

  return (
    <div className="month-nav">
      <button type="button" className="pill" onClick={() => onChange(null)} disabled={month === currentMonth}>
        Heute
      </button>
      <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Vorheriger Monat">
        ←
      </button>
      <button type="button" onClick={() => go(shiftMonth(month, 1))} aria-label="Nächster Monat">
        →
      </button>
      <div className="month-nav-picker" ref={rootRef}>
        <button
          type="button"
          className="month-nav-label"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {monthLabel(month)}
        </button>

        {open && (
          <div className="month-calendar-popover" role="dialog" aria-label="Monat auswählen">
            <div className="month-calendar-header">
              <button type="button" aria-label="Vorheriges Jahr" onClick={() => setViewYear((y) => y - 1)}>
                ←
              </button>
              <strong>{viewYear}</strong>
              <button type="button" aria-label="Nächstes Jahr" onClick={() => setViewYear((y) => y + 1)}>
                →
              </button>
            </div>
            <div className="month-calendar-grid">
              {Array.from({ length: 12 }, (_, monthIndex) => {
                const value = monthKey(viewYear, monthIndex);
                const count = monthCounts[value] ?? 0;
                const hasData = count > 0;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`month-calendar-cell${hasData ? " has-data" : ""}${value === month ? " selected" : ""}${
                      value === currentMonth ? " current" : ""
                    }`}
                    aria-current={value === currentMonth ? "date" : undefined}
                    aria-pressed={value === month}
                    onClick={() => pick(value)}
                  >
                    {shortMonthLabel(monthIndex)}
                    {hasData && <span className="month-calendar-badge">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
