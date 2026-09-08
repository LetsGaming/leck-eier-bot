import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import { formatAbsolute } from "../dateFormat";
import type { AttendanceStatus, EventSignup } from "../types";
import { ATTENDANCE_LABELS, CHOICE_LABELS, EVENT_STATUS_BADGE_CLASS, EVENT_STATUS_LABELS } from "../eventAttendanceLabels";
import SignupRow from "../components/SignupRow";
import { useEventAttendanceDetail, useInGuildMembers } from "../hooks/useEventAttendance";

const SIGNUP_COLUMNS: BaseTableColumn<EventSignup>[] = [
  { key: "avatar", label: "" },
  { key: "member", label: "Mitglied", accessor: (s) => s.displayName ?? s.rawName },
  { key: "choice", label: "Anmeldung", accessor: (s) => CHOICE_LABELS[s.choice] },
  { key: "attendanceStatus", label: "Ergebnis", accessor: (s) => (s.attendanceStatus ? ATTENDANCE_LABELS[s.attendanceStatus] : null) },
  {
    key: "lateness",
    label: "Verspätung",
    // Whichever of the two independent minute counts is set — a row is
    // never both late arriving and early-departing-only, so this is never
    // ambiguous in practice.
    accessor: (s) => s.lateMinutes ?? s.earlyMinutes,
  },
  { key: "firstJoinedAt", label: "Beigetreten", accessor: (s) => s.firstJoinedAt },
  { key: "lastLeftAt", label: "Verlassen", accessor: (s) => s.lastLeftAt },
  { key: "actions", label: "" },
];

// Same predicate as the old list page's "Nur Probleme anzeigen" filter
// (removed from the list in Task 13, relocated here per Ruling R5) — an
// unresolved match, or an attendance outcome worth a second look.
const PROBLEM_ATTENDANCE_STATUSES: AttendanceStatus[] = ["no_show", "left_early", "late"];

export default function EventAttendanceDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  const [nameQuery, setNameQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);

  const { data: event, setData: setEvent } = useEventAttendanceDetail(eventId);

  // The one place left in the app that still pays for the member list —
  // moved here from the list page (Task 13) since only the linking picker
  // needs it, and it's scoped to a single event now. Uses the lightweight
  // in-guild-only endpoint (not memberAudit()) since this dropdown only ever
  // links a signup to a *current* member — it never needs the (growing,
  // unbounded) former-members half of the table.
  const { data: membersData } = useInGuildMembers();
  const members = membersData ?? [];

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

  // A member already linked to one signup (whether auto-matched or
  // manually linked) shouldn't be offered again for a *different* unmatched
  // signup — that would let two rows point at the same person.
  const memberOptions = useMemo(() => {
    const alreadyLinked = new Set(event?.signups.filter((s) => s.userId).map((s) => s.userId) ?? []);
    return members.filter((m) => !alreadyLinked.has(m.userId)).map((m) => ({ value: m.userId, label: m.displayName, hint: `@${m.username}` }));
  }, [members, event]);

  const tallies = useMemo(() => {
    if (!event) return null;
    const signups = event.signups;
    const accepted = signups.filter((s) => s.choice === "accepted").length;
    const tentative = signups.filter((s) => s.choice === "tentative").length;
    const declined = signups.filter((s) => s.choice === "declined").length;
    const unresolved = signups.filter((s) => s.matchSource === "unmatched" || s.matchSource === "ambiguous").length;
    // Current, non-bot members with zero signup entry at all — never reacted
    // to Apollo's embed one way or the other, not even a "declined". A
    // signup with no `userId` (unmatched/ambiguous) can't match any real
    // member here either, which is intentional: that person did respond,
    // just isn't linked yet, and is already surfaced above via "unresolved".
    const respondedIds = new Set(signups.filter((s) => s.userId).map((s) => s.userId));
    const noResponse = members.filter((m) => !m.isBot && !respondedIds.has(m.userId)).length;

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

    return {
      accepted,
      tentative,
      declined,
      unresolved,
      noResponse,
      onTime,
      late,
      noShow,
      leftEarly,
      notTracked,
      lateWithinGrace,
      earlyWithinGrace,
    };
  }, [event, members]);

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
        <div className="tally-grid tally-grid-rsvp">
          <div className="tally-item">
            <span className="muted small">Zugesagt</span>
            <strong>{tallies.accepted}</strong>
          </div>
          <div className="tally-item">
            <span className="muted small">Vielleicht</span>
            <strong>{tallies.tentative}</strong>
          </div>
          <div className="tally-item">
            <span className="muted small">Abgesagt</span>
            <strong>{tallies.declined}</strong>
          </div>
          <div className="tally-item">
            <span className="muted small">Keine Rückmeldung</span>
            <strong>{tallies.noResponse}</strong>
          </div>
          {tallies.unresolved > 0 && (
            <div className="tally-item">
              <span className="muted small">Offene Zuordnungen</span>
              <strong>
                <span className="badge warn">{tallies.unresolved}</span>
              </strong>
            </div>
          )}
        </div>

        {event.status !== "scheduled" && (
          <div className="tally-grid">
            <div className="tally-item">
              <span className="muted small">Pünktlich</span>
              <strong>{tallies.onTime}</strong>
            </div>
            <div className="tally-item">
              <span className="muted small">Zu spät</span>
              <strong>{tallies.late}</strong>
            </div>
            <div className="tally-item">
              <span className="muted small">Nicht erschienen</span>
              <strong>{tallies.noShow}</strong>
            </div>
            <div className="tally-item">
              <span className="muted small">Früher gegangen</span>
              <strong>{tallies.leftEarly}</strong>
            </div>
            <div className="tally-item">
              <span className="muted small">Nicht getrackt</span>
              <strong>{tallies.notTracked}</strong>
            </div>
            {tallies.lateWithinGrace > 0 && (
              <p className="muted small tally-note">
                davon {tallies.lateWithinGrace} leicht verspätet (unter 5 Min.)
              </p>
            )}
            {tallies.earlyWithinGrace > 0 && (
              <p className="muted small tally-note">
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

      <BaseTable
        columns={SIGNUP_COLUMNS}
        rows={filteredSignups}
        rowKey={(s) => s.id}
        emptyMessage={<p className="muted">Keine Anmeldungen entsprechen dem Filter.</p>}
        renderRow={(signup) => (
          <SignupRow
            key={signup.id}
            signup={signup}
            event={event}
            memberOptions={memberOptions}
            onLink={(userId) => handleLink(signup.id, userId)}
          />
        )}
      />
    </div>
  );
}
