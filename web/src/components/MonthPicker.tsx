/**
 * Prev/next arrows, a "Heute" (today) shortcut, and a <select> of months that
 * actually have events — for the Event-Anwesenheit list page's month-scoped
 * view. Purely controlled: the parent owns the URL's `?month=` param and
 * decides what "current" means (the server's echoed/resolved month), this
 * component only ever calls `onChange`.
 *
 * `onChange(null)` means "clear the param" (i.e. land back on the implicit
 * current month) — used by "Heute" and whenever an arrow/jump would otherwise
 * write the current month back into the URL redundantly.
 */

interface MonthPickerProps {
  /** The effective month currently shown, "YYYY-MM" — either the URL's explicit `?month=` or the server-echoed current month when the param is absent. */
  month: string;
  /** Months that actually have events, "YYYY-MM", any order — deduped/sorted here. */
  availableMonths: string[];
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

export function monthLabel(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function MonthPicker({ month, availableMonths, currentMonth, onChange }: MonthPickerProps) {
  const sortedMonths = [...new Set(availableMonths)].sort();

  function go(target: string): void {
    onChange(target === currentMonth ? null : target);
  }

  return (
    <div className="month-nav">
      <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Vorheriger Monat">
        ←
      </button>
      <select value={month} onChange={(e) => go(e.target.value)} aria-label="Monat auswählen">
        {!sortedMonths.includes(month) && <option value={month}>{monthLabel(month)}</option>}
        {sortedMonths.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => go(shiftMonth(month, 1))} aria-label="Nächster Monat">
        →
      </button>
      <button type="button" onClick={() => onChange(null)} disabled={month === currentMonth}>
        Heute
      </button>
    </div>
  );
}
