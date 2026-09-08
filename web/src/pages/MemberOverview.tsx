import { Link, useParams } from "react-router-dom";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import { useMemberOverview } from "../hooks/useMemberOverview";
import { formatAbsolute, formatRelative } from "../dateFormat";
import { CHOICE_BADGE_CLASS, CHOICE_LABELS, ATTENDANCE_BADGE_CLASS, ATTENDANCE_LABELS } from "../eventAttendanceLabels";
import type { MemberOverviewEventEntry, RegistrationStatus } from "../types";

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

const eventHistoryColumns: BaseTableColumn<MemberOverviewEventEntry>[] = [
  {
    key: "eventTitle",
    label: "Event",
    accessor: (e) => e.eventTitle,
    render: (e) => <Link to={`/events/${e.eventId}`}>{e.eventTitle}</Link>,
  },
  {
    key: "startsAt",
    label: "Datum",
    accessor: (e) => e.startsAt,
    className: "mono small",
    render: (e) => formatAbsolute(e.startsAt),
  },
  {
    key: "choice",
    label: "Anmeldung",
    accessor: (e) => CHOICE_LABELS[e.choice],
    render: (e) => <span className={`badge ${CHOICE_BADGE_CLASS[e.choice]}`}>{CHOICE_LABELS[e.choice]}</span>,
  },
  {
    key: "attendanceStatus",
    label: "Ergebnis",
    accessor: (e) => (e.attendanceStatus ? ATTENDANCE_LABELS[e.attendanceStatus] : null),
    render: (e) =>
      e.attendanceStatus ? (
        <span className={`badge ${ATTENDANCE_BADGE_CLASS[e.attendanceStatus]}`}>{ATTENDANCE_LABELS[e.attendanceStatus]}</span>
      ) : (
        <span className="muted">—</span>
      ),
  },
];

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
        <BaseTable
          columns={eventHistoryColumns}
          rows={member.eventHistory}
          rowKey={(e) => e.eventId}
          emptyMessage={<p className="muted">Keine Event-Anmeldungen.</p>}
        />
      </div>
    </div>
  );
}
