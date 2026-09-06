import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EventCard from "../components/EventCard";
import MonthPicker, { monthLabel } from "../components/MonthPicker";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useEventAttendanceList, useEventAttendanceMonths } from "../hooks/useEventAttendance";

const DEBOUNCE_MS = 300;

export default function EventAttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");

  const problems = searchParams.get("problems") === "1";
  const scope = searchParams.get("scope") === "all" ? "all" : "month";
  const monthParam = searchParams.get("month");
  const q = searchParams.get("q") ?? "";

  // Overview's "N Anmeldungen brauchen Zuordnung" attention link jumps
  // straight here with ?problems=1, so an admin doesn't have to know this
  // filter exists to find what's waiting on them.

  // Keep the search box in sync when the URL's ?q= changes from outside a
  // keystroke here (browser back/forward, or another param write clearing
  // it) — the debounce below only ever writes the URL, never reads it back
  // into local state, so without this a back-navigation would restore the
  // URL but leave stale text in the input.
  useEffect(() => {
    setSearchInput((current) => (current.trim() === q ? current : q));
  }, [q]);

  // Debounce the search box into ?q=, replacing history so typing doesn't
  // stack an entry per keystroke. useDebouncedValue gives an honest
  // dependency array here (no eslint-disable needed) — it settles 300ms
  // after typing stops, then this effect's the only thing that writes it.
  const debouncedSearch = useDebouncedValue(searchInput.trim(), DEBOUNCE_MS);
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch) next.set("q", debouncedSearch);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [debouncedSearch, setSearchParams]);

  const { data: months } = useEventAttendanceMonths();
  const { data: listResponse } = useEventAttendanceList(
    problems
      ? { q: q || undefined, problems: "1" }
      : { month: monthParam ?? undefined, q: q || undefined, scope: scope === "all" ? "all" : undefined },
  );

  function handleMonthChange(month: string | null): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("problems");
      if (month) next.set("month", month);
      else next.delete("month");
      return next;
    });
  }

  function handleSearchAllMonths(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("month");
      next.delete("problems");
      next.set("scope", "all");
      return next;
    });
  }

  function handleShowAllEvents(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("problems");
      return next;
    });
  }

  function handleBackToMonth(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("scope");
      return next;
    });
  }

  const resolvedMonth = listResponse?.mode === "month" ? listResponse.month : (monthParam ?? months?.current ?? null);

  if (!listResponse || !months) return <div className="loading">Wird geladen…</div>;

  const events = listResponse.events;

  return (
    <div>
      <h2>Event-Anwesenheit</h2>
      <p className="muted">
        Vom Apollo-Bot geparste Events: wer sich angemeldet hat, und wer tatsächlich im Event-Sprachkanal war.
        Konfigurierbar unter <a href="/settings">Einstellungen</a>.
      </p>

      {problems ? (
        <div className="card">
          <p>
            <strong>Alle Monate</strong> — nur Events mit offenen Zuordnungen
          </p>
          <button onClick={handleShowAllEvents}>Alle Events anzeigen</button>
        </div>
      ) : (
        <>
          {scope === "all" ? (
            <button type="button" className="back-link" onClick={handleBackToMonth}>
              ← Zurück zum aktuellen Monat
            </button>
          ) : (
            resolvedMonth && (
              <MonthPicker
                month={resolvedMonth}
                monthCounts={months.counts}
                currentMonth={months.current}
                onChange={handleMonthChange}
              />
            )
          )}
          <div className="card">
            <div className="field">
              <label htmlFor="event-title-search">Ereignisse durchsuchen</label>
              <input
                id="event-title-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Titel eingeben…"
              />
            </div>
          </div>
        </>
      )}

      {events.length === 0 ? (
        <div className="empty-state">
          {problems ? (
            <p>Keine offenen Zuordnungen im gewählten Zeitraum.</p>
          ) : scope === "all" ? (
            <p>Keine Events gefunden.</p>
          ) : (
            <>
              <p>
                {q
                  ? `Keine Events mit „${q}“ in ${resolvedMonth ? monthLabel(resolvedMonth) : "diesem Monat"} gefunden.`
                  : `Keine Events in ${resolvedMonth ? monthLabel(resolvedMonth) : "diesem Monat"}.`}
              </p>
              <button onClick={handleSearchAllMonths}>In allen Monaten suchen</button>
            </>
          )}
        </div>
      ) : (
        <div className="card-grid">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
