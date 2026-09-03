import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
import { formatAbsolute } from "../dateFormat";
import type { AttendanceStatus, EventAttendance, MemberAuditEntry } from "../types";
import { EVENT_STATUS_BADGE_CLASS, EVENT_STATUS_LABELS } from "../eventAttendanceLabels";
import SignupRow from "../components/SignupRow";

// Same predicate as the old list page's "Nur Probleme anzeigen" filter
// (removed from the list in Task 13, relocated here per Ruling R5) — an
// unresolved match, or an attendance outcome worth a second look.
const PROBLEM_ATTENDANCE_STATUSES: AttendanceStatus[] = ["no_show", "left_early", "late"];

export default function EventAttendanceDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  const [event, setEvent] = useState<EventAttendance | null>(null);
  const [members, setMembers] = useState<MemberAuditEntry[]>([]);
  const [nameQuery, setNameQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    api
      .eventAttendance(Number(eventId))
      .then(setEvent)
      .catch((err) => showError(errorMessage(err)));
  }, [eventId, showError]);

  // The one place left in the app that still pays for the full member list —
  // moved here from the list page (Task 13) since only the linking picker
  // needs it, and it's scoped to a single event now.
  useEffect(() => {
    api
      .memberAudit("")
      .then((r) => setMembers(r.inGuild))
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  async function handleLink(signupId: number, userId: string | null): Promise<void> {
    try {
      const updated = await api.linkEventSignup(signupId, userId);
      setEvent(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleDelete(): Promise<void> {
    if (!event) return;
    const ok = await confirmDialog({
      title: "Event löschen",
      message: "Alle zugehörigen Anmeldungen und Anwesenheitsdaten werden unwiderruflich gelöscht.",
      requireText: event.title,
      confirmLabel: "Löschen",
    });
    if (!ok) return;
    try {
      await api.deleteEventAttendance(event.id);
      showSuccess("Event gelöscht.");
      const monthKey = event.startsAt.slice(0, 7);
      navigate(`/events?month=${monthKey}`);
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  const tallies = useMemo(() => {
    if (!event) return null;
    const signups = event.signups;
    const accepted = signups.filter((s) => s.choice === "accepted").length;
    const tentative = signups.filter((s) => s.choice === "tentative").length;
    const declined = signups.filter((s) => s.choice === "declined").length;
    const unresolved = signups.filter((s) => s.matchSource === "unmatched" || s.matchSource === "ambiguous").length;

    const onTime = signups.filter((s) => s.attendanceStatus === "on_time").length;
    const late = signups.filter((s) => s.attendanceStatus === "late").length;
    const noShow = signups.filter((s) => s.attendanceStatus === "no_show").length;
    const leftEarly = signups.filter((s) => s.attendanceStatus === "left_early").length;
    const notTracked = signups.filter((s) => s.attendanceStatus === "not_tracked").length;
    // Subsets of onTime/leftEarly above, not additional peer categories —
    // never add these into a total, they're informational "davon" breakdowns
    // mirroring the backend's EventSignupCounts.lateWithinGrace/earlyWithinGrace.
    const lateWithinGrace = signups.filter((s) => s.attendanceStatus === "on_time" && (s.lateMinutes ?? 0) > 0).length;
    const earlyWithinGrace = signups.filter(
      (s) => (s.earlyMinutes ?? 0) > 0 && s.attendanceStatus !== "left_early",
    ).length;

    return { accepted, tentative, declined, unresolved, onTime, late, noShow, leftEarly, notTracked, lateWithinGrace, earlyWithinGrace };
  }, [event]);

  const filteredSignups = useMemo(() => {
    if (!event) return [];
    const q = nameQuery.trim().toLowerCase();
    return event.signups.filter((s) => {
      if (onlyProblems) {
        const isProblem =
          s.matchSource === "unmatched" ||
          s.matchSource === "ambiguous" ||
          (s.attendanceStatus !== null && PROBLEM_ATTENDANCE_STATUSES.includes(s.attendanceStatus));
        if (!isProblem) return false;
      }
      if (q) return (s.displayName ?? s.rawName).toLowerCase().includes(q);
      return true;
    });
  }, [event, nameQuery, onlyProblems]);

  if (!event || !tallies) return <div className="loading">Wird geladen…</div>;

  return (
    <div>
      <Link to="/events" className="back-link">
        ← Zurück zu den Events
      </Link>

      <h2>{event.title}</h2>
      <p className="muted small">
        {formatAbsolute(event.startsAt)} – {formatAbsolute(event.endsAt)}{" "}
        <span className={`badge ${EVENT_STATUS_BADGE_CLASS[event.status]}`}>{EVENT_STATUS_LABELS[event.status]}</span>{" "}
        {event.trackingIncomplete && <span className="badge warn">Tracking unvollständig</span>}{" "}
        <a href={event.messageUrl} target="_blank" rel="noreferrer">
          Zur Nachricht
        </a>{" "}
        <button className="danger" onClick={handleDelete}>
          Event löschen
        </button>
      </p>

      <div className="card">
        <div className="tally-grid">
          <span className="muted small">Zugesagt</span>
          <strong>{tallies.accepted}</strong>
          <span className="muted small">Vielleicht</span>
          <strong>{tallies.tentative}</strong>
          <span className="muted small">Abgesagt</span>
          <strong>{tallies.declined}</strong>
          {tallies.unresolved > 0 && (
            <>
              <span className="muted small">Offene Zuordnungen</span>
              <strong>
                <span className="badge warn">{tallies.unresolved}</span>
              </strong>
            </>
          )}
        </div>

        {event.status !== "scheduled" && (
          <div className="tally-grid">
            <span className="muted small">Pünktlich</span>
            <strong>{tallies.onTime}</strong>
            <span className="muted small">Zu spät</span>
            <strong>{tallies.late}</strong>
            <span className="muted small">Nicht erschienen</span>
            <strong>{tallies.noShow}</strong>
            <span className="muted small">Früher gegangen</span>
            <strong>{tallies.leftEarly}</strong>
            <span className="muted small">Nicht getrackt</span>
            <strong>{tallies.notTracked}</strong>
            {tallies.lateWithinGrace > 0 && (
              <p className="muted small" style={{ width: "100%", margin: 0 }}>
                davon {tallies.lateWithinGrace} leicht verspätet (unter 5 Min.)
              </p>
            )}
            {tallies.earlyWithinGrace > 0 && (
              <p className="muted small" style={{ width: "100%", margin: 0 }}>
                davon {tallies.earlyWithinGrace} leicht früher gegangen (unter 5 Min.)
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="signup-search">Suche</label>
          <input
            id="signup-search"
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Namen eingeben…"
          />
        </div>
        <label className="switch">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Nur Probleme anzeigen (nicht zugeordnet, verspätet, nicht erschienen, früher gegangen)
        </label>
      </div>

      {filteredSignups.length === 0 ? (
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
                <th>Verspätung</th>
                <th>Beigetreten</th>
                <th>Verlassen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredSignups.map((signup) => (
                <SignupRow
                  key={signup.id}
                  signup={signup}
                  event={event}
                  members={members}
                  onLink={(userId) => handleLink(signup.id, userId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
