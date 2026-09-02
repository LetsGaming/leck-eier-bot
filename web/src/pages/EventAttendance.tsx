import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import { formatAbsolute } from "../dateFormat";
import type {
  ApolloEventStatus,
  ApolloRsvpChoice,
  AttendanceStatus,
  EventAttendance,
  EventSignup,
  MemberAuditEntry,
} from "../types";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 10;

// Mirrors APOLLO_ATTENDANCE_TIER_*_MINUTES in src/constants.ts — display thresholds only.
const TIER_MILD_MINUTES = 5;
const TIER_MODERATE_MINUTES = 15;
const TIER_SEVERE_MINUTES = 30;

type SeverityTier = "fine" | "mild" | "moderate" | "severe";

/** Both lateness and early-leave are graded on the same scale — under 5 min is still logged, just neutrally colored. */
function severityTier(minutes: number | null): SeverityTier | null {
  if (minutes === null) return null;
  if (minutes < TIER_MILD_MINUTES) return "fine";
  if (minutes < TIER_MODERATE_MINUTES) return "mild";
  if (minutes < TIER_SEVERE_MINUTES) return "moderate";
  return "severe";
}

const TIER_BADGE_CLASS: Record<SeverityTier, string> = {
  fine: "ok",
  mild: "warn",
  moderate: "moderate",
  severe: "severe",
};

const EVENT_STATUS_LABELS: Record<ApolloEventStatus, string> = {
  scheduled: "Geplant",
  active: "Läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};
const EVENT_STATUS_BADGE_CLASS: Record<ApolloEventStatus, string> = {
  scheduled: "warn",
  active: "ok",
  completed: "",
  cancelled: "error",
};

const CHOICE_LABELS: Record<ApolloRsvpChoice, string> = {
  accepted: "Zugesagt",
  declined: "Abgesagt",
  tentative: "Vielleicht",
};
const CHOICE_BADGE_CLASS: Record<ApolloRsvpChoice, string> = {
  accepted: "ok",
  declined: "error",
  tentative: "warn",
};

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  on_time: "Pünktlich",
  late: "Zu spät",
  no_show: "Nicht erschienen",
  left_early: "Früher gegangen",
  not_tracked: "Nicht getrackt",
};
const ATTENDANCE_BADGE_CLASS: Record<AttendanceStatus, string> = {
  on_time: "ok",
  late: "warn",
  no_show: "error",
  left_early: "warn",
  not_tracked: "",
};

const PROBLEM_ATTENDANCE_STATUSES: AttendanceStatus[] = ["no_show", "left_early", "late"];

/**
 * Lateness and early-leave are independent facts — someone can be both late
 * AND leave early at once, so both are always shown together, never
 * collapsed into a single "worse tier wins" badge. `no_show`/`not_tracked`
 * have no arrival/departure to show and stay a single plain badge.
 */
function ResultCell({ signup }: { signup: EventSignup }) {
  if (signup.attendanceStatus === null) return <span className="muted">—</span>;
  if (signup.attendanceStatus === "no_show" || signup.attendanceStatus === "not_tracked") {
    return <span className={`badge ${ATTENDANCE_BADGE_CLASS[signup.attendanceStatus]}`}>{ATTENDANCE_LABELS[signup.attendanceStatus]}</span>;
  }

  const arrivalTier = severityTier(signup.lateMinutes);
  const departureTier = severityTier(signup.earlyMinutes);

  return (
    <div className="stack-plain" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
      {arrivalTier && (
        <span className={`badge ${TIER_BADGE_CLASS[arrivalTier]}`}>
          {signup.lateMinutes! > 0 ? `${signup.lateMinutes} Min. zu spät` : "Pünktlich"}
        </span>
      )}
      {departureTier && (
        <span className={`badge ${TIER_BADGE_CLASS[departureTier]}`}>{`${signup.earlyMinutes} Min. zu früh gegangen`}</span>
      )}
    </div>
  );
}

