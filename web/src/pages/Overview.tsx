import { Link } from "react-router-dom";
import { useStatus } from "../hooks/useStatus";
import { formatAbsolute, formatRelative } from "../dateFormat";
import type { CommunitySnapshot, BotOwnerStats } from "../types";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

const ACTIVITY_LABELS: Record<CommunitySnapshot["recentAuditActivity"][number]["event"], string> = {
  joined: "ist beigetreten",
  left: "hat den Server verlassen",
  rulesAccepted: "hat die Regeln akzeptiert",
};

function CommunitySnapshotSection({ snapshot }: { snapshot: CommunitySnapshot }) {
  return (
    <>
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="label">Mitglieder</div>
          <div className="value">{snapshot.memberCount ?? "—"}</div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h2>Geburtstage diese Woche</h2>
          {snapshot.birthdaysThisWeek.length === 0 ? (
            <p className="muted">Keine Geburtstage in den nächsten 7 Tagen.</p>
          ) : (
            <ul className="attention-list">
              {snapshot.birthdaysThisWeek.map((b, i) => (
                <li key={b.userId ?? `${b.mention}-${i}`}>
                  {b.userId ? (
                    <Link to={`/members/${b.userId}`}>{b.name ?? b.mention}</Link>
                  ) : (
                    <span>{b.name ?? b.mention}</span>
                  )}{" "}
                  <span className="muted small">{formatAbsolute(b.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Anstehende Events</h2>
          {snapshot.upcomingEvents.length === 0 ? (
            <p className="muted">Keine anstehenden Events in den nächsten 30 Tagen.</p>
          ) : (
            <ul className="attention-list">
              {snapshot.upcomingEvents.map((e) => (
                <li key={e.id}>
                  <Link to={`/events/${e.id}`}>{e.title}</Link>{" "}
                  <span className="muted small">
                    {formatAbsolute(e.startsAt)} · {e.signupCount}{" "}
                    {e.signupCount === 1 ? "Anmeldung" : "Anmeldungen"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Letzte Aktivität</h2>
          {snapshot.recentAuditActivity.length === 0 ? (
            <p className="muted">Keine aktuelle Aktivität.</p>
          ) : (
            <ul className="attention-list">
              {snapshot.recentAuditActivity.map((a, i) => (
                <li key={`${a.userId}-${a.event}-${i}`}>
                  <Link to={`/members/${a.userId}`}>{a.displayName}</Link> {ACTIVITY_LABELS[a.event]}{" "}
                  <span className="muted small">{formatRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function BotOwnerStatsSection({ stats }: { stats: BotOwnerStats }) {
  return (
    <div className="stat-grid">
      <div className="stat-tile">
        <div className="label">Bot</div>
        <div className="value">{stats.botTag ?? "—"}</div>
      </div>
      <div className="stat-tile">
        <div className="label">Laufzeit</div>
        <div className="value">{formatUptime(stats.uptimeMs)}</div>
      </div>
      <div className="stat-tile">
        <div className="label">Server</div>
        <div className="value">{stats.guildName ?? "—"}</div>
      </div>
      <div className="stat-tile">
        <div className="label">Zwischengespeicherte Mitglieder</div>
        <div className="value">{stats.cachedMemberCount}</div>
      </div>
      <div className="stat-tile">
        <div className="label">Reaktionsrollen-Panels</div>
        <div className="value">{stats.reactionRolePanelCount}</div>
      </div>
    </div>
  );
}

export default function Overview() {
  const { data: status } = useStatus();

  const hasAttentionItems = !!status && (status.pendingRegistrationCount > 0 || status.unmatchedSignupCount > 0);

  return (
    <div>
      <h2>Übersicht</h2>

      {status && hasAttentionItems && (
        <div className="card attention-card">
          <h2>Braucht deine Aufmerksamkeit</h2>
          <ul className="attention-list">
            {status.pendingRegistrationCount > 0 && (
              <li>
                <Link to="/members">
                  <span className="badge warn">{status.pendingRegistrationCount}</span>{" "}
                  {status.pendingRegistrationCount === 1
                    ? "Registrierung wartet auf Prüfung"
                    : "Registrierungen warten auf Prüfung"}
                </Link>
              </li>
            )}
            {status.unmatchedSignupCount > 0 && (
              <li>
                <Link to="/events?problems=1">
                  <span className="badge warn">{status.unmatchedSignupCount}</span>{" "}
                  {status.unmatchedSignupCount === 1
                    ? "Event-Anmeldung braucht manuelle Zuordnung"
                    : "Event-Anmeldungen brauchen manuelle Zuordnung"}
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {!status ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        <>
          {status.botOwnerStats && <BotOwnerStatsSection stats={status.botOwnerStats} />}
          <CommunitySnapshotSection snapshot={status.communitySnapshot} />
        </>
      )}

      <div className="card">
        <h2>Schnellzugriff</h2>
        <p>
          <Link to="/members">Mitgliederprüfung öffnen</Link>
        </p>
        <p>
          <Link to="/events">Event-Anwesenheit öffnen</Link>
        </p>
        <p>
          <Link to="/reaction-roles">Reaktionsrollen-Panels verwalten</Link>
        </p>
        <p>
          <Link to="/birthdays">Geburtstagsvorlage &amp; Zeitplan bearbeiten</Link>
        </p>
        <p>
          <Link to="/commands">Befehle aktivieren oder deaktivieren</Link>
        </p>
      </div>
    </div>
  );
}
