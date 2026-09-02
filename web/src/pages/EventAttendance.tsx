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
        {signup.attendanceStatus ? (
          <span className={`badge ${ATTENDANCE_BADGE_CLASS[signup.attendanceStatus]}`}>
            {ATTENDANCE_LABELS[signup.attendanceStatus]}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
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
  const [members, setMembers] = useState<MemberAuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    api.eventAttendance().then(setEvents).catch((err) => showError(errorMessage(err)));
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

  return (
    <div>
      <h2>Event-Anwesenheit</h2>
      <p className="muted">
        Vom Apollo-Bot geparste Events: wer sich angemeldet hat, und wer tatsächlich im Event-Sprachkanal war.
        Konfigurierbar unter <a href="/settings">Einstellungen</a>.
      </p>

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
        <p className="muted">Noch kein Apollo-Event erkannt.</p>
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
                </a>
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