function SignupRow({
  signup,
  members,
  onLink,
}: {
  signup: EventSignup;
  members: MemberAuditEntry[];
  onLink: (userId: string | null) => Promise<void>;
}) {
  const [linking, setLinking] = useState(false);
  const needsLink = signup.matchSource === "unmatched" || signup.matchSource === "ambiguous";

  async function handlePick(userId: string) {
    setLinking(true);
    try {
      await onLink(userId || null);
    } finally {
      setLinking(false);
    }
  }

  return (
    <tr>
      <td className="stack-plain">
        {signup.avatarUrl ? (
          <img src={signup.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--border)" }} />
        )}
      </td>
      <td data-label="Mitglied">
        {signup.displayName ? (
          <>
            {signup.displayName}
            {signup.displayName !== signup.rawName && <div className="muted small">{signup.rawName}</div>}
          </>
        ) : (
          <>
            <em>{signup.rawName}</em>{" "}
            <span className="badge warn">{signup.matchSource === "ambiguous" ? "Mehrdeutig" : "Nicht zugeordnet"}</span>
          </>
        )}
      </td>
      <td data-label="Anmeldung">
        <span className={`badge ${CHOICE_BADGE_CLASS[signup.choice]}`}>{CHOICE_LABELS[signup.choice]}</span>
        {signup.withdrawnAt && <div className="muted small">zurückgezogen</div>}
      </td>
      <td data-label="Ergebnis">
        <ResultCell signup={signup} />
      </td>
      <td className="mono small" data-label="Beigetreten">
        {formatAbsolute(signup.firstJoinedAt)}
      </td>
      <td className="mono small" data-label="Verlassen">
        {formatAbsolute(signup.lastLeftAt)}
      </td>
      <td>
        {needsLink ? (
          <SearchableSelect
            value=""
            onChange={handlePick}
            disabled={linking}
            placeholder="Mitglied zuordnen…"
            options={members.map((m) => ({ value: m.userId, label: m.displayName, hint: `@${m.username}` }))}
          />
        ) : signup.matchSource === "manual" ? (
          <button className="danger" disabled={linking} onClick={() => handlePick("")}>
            Verknüpfung lösen
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export default function EventAttendancePage() {
  const [events, setEvents] = useState<EventAttendance[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [members, setMembers] = useState<MemberAuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const { showError, showSuccess } = useToast();

  const trimmedSearch = searchInput.trim();
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(trimmedSearch);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmedSearch]);

  useEffect(() => {
    api
      .eventAttendance(page, searchQuery)
      .then((r) => {
        setEvents(r.events);
        setTotal(r.total);
      })
      .catch((err) => showError(errorMessage(err)));
  }, [page, searchQuery, showError]);

  useEffect(() => {
    api
      .memberAudit("")
      .then((r) => setMembers(r.inGuild))
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  async function handleLink(eventId: number, signupId: number, userId: string | null): Promise<void> {
    try {
      const updated = await api.linkEventSignup(signupId, userId);
      setEvents((prev) => prev?.map((e) => (e.id === eventId ? updated : e)) ?? null);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleDelete(event: EventAttendance): Promise<void> {
    if (!confirm(`Event "${event.title}" und alle zugehörigen Anmeldungen/Anwesenheitsdaten unwiderruflich löschen?`)) return;
    try {
      await api.deleteEventAttendance(event.id);
      showSuccess("Event gelöscht.");
      const remaining = total - 1;
      const lastPage = Math.max(1, Math.ceil(remaining / PAGE_SIZE));
      if (page > lastPage) {
        setPage(lastPage);
      } else {
        const r = await api.eventAttendance(page, searchQuery);
        setEvents(r.events);
        setTotal(r.total);
      }
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  const filteredEvents = useMemo(() => {
    if (!events) return null;
    const hasFilter = query.trim().length > 0 || onlyProblems;
    const q = query.trim().toLowerCase();
    return events
      .map((event) => ({
        ...event,
        signups: event.signups.filter((s) => {
          if (onlyProblems) {
            const isProblem =
              s.matchSource === "unmatched" ||
              s.matchSource === "ambiguous" ||
              (s.attendanceStatus !== null && PROBLEM_ATTENDANCE_STATUSES.includes(s.attendanceStatus));
            if (!isProblem) return false;
          }
          if (q) return (s.displayName ?? s.rawName).toLowerCase().includes(q);
          return true;
        }),
      }))
      .filter((event) => event.signups.length > 0 || !hasFilter);
  }, [events, query, onlyProblems]);

  if (!filteredEvents) return <div className="loading">Wird geladen…</div>;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h2>Event-Anwesenheit</h2>
      <p className="muted">
        Vom Apollo-Bot geparste Events: wer sich angemeldet hat, und wer tatsächlich im Event-Sprachkanal war.
        Konfigurierbar unter <a href="/settings">Einstellungen</a>.
      </p>

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
        <div className="stack-plain" style={{ justifyContent: "space-between" }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Zurück
          </button>
          <span className="muted small">
            Seite {page} von {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Weiter
          </button>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="event-search">Suche</label>
          <input
            id="event-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Namen eingeben…"
          />
        </div>
        <label className="switch">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Nur Probleme anzeigen (nicht zugeordnet, verspätet, nicht erschienen, früher gegangen)
        </label>
      </div>

      {filteredEvents.length === 0 ? (
        <p className="muted">Kein Apollo-Event gefunden.</p>
      ) : (
        filteredEvents.map((event) => {
          const counts = {
            accepted: event.signups.filter((s) => s.choice === "accepted").length,
            tentative: event.signups.filter((s) => s.choice === "tentative").length,
            declined: event.signups.filter((s) => s.choice === "declined").length,
            onTime: event.signups.filter((s) => s.attendanceStatus === "on_time").length,
            late: event.signups.filter((s) => s.attendanceStatus === "late").length,
            noShow: event.signups.filter((s) => s.attendanceStatus === "no_show").length,
            leftEarly: event.signups.filter((s) => s.attendanceStatus === "left_early").length,
          };
          return (
            <div className="card" key={event.id}>
              <h2>{event.title}</h2>
              <p className="muted small">
                {formatAbsolute(event.startsAt)} – {formatAbsolute(event.endsAt)}{" "}
                <span className={`badge ${EVENT_STATUS_BADGE_CLASS[event.status]}`}>
                  {EVENT_STATUS_LABELS[event.status]}
                </span>{" "}
                {event.trackingIncomplete && <span className="badge warn">Tracking unvollständig</span>}{" "}
                <a href={event.messageUrl} target="_blank" rel="noreferrer">
                  Zur Nachricht
                </a>{" "}
                <button className="danger" onClick={() => handleDelete(event)}>
                  Event löschen
                </button>
              </p>
              <p className="muted small">
                Zugesagt {counts.accepted} · Vielleicht {counts.tentative} · Abgesagt {counts.declined}
                {event.status !== "scheduled" && (
                  <>
                    {" "}
                    — Pünktlich {counts.onTime} · Zu spät {counts.late} · Nicht erschienen {counts.noShow} · Früher
                    gegangen {counts.leftEarly}
                  </>
                )}
              </p>
              {event.signups.length === 0 ? (
                <p className="muted">Keine Anmeldungen entsprechen dem Filter.</p>
              ) : (
                <div className="table-scroll">
                  <table className="stack-on-mobile">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Mitglied</th>
                        <th>Anmeldung</th>
                        <th>Ergebnis</th>
                        <th>Beigetreten</th>
                        <th>Verlassen</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {event.signups.map((signup) => (
                        <SignupRow
                          key={signup.id}
                          signup={signup}
                          members={members}
                          onLink={(userId) => handleLink(event.id, signup.id, userId)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
