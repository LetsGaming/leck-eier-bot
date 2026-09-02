import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { Status } from "../types";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function Overview() {
  const [status, setStatus] = useState<Status | null>(null);
  const { showError } = useToast();

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

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
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="label">Bot</div>
            <div className="value">{status.botTag ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Laufzeit</div>
            <div className="value">{formatUptime(status.uptimeMs)}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Server</div>
            <div className="value">{status.guildName ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Mitglieder</div>
            <div className="value">{status.guildMemberCount ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Zwischengespeicherte Mitglieder</div>
            <div className="value">{status.cachedMemberCount}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Reaktionsrollen-Panels</div>
            <div className="value">{status.reactionRolePanelCount}</div>
          </div>
        </div>
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
