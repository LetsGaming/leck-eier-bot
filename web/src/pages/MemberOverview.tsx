import { Link, useParams } from "react-router-dom";
import { useMemberOverview } from "../hooks/useMemberOverview";
import { formatAbsolute, formatRelative } from "../dateFormat";
import { CHOICE_BADGE_CLASS, CHOICE_LABELS, ATTENDANCE_BADGE_CLASS, ATTENDANCE_LABELS } from "../eventAttendanceLabels";
import type { RegistrationStatus } from "../types";

const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "Ausstehend",
  registered: "Registriert",
  removed: "Entfernt",
  left: "Verlassen",
};

const REGISTRATION_STATUS_BADGE_CLASS: Record<RegistrationStatus, string> = {
  pending: "warn",
  registered: "ok",
  removed: "error",
  left: "error",
};

function formatBirthday(day: number, month: number): string {
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.`;
}

export default function MemberOverview() {
  const { userId } = useParams<{ userId: string }>();
  const { data: member, loading } = useMemberOverview(userId);

  if (loading && !member) return <div className="loading">Wird geladen…</div>;

  if (!member) {
    return (
      <div>
        <Link to="/members" className="back-link">
          ← Zurück zur Mitgliederprüfung
        </Link>
        <div className="empty-state">
          <p>Kein Mitglied mit dieser ID gefunden.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/members" className="back-link">
        ← Zurück zur Mitgliederprüfung
      </Link>

      <div className="card">
        <div className="member-header">
          <img src={member.avatarUrl} alt="" width={64} height={64} className="avatar-round" />
          <div>
            <h2>
              {member.displayName}{" "}
              <span className={`badge ${member.inGuild ? "ok" : "error"}`}>
                {member.inGuild ? "Auf dem Server" : "Server verlassen"}
              </span>
            </h2>
            <p className="muted small">
              @{member.username}
              {member.nickname && ` · Nickname: ${member.nickname}`}
            </p>
            <p className="muted small">
              <code>{member.userId}</code>
            </p>
          </div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2>Verlauf</h2>
          <ul className="attention-list">
            <li>
              Beigetreten:{" "}
              <span className="mono">
                {formatAbsolute(member.joinedAt)} <span className="muted small">({formatRelative(member.joinedAt)})</span>
              </span>
            </li>
            <li>
              Regeln akzeptiert:{" "}
              <span className="mono">
                {formatAbsolute(member.rulesAcceptedAt)}{" "}
                <span className="muted small">({formatRelative(member.rulesAcceptedAt)})</span>
              </span>
            </li>
            <li>
              Verlassen:{" "}
              <span className="mono">
                {formatAbsolute(member.leftAt)} <span className="muted small">({formatRelative(member.leftAt)})</span>
              </span>
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>Registrierung</h2>
          {member.registration ? (
            <>
              <p>
                <span className={`badge ${REGISTRATION_STATUS_BADGE_CLASS[member.registration.status]}`}>
                  {REGISTRATION_STATUS_LABELS[member.registration.status]}
                </span>
              </p>
              <p className="muted small">
                Eingereicht: {formatAbsolute(member.registration.submittedAt)}{" "}
                <span className="muted small">({formatRelative(member.registration.submittedAt)})</span>
              </p>
            </>
          ) : (
            <p className="muted">Kein Registrierungsformular eingereicht.</p>
          )}
        </div>

        <div className="card">
          <h2>Geburtstag</h2>
          {member.birthday ? (
            <p>
              {formatBirthday(member.birthday.day, member.birthday.month)}{" "}
              <Link to="/birthdays">Bearbeiten</Link>
            </p>
          ) : (
            <p className="muted">Kein Geburtstag hinterlegt.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Event-Verlauf ({member.eventHistory.length})</h2>
        {member.eventHistory.length === 0 ? (
          <p className="muted">Keine Event-Anmeldungen.</p>
        ) : (
          <div className="table-scroll">
            <table className="stack-on-mobile">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Datum</th>
                  <th>Anmeldung</th>
                  <th>Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {member.eventHistory.map((entry) => (
                  <tr key={entry.eventId}>
                    <td data-label="Event">
                      <Link to={`/events/${entry.eventId}`}>{entry.eventTitle}</Link>
                    </td>
                    <td className="mono small" data-label="Datum">
                      {formatAbsolute(entry.startsAt)}
                    </td>
                    <td data-label="Anmeldung">
                      <span className={`badge ${CHOICE_BADGE_CLASS[entry.choice]}`}>{CHOICE_LABELS[entry.choice]}</span>
                    </td>
                    <td data-label="Ergebnis">
                      {entry.attendanceStatus ? (
                        <span className={`badge ${ATTENDANCE_BADGE_CLASS[entry.attendanceStatus]}`}>
                          {ATTENDANCE_LABELS[entry.attendanceStatus]}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
